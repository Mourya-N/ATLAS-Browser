import type { WebContents } from 'electron';
import type {
  DOMElementInfo,
  HitlPauseReason,
  InjectionWarning,
  PageDiff,
  PagePerception
} from '@shared/types';
import type { InjectionGuard } from '@main/security/injection-guard';
import type { CDPManager } from './cdp-manager';

interface RawPageSnapshot {
  url: string;
  title: string;
  viewport: { width: number; height: number; scrollX: number; scrollY: number; scrollHeight: number };
  interactiveElements: DOMElementInfo[];
  mainText: string;
  selectedText: string;
  headings: string[];
  tablesSummary: string[];
  hiddenTexts: string[];
  comments: string[];
  crossOriginIframes: number;
  hitlSignals: HitlPauseReason[];
}

export class PerceptionEngine {
  constructor(
    private readonly cdp: CDPManager,
    private readonly injectionGuard: InjectionGuard
  ) {}

  public async capture(
    tabId: string,
    webContents: WebContents,
    options: { includeScreenshot?: boolean; includeAxTree?: boolean } = {}
  ): Promise<PagePerception> {
    const raw = await this.captureDomSnapshot(tabId, webContents);

    let axSummary = '';
    if (options.includeAxTree !== false) {
      try {
        const axNodes = await this.cdp.getAccessibilityTree(tabId, webContents);
        axSummary = this.summarizeAXTree(axNodes);
      } catch {
        axSummary = '(Accessibility tree unavailable on this page)';
      }
    }

    let screenshotBase64: string | undefined;
    let somTargets: PagePerception['somTargets'] | undefined;
    if (options.includeScreenshot) {
      try {
        screenshotBase64 = await this.cdp.captureScreenshot(tabId, webContents);
        somTargets = raw.interactiveElements.slice(0, 60).map((el, idx) => ({
          atlasId: el.atlasId,
          label: idx + 1,
          box: el.boundingBox
        }));
      } catch {
        // Screenshot capture failed; degrade gracefully to DOM/AX
      }
    }

    const warnings: InjectionWarning[] = [
      ...this.injectionGuard.scanText(raw.mainText, 'visible_page_text'),
      ...this.injectionGuard.scanText(raw.hiddenTexts.join('\n'), 'hidden_dom_elements'),
      ...this.injectionGuard.scanText(raw.comments.join('\n'), 'html_comments')
    ];

    return {
      tabId,
      url: raw.url,
      title: raw.title,
      capturedAt: Date.now(),
      viewport: raw.viewport,
      axSummary,
      interactiveElements: raw.interactiveElements,
      mainText: raw.mainText,
      selectedText: raw.selectedText,
      headings: raw.headings,
      tablesSummary: raw.tablesSummary,
      screenshotBase64,
      somTargets,
      injectionWarnings: warnings,
      hitlSignals: raw.hitlSignals
    };
  }

  private async captureDomSnapshot(tabId: string, webContents: WebContents): Promise<RawPageSnapshot> {
    const script = `(() => {
      let counter = 1;
      const interactive = [];
      const hiddenTexts = [];
      const comments = [];
      let crossOriginIframes = 0;

      const isInteractiveTag = (el) => {
        const tag = el.tagName;
        if (['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'DETAILS', 'SUMMARY'].includes(tag)) return true;
        const role = el.getAttribute('role');
        if (role && ['button', 'link', 'textbox', 'checkbox', 'radio', 'combobox', 'menuitem', 'tab', 'switch'].includes(role)) return true;
        if (el.hasAttribute('tabindex') && el.getAttribute('tabindex') !== '-1') return true;
        return false;
      };

      const buildSelector = (el) => {
        if (el.id) return '#' + CSS.escape(el.id);
        const testId = el.getAttribute('data-testid') || el.getAttribute('name');
        if (testId) return el.tagName.toLowerCase() + '[name="' + testId.replace(/"/g, '\\"') + '"]';
        const parts = [];
        let cur = el;
        while (cur && cur.nodeType === 1 && parts.length < 4) {
          let seg = cur.tagName.toLowerCase();
          if (cur.id) {
            parts.unshift('#' + CSS.escape(cur.id));
            break;
          }
          const parent = cur.parentElement;
          if (parent) {
            const siblings = Array.from(parent.children).filter((c) => c.tagName === cur.tagName);
            if (siblings.length > 1) {
              seg += ':nth-of-type(' + (siblings.indexOf(cur) + 1) + ')';
            }
          }
          parts.unshift(seg);
          cur = parent;
        }
        return parts.join(' > ');
      };

      const walk = (root, frameOffsetX, frameOffsetY, inShadow, frameId) => {
        // Collect HTML comments
        try {
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
          let cNode;
          while ((cNode = walker.nextNode()) && comments.length < 25) {
            const txt = (cNode.nodeValue || '').trim();
            if (txt.length > 8) comments.push(txt.slice(0, 300));
          }
        } catch (_) {}

        const all = root.querySelectorAll ? root.querySelectorAll('*') : [];
        for (const el of all) {
          const style = window.getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          const isHidden =
            style.display === 'none' ||
            style.visibility === 'hidden' ||
            parseFloat(style.opacity || '1') === 0 ||
            parseFloat(style.fontSize || '12') <= 1 ||
            el.getAttribute('aria-hidden') === 'true';

          if (isHidden && hiddenTexts.length < 20) {
            const ht = (el.textContent || '').trim();
            if (ht.length > 15 && ht.length < 500) hiddenTexts.push(ht);
          }

          if (isInteractiveTag(el) && interactive.length < 150) {
            const visible = rect.width > 0 && rect.height > 0 && !isHidden;
            const atlasId = 'el_' + (counter++);
            el.setAttribute('data-atlas-id', atlasId);
            const attrs = {};
            for (const attr of ['id', 'name', 'type', 'placeholder', 'aria-label', 'role', 'href', 'value']) {
              const v = el.getAttribute(attr);
              if (v !== null && v !== '') attrs[attr] = attr === 'type' || el.type !== 'password' ? String(v).slice(0, 120) : '[MASKED]';
            }
            interactive.push({
              atlasId,
              tag: el.tagName.toLowerCase(),
              role: el.getAttribute('role') || el.tagName.toLowerCase(),
              type: el.getAttribute('type') || undefined,
              name: (el.getAttribute('aria-label') || el.getAttribute('name') || el.innerText || el.textContent || el.getAttribute('placeholder') || '').trim().slice(0, 100),
              text: (el.innerText || el.textContent || el.value || '').trim().slice(0, 140),
              placeholder: el.getAttribute('placeholder') || undefined,
              href: el.getAttribute('href') || undefined,
              value: el.type === 'password' ? '[MASKED]' : (el.value !== undefined ? String(el.value).slice(0, 100) : undefined),
              selector: buildSelector(el),
              xpath: '',
              frameId,
              inShadowDom: inShadow,
              visible,
              interactable: visible && !el.disabled && el.getAttribute('aria-disabled') !== 'true',
              boundingBox: {
                x: Math.round(rect.left + frameOffsetX),
                y: Math.round(rect.top + frameOffsetY),
                width: Math.round(rect.width),
                height: Math.round(rect.height)
              },
              attributes: attrs
            });
          }

          if (el.shadowRoot) {
            walk(el.shadowRoot, frameOffsetX, frameOffsetY, true, frameId);
          }
          if (el.tagName === 'IFRAME') {
            try {
              if (el.contentDocument) {
                walk(el.contentDocument, frameOffsetX + rect.left, frameOffsetY + rect.top, inShadow, el.id || el.name || 'iframe');
              } else {
                crossOriginIframes++;
              }
            } catch (_) {
              crossOriginIframes++;
            }
          }
        }
      };

      walk(document, 0, 0, false, 'main');

      const headings = Array.from(document.querySelectorAll('h1,h2,h3'))
        .slice(0, 25)
        .map((h) => h.tagName + ': ' + (h.textContent || '').trim().slice(0, 120))
        .filter((s) => s.length > 4);

      const tablesSummary = Array.from(document.querySelectorAll('table'))
        .slice(0, 6)
        .map((tbl, idx) => {
          const rows = Array.from(tbl.querySelectorAll('tr')).slice(0, 6).map((tr) =>
            Array.from(tr.querySelectorAll('th,td')).map((c) => (c.textContent || '').trim().slice(0, 40)).join(' | ')
          );
          return 'Table ' + (idx + 1) + ':\\n' + rows.join('\\n');
        });

      const bodyText = (document.body?.innerText || '').replace(/\\n{3,}/g, '\\n\\n').trim().slice(0, 12000);
      const selectedText = (window.getSelection?.()?.toString() || '').trim().slice(0, 4000);

      // Detect HITL pause signals (CAPTCHA, login wall, payment form)
      const hitlSignals = [];
      const lowerText = (document.title + ' ' + bodyText.slice(0, 3000)).toLowerCase();
      if (
        document.querySelector('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"], .g-recaptcha, .h-captcha, [data-sitekey]') ||
        /verify you are human|complete the captcha|security check/i.test(lowerText)
      ) {
        hitlSignals.push('captcha');
      }
      if (document.querySelector('input[type="password"]')) {
        hitlSignals.push('login_required');
      }
      if (
        document.querySelector('input[autocomplete="cc-number"], input[name*="cardnumber"], input[name*="cvv"]') ||
        (/credit card|card number|cvv|billing address/i.test(lowerText) && /pay|checkout|order/i.test(lowerText))
      ) {
        hitlSignals.push('payment_page');
      }

      return {
        url: location.href,
        title: document.title || location.href,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
          scrollX: Math.round(window.scrollX),
          scrollY: Math.round(window.scrollY),
          scrollHeight: Math.round(document.documentElement.scrollHeight)
        },
        interactiveElements: interactive,
        mainText: bodyText,
        selectedText,
        headings,
        tablesSummary,
        hiddenTexts,
        comments,
        crossOriginIframes,
        hitlSignals
      };
    })()`;

    return this.cdp.evaluateInternal<RawPageSnapshot>(tabId, webContents, script);
  }

  private summarizeAXTree(nodes: unknown[]): string {
    const lines: string[] = [];
    for (const raw of nodes) {
      const node = raw as {
        role?: { value?: string };
        name?: { value?: string };
        ignored?: boolean;
      };
      if (node.ignored) continue;
      const role = node.role?.value || '';
      const name = (node.name?.value || '').trim();
      if (!name || role === 'StaticText' || role === 'InlineTextBox' || role === 'none') continue;
      lines.push(`[${role}] ${name.slice(0, 100)}`);
      if (lines.length >= 90) break;
    }
    return lines.join('\n');
  }

  public computeDiff(before: PagePerception | null, after: PagePerception): PageDiff {
    if (!before) {
      return {
        urlChanged: true,
        previousUrl: '',
        currentUrl: after.url,
        titleChanged: true,
        previousTitle: '',
        currentTitle: after.title,
        addedElementsCount: after.interactiveElements.length,
        removedElementsCount: 0,
        textDeltaSummary: `Initial capture (${after.mainText.length} chars)`,
        scrollChanged: false
      };
    }

    const beforeKeys = new Set(before.interactiveElements.map((e) => `${e.tag}:${e.selector}:${e.text}`));
    const afterKeys = new Set(after.interactiveElements.map((e) => `${e.tag}:${e.selector}:${e.text}`));
    let added = 0;
    let removed = 0;
    for (const k of afterKeys) if (!beforeKeys.has(k)) added += 1;
    for (const k of beforeKeys) if (!afterKeys.has(k)) removed += 1;

    const textLenDiff = after.mainText.length - before.mainText.length;
    const scrollChanged =
      before.viewport.scrollX !== after.viewport.scrollX ||
      before.viewport.scrollY !== after.viewport.scrollY;

    return {
      urlChanged: before.url !== after.url,
      previousUrl: before.url,
      currentUrl: after.url,
      titleChanged: before.title !== after.title,
      previousTitle: before.title,
      currentTitle: after.title,
      addedElementsCount: added,
      removedElementsCount: removed,
      textDeltaSummary:
        before.mainText === after.mainText
          ? 'Text unchanged'
          : `Text delta ${textLenDiff >= 0 ? '+' : ''}${textLenDiff} chars`,
      scrollChanged
    };
  }
}
