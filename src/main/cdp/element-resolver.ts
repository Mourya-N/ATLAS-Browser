import type { WebContents } from 'electron';
import type { CDPManager } from './cdp-manager';

export interface ResolvedElementCheck {
  exists: boolean;
  visible: boolean;
  interactable: boolean;
  coveredByOverlay: boolean;
  overlayDescription?: string;
  tag?: string;
  text?: string;
  role?: string;
  center?: { x: number; y: number };
  boundingBox?: { x: number; y: number; width: number; height: number };
  isSensitiveField?: boolean;
  isSensitiveAction?: boolean;
  confidence?: number;
  reason?: string;
}

export class ElementResolver {
  constructor(private readonly cdp: CDPManager) {}

  public async resolveAtPoint(
    tabId: string,
    webContents: WebContents,
    x: number,
    y: number
  ): Promise<ResolvedElementCheck> {
    const expr = `(() => {
      let el = document.elementFromPoint(${Number(x)}, ${Number(y)});
      while (el && el.shadowRoot && typeof el.shadowRoot.elementFromPoint === 'function') {
        const inner = el.shadowRoot.elementFromPoint(${Number(x)}, ${Number(y)});
        if (!inner || inner === el) break;
        el = inner;
      }
      if (!el) {
        return { exists: false, visible: false, interactable: false, coveredByOverlay: false, confidence: 0, reason: 'No DOM element at visual coordinates' };
      }
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      const visible = rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      const disabled = Boolean(el.disabled) || el.getAttribute('aria-disabled') === 'true';
      const labelText = (el.innerText || el.textContent || el.getAttribute('aria-label') || el.value || '').trim();
      const inputType = (el.getAttribute('type') || '').toLowerCase();
      const isSensitiveField = inputType === 'password' || /card|cvv|cvc|ssn|secret|token/i.test((el.name || '') + ' ' + (el.id || ''));
      const isSensitiveAction = (el.tagName === 'BUTTON' && el.type === 'submit') || /submit|checkout|pay|purchase|buy now|place order|delete|remove|send|confirm/i.test(labelText);
      return {
        exists: true,
        visible,
        interactable: visible && !disabled,
        coveredByOverlay: false,
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute('role') || el.tagName.toLowerCase(),
        text: labelText.slice(0, 200),
        center: { x: Math.round(${Number(x)}), y: Math.round(${Number(y)}) },
        boundingBox: { x: Math.round(rect.left), y: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) },
        isSensitiveField,
        isSensitiveAction,
        confidence: visible && !disabled ? 0.85 : 0.3
      };
    })()`;
    return this.cdp.evaluateInternal<ResolvedElementCheck>(tabId, webContents, expr);
  }

  public async resolveTarget(
    tabId: string,
    webContents: WebContents,
    target: { atlasId?: string; selector?: string; text?: string }
  ): Promise<ResolvedElementCheck> {
    const payload = JSON.stringify(target);
    const expr = `(() => {
      const target = ${payload};
      const findDeep = (root, predicate) => {
        const stack = [root];
        while (stack.length > 0) {
          const cur = stack.shift();
          if (!cur) continue;
          const all = cur.querySelectorAll ? cur.querySelectorAll('*') : [];
          for (const el of all) {
            if (predicate(el)) return el;
            if (el.shadowRoot) stack.push(el.shadowRoot);
            if (el.tagName === 'IFRAME') {
              try {
                if (el.contentDocument) stack.push(el.contentDocument);
              } catch (_) {}
            }
          }
        }
        return null;
      };

      let el = null;
      if (target.atlasId) {
        el = findDeep(document, (n) => n.getAttribute && n.getAttribute('data-atlas-id') === target.atlasId);
      }
      if (!el && target.selector) {
        try {
          el = document.querySelector(target.selector);
        } catch (_) {}
        if (!el) {
          el = findDeep(document, (n) => {
            try { return n.matches && n.matches(target.selector); } catch (_) { return false; }
          });
        }
      }
      if (!el && target.text) {
        const needle = target.text.trim().toLowerCase();
        el = findDeep(document, (n) => {
          const tag = n.tagName;
          if (!['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL'].includes(tag) && n.getAttribute('role') !== 'button') {
            return false;
          }
          const txt = (n.innerText || n.textContent || n.getAttribute('aria-label') || n.value || '').trim().toLowerCase();
          return txt === needle || txt.includes(needle);
        });
      }

      if (!el) {
        return { exists: false, visible: false, interactable: false, coveredByOverlay: false, reason: 'Element not found in DOM/ShadowDOM/same-origin iframes' };
      }

      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      const visible =
        rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== 'hidden' &&
        style.display !== 'none' &&
        parseFloat(style.opacity || '1') > 0;

      const disabled = Boolean(el.disabled) || el.getAttribute('aria-disabled') === 'true';
      const interactable = visible && !disabled;

      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      let coveredByOverlay = false;
      let overlayDescription = undefined;
      const doc = el.ownerDocument || document;
      // Pierce Shadow DOM boundaries recursively so shadow hosts are not misclassified as overlays
      let topEl = doc.elementFromPoint(cx, cy);
      while (topEl && topEl.shadowRoot && typeof topEl.shadowRoot.elementFromPoint === 'function') {
        const inner = topEl.shadowRoot.elementFromPoint(cx, cy);
        if (!inner || inner === topEl) break;
        topEl = inner;
      }
      if (topEl && topEl !== el && !el.contains(topEl) && !topEl.contains(el)) {
        coveredByOverlay = true;
        overlayDescription = topEl.tagName.toLowerCase() + (topEl.id ? '#' + topEl.id : '');
      }

      // Compute iframe offset if element is inside a same-origin iframe
      let offsetX = 0;
      let offsetY = 0;
      let win = el.ownerDocument.defaultView;
      while (win && win !== window && win.frameElement) {
        const fRect = win.frameElement.getBoundingClientRect();
        offsetX += fRect.left;
        offsetY += fRect.top;
        win = win.parent;
      }

      const inputType = (el.getAttribute('type') || '').toLowerCase();
      const isSensitiveField =
        inputType === 'password' ||
        /card|cvv|cvc|ssn|secret|token/i.test((el.name || '') + ' ' + (el.id || '') + ' ' + (el.placeholder || ''));
      const labelText = (el.innerText || el.textContent || el.getAttribute('aria-label') || el.value || '').trim();
      const isSensitiveAction =
        el.tagName === 'BUTTON' && el.type === 'submit' ||
        /submit|checkout|pay|purchase|buy now|place order|delete|remove|send|confirm/i.test(labelText);

      return {
        exists: true,
        visible,
        interactable,
        coveredByOverlay,
        overlayDescription,
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute('role') || el.tagName.toLowerCase(),
        text: labelText.slice(0, 200),
        center: { x: Math.round(cx + offsetX), y: Math.round(cy + offsetY) },
        boundingBox: {
          x: Math.round(rect.left + offsetX),
          y: Math.round(rect.top + offsetY),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        },
        isSensitiveField,
        isSensitiveAction,
        confidence: (visible && !disabled && !coveredByOverlay ? 0.7 : 0.25) + (target.atlasId ? 0.25 : 0.15)
      };
    })()`;

    return this.cdp.evaluateInternal<ResolvedElementCheck>(tabId, webContents, expr);
  }
}
