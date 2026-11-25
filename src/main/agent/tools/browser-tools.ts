import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { WebContents } from 'electron';
import { isAllowedNavigationUrl } from '@main/browser/tab-manager';
import { isSensitiveTarget } from '@main/security/permission-gate';
import type { RegisteredTool, ToolExecutionContext, ToolOutcome, ToolRegistry } from '../tool-registry';

function requireTabWc(ctx: ToolExecutionContext, requestedTabId?: unknown): { tabId: string; wc: WebContents } {
  const tabId = typeof requestedTabId === 'string' && requestedTabId ? requestedTabId : ctx.tabId;
  const wc = ctx.tabManager.getWebContents(tabId);
  if (!wc) {
    throw new Error(`Invalid or closed tab ID: ${tabId}`);
  }
  return { tabId, wc };
}

function isSensitiveHostFilePath(filePath: string): boolean {
  const resolved = path.resolve(filePath);
  const home = os.homedir();
  const forbiddenPrefixes = [
    path.join(home, '.ssh'),
    path.join(home, '.aws'),
    path.join(home, '.gnupg'),
    '/etc',
    '/System',
    '/private/etc',
    'C:\\Windows'
  ];
  return forbiddenPrefixes.some((p) => resolved === p || resolved.startsWith(p + path.sep));
}

async function resolveAndVerifyElement(
  ctx: ToolExecutionContext,
  tabId: string,
  wc: WebContents,
  args: Record<string, unknown>
) {
  const atlasId = typeof args.atlasId === 'string' ? args.atlasId : undefined;
  const selector = typeof args.selector === 'string' ? args.selector : undefined;
  const text = typeof args.text === 'string' ? args.text : undefined;
  if (!atlasId && !selector && !text) {
    throw new Error('Provide at least one target identifier: atlasId, selector, or text');
  }
  const check = await ctx.resolver.resolveTarget(tabId, wc, { atlasId, selector, text });
  if (!check.exists) {
    throw new Error(check.reason || 'Target element no longer exists (stale reference)');
  }
  if (!check.visible) {
    throw new Error(`Target element <${check.tag}> is not visible`);
  }
  if (!check.interactable) {
    throw new Error(`Target element <${check.tag}> is disabled or non-interactable`);
  }
  if (check.coveredByOverlay) {
    throw new Error(`Target element is covered by overlay "${check.overlayDescription}"`);
  }
  return check;
}

export function registerAllBrowserTools(registry: ToolRegistry): void {
  const tools: RegisteredTool[] = [
    {
      name: 'navigate',
      description: 'Navigate the active or specified tab to a URL or search query.',
      baseTier: 'interact',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', minLength: 1 },
          tabId: { type: 'string' }
        },
        required: ['url'],
        additionalProperties: false
      },
      validate: (args) => {
        const u = String(args.url || '').trim();
        if (!u) return 'URL cannot be empty';
        if (/^(javascript|vbscript|electron):/i.test(u)) return 'Unsafe URL scheme rejected';
        return null;
      },
      execute: async (args, ctx): Promise<ToolOutcome> => {
        const { tabId, wc } = requireTabWc(ctx, args.tabId);
        const before = ctx.lastPerception;
        const target = String(args.url);
        if (!isAllowedNavigationUrl(target) && !target.includes(' ') && target.includes('.')) {
          // Will be resolved by TabManager.navigate
        }
        const finalUrl = await ctx.tabManager.navigate(tabId, target);
        await new Promise((r) => setTimeout(r, 250));
        const after = await ctx.perception.capture(tabId, wc);
        ctx.updateLastPerception(after);
        return {
          success: true,
          data: { url: finalUrl, title: after.title },
          pageDiff: ctx.perception.computeDiff(before, after)
        };
      }
    },
    {
      name: 'click',
      description: 'Click an element on the page identified by atlasId, CSS selector, or visible text.',
      baseTier: 'interact',
      parameters: {
        type: 'object',
        properties: {
          atlasId: { type: 'string' },
          selector: { type: 'string' },
          text: { type: 'string' },
          tabId: { type: 'string' }
        },
        additionalProperties: false
      },
      resolveTier: async (args, ctx) => {
        const { tabId, wc } = requireTabWc(ctx, args.tabId);
        const check = await ctx.resolver.resolveTarget(tabId, wc, {
          atlasId: args.atlasId as string | undefined,
          selector: args.selector as string | undefined,
          text: args.text as string | undefined
        });
        const label = check.text || String(args.text || args.selector || args.atlasId || 'element');
        const sensitive = Boolean(check.isSensitiveAction) || isSensitiveTarget(label);
        return {
          tier: sensitive ? 'sensitive' : 'interact',
          targetDescription: `<${check.tag || 'element'}> "${label}"`,
          submittedDataSummary: 'Click action',
          expectedConsequence: sensitive
            ? 'May submit a form, trigger a purchase, delete data, or send a message.'
            : 'Triggers click navigation or UI state update.',
          reversible: !sensitive
        };
      },
      execute: async (args, ctx) => {
        const { tabId, wc } = requireTabWc(ctx, args.tabId);
        const before = ctx.lastPerception ?? (await ctx.perception.capture(tabId, wc));
        const check = await resolveAndVerifyElement(ctx, tabId, wc, args);
        if (!check.center) throw new Error('Could not resolve element coordinates');
        await ctx.cdp.clickAt(tabId, wc, check.center.x, check.center.y);
        await new Promise((r) => setTimeout(r, 300));
        const after = await ctx.perception.capture(tabId, wc);
        ctx.updateLastPerception(after);
        return {
          success: true,
          data: { clicked: check.text || check.tag, url: after.url, title: after.title },
          pageDiff: ctx.perception.computeDiff(before, after)
        };
      }
    },
    {
      name: 'type',
      description: 'Focus an input element and type text into it.',
      baseTier: 'interact',
      parameters: {
        type: 'object',
        properties: {
          atlasId: { type: 'string' },
          selector: { type: 'string' },
          text: { type: 'string' },
          value: { type: 'string' },
          clearFirst: { type: 'boolean' },
          pressEnter: { type: 'boolean' },
          tabId: { type: 'string' }
        },
        required: ['value'],
        additionalProperties: false
      },
      resolveTier: async (args, ctx) => {
        const { tabId, wc } = requireTabWc(ctx, args.tabId);
        const check = await ctx.resolver.resolveTarget(tabId, wc, {
          atlasId: args.atlasId as string | undefined,
          selector: args.selector as string | undefined,
          text: args.text as string | undefined
        });
        const sensitive = Boolean(check.isSensitiveField);
        return {
          tier: sensitive ? 'sensitive' : 'interact',
          targetDescription: `<${check.tag || 'input'}> ${check.text || String(args.selector || args.atlasId || '')}`,
          submittedDataSummary: sensitive ? '[REDACTED SENSITIVE INPUT]' : String(args.value).slice(0, 80),
          expectedConsequence: sensitive
            ? 'Enters sensitive credential or payment data into a form field.'
            : 'Populates text into the form field.',
          reversible: true
        };
      },
      execute: async (args, ctx) => {
        const { tabId, wc } = requireTabWc(ctx, args.tabId);
        const before = ctx.lastPerception ?? (await ctx.perception.capture(tabId, wc));
        const check = await resolveAndVerifyElement(ctx, tabId, wc, args);
        if (!check.center) throw new Error('Missing element center');
        await ctx.cdp.clickAt(tabId, wc, check.center.x, check.center.y);
        if (args.clearFirst !== false) {
          const selectorExpr = args.atlasId
            ? `[data-atlas-id="${String(args.atlasId).replace(/"/g, '')}"]`
            : String(args.selector || '');
          if (selectorExpr) {
            await ctx.cdp.evaluateInternal(
              tabId,
              wc,
              `(() => { const el = document.querySelector(${JSON.stringify(selectorExpr)}); if (el && 'value' in el) { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); } })()`
            );
          }
        }
        await ctx.cdp.insertText(tabId, wc, String(args.value));
        if (args.pressEnter) {
          await ctx.cdp.pressKey(tabId, wc, 'Enter');
          await new Promise((r) => setTimeout(r, 250));
        }
        const after = await ctx.perception.capture(tabId, wc);
        ctx.updateLastPerception(after);
        return {
          success: true,
          data: { typedLength: String(args.value).length, url: after.url },
          pageDiff: ctx.perception.computeDiff(before, after)
        };
      }
    },
    {
      name: 'select',
      description: 'Select an option in a <select> dropdown by value or visible label.',
      baseTier: 'interact',
      parameters: {
        type: 'object',
        properties: {
          atlasId: { type: 'string' },
          selector: { type: 'string' },
          optionValue: { type: 'string' },
          tabId: { type: 'string' }
        },
        required: ['optionValue'],
        additionalProperties: false
      },
      execute: async (args, ctx) => {
        const { tabId, wc } = requireTabWc(ctx, args.tabId);
        const before = ctx.lastPerception ?? (await ctx.perception.capture(tabId, wc));
        await resolveAndVerifyElement(ctx, tabId, wc, args);
        const targetSel = args.atlasId
          ? `[data-atlas-id="${String(args.atlasId).replace(/"/g, '')}"]`
          : String(args.selector);
        const selected = await ctx.cdp.evaluateInternal<string | null>(
          tabId,
          wc,
          `(() => {
            const sel = document.querySelector(${JSON.stringify(targetSel)});
            if (!sel || sel.tagName !== 'SELECT') return null;
            const target = ${JSON.stringify(String(args.optionValue))};
            for (const opt of sel.options) {
              if (opt.value === target || opt.text.trim() === target) {
                sel.value = opt.value;
                sel.dispatchEvent(new Event('change', { bubbles: true }));
                return opt.value;
              }
            }
            return null;
          })()`
        );
        if (selected === null) {
          return { success: false, error: `Option "${args.optionValue}" not found in <select>` };
        }
        const after = await ctx.perception.capture(tabId, wc);
        ctx.updateLastPerception(after);
        return {
          success: true,
          data: { selected },
          pageDiff: ctx.perception.computeDiff(before, after)
        };
      }
    },
    {
      name: 'scroll',
      description: 'Scroll the page up, down, to top, or to bottom.',
      baseTier: 'interact',
      parameters: {
        type: 'object',
        properties: {
          direction: { type: 'string', enum: ['down', 'up', 'top', 'bottom'] },
          amountPx: { type: 'number', minimum: 50, maximum: 5000 },
          tabId: { type: 'string' }
        },
        required: ['direction'],
        additionalProperties: false
      },
      execute: async (args, ctx) => {
        const { tabId, wc } = requireTabWc(ctx, args.tabId);
        const before = ctx.lastPerception ?? (await ctx.perception.capture(tabId, wc));
        const px = Number(args.amountPx ?? 600);
        const dir = String(args.direction);
        await ctx.cdp.evaluateInternal(
          tabId,
          wc,
          `(() => {
            if ('${dir}' === 'top') window.scrollTo({ top: 0, behavior: 'instant' });
            else if ('${dir}' === 'bottom') window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
            else if ('${dir}' === 'up') window.scrollBy({ top: -${px}, behavior: 'instant' });
            else window.scrollBy({ top: ${px}, behavior: 'instant' });
          })()`
        );
        await new Promise((r) => setTimeout(r, 150));
        const after = await ctx.perception.capture(tabId, wc);
        ctx.updateLastPerception(after);
        return {
          success: true,
          data: { viewport: after.viewport },
          pageDiff: ctx.perception.computeDiff(before, after)
        };
      }
    },
    {
      name: 'hover',
      description: 'Hover the pointer over an element.',
      baseTier: 'interact',
      parameters: {
        type: 'object',
        properties: {
          atlasId: { type: 'string' },
          selector: { type: 'string' },
          text: { type: 'string' },
          tabId: { type: 'string' }
        },
        additionalProperties: false
      },
      execute: async (args, ctx) => {
        const { tabId, wc } = requireTabWc(ctx, args.tabId);
        const check = await resolveAndVerifyElement(ctx, tabId, wc, args);
        if (!check.center) throw new Error('Missing element center');
        await ctx.cdp.hoverAt(tabId, wc, check.center.x, check.center.y);
        return { success: true, data: { hovered: check.text || check.tag } };
      }
    },
    {
      name: 'drag',
      description: 'Drag from one element to another element.',
      baseTier: 'interact',
      parameters: {
        type: 'object',
        properties: {
          sourceSelector: { type: 'string' },
          targetSelector: { type: 'string' },
          tabId: { type: 'string' }
        },
        required: ['sourceSelector', 'targetSelector'],
        additionalProperties: false
      },
      execute: async (args, ctx) => {
        const { tabId, wc } = requireTabWc(ctx, args.tabId);
        const src = await ctx.resolver.resolveTarget(tabId, wc, { selector: String(args.sourceSelector) });
        const dst = await ctx.resolver.resolveTarget(tabId, wc, { selector: String(args.targetSelector) });
        if (!src.exists || !src.center || !dst.exists || !dst.center) {
          return { success: false, error: 'Source or target element for drag could not be resolved' };
        }
        await ctx.cdp.dragBetween(tabId, wc, src.center.x, src.center.y, dst.center.x, dst.center.y);
        return { success: true, data: { from: src.center, to: dst.center } };
      }
    },
    {
      name: 'press_key',
      description: 'Press a keyboard key such as Enter, Tab, Escape, ArrowDown, ArrowUp.',
      baseTier: 'interact',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', minLength: 1, maxLength: 32 },
          tabId: { type: 'string' }
        },
        required: ['key'],
        additionalProperties: false
      },
      execute: async (args, ctx) => {
        const { tabId, wc } = requireTabWc(ctx, args.tabId);
        const before = ctx.lastPerception;
        await ctx.cdp.pressKey(tabId, wc, String(args.key));
        await new Promise((r) => setTimeout(r, 150));
        const after = await ctx.perception.capture(tabId, wc);
        ctx.updateLastPerception(after);
        return {
          success: true,
          data: { pressed: args.key },
          pageDiff: ctx.perception.computeDiff(before, after)
        };
      }
    },
    {
      name: 'wait_for',
      description: 'Wait for a fixed duration (ms) or condition.',
      baseTier: 'read_only',
      parameters: {
        type: 'object',
        properties: {
          ms: { type: 'number', minimum: 50, maximum: 15000 }
        },
        required: ['ms'],
        additionalProperties: false
      },
      execute: async (args) => {
        const ms = Math.min(15000, Math.max(50, Number(args.ms)));
        await new Promise((r) => setTimeout(r, ms));
        return { success: true, data: { waitedMs: ms } };
      }
    },
    {
      name: 'wait_for_element',
      description: 'Wait until a CSS selector appears and becomes visible on the page.',
      baseTier: 'read_only',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', minLength: 1 },
          timeoutMs: { type: 'number', minimum: 200, maximum: 15000 },
          tabId: { type: 'string' }
        },
        required: ['selector'],
        additionalProperties: false
      },
      execute: async (args, ctx) => {
        const { tabId, wc } = requireTabWc(ctx, args.tabId);
        const deadline = Date.now() + Number(args.timeoutMs ?? 6000);
        while (Date.now() < deadline) {
          const check = await ctx.resolver.resolveTarget(tabId, wc, { selector: String(args.selector) });
          if (check.exists && check.visible) {
            return { success: true, data: { found: true, tag: check.tag, text: check.text } };
          }
          await new Promise((r) => setTimeout(r, 250));
        }
        return { success: false, error: `Timed out waiting for element "${args.selector}"` };
      }
    },
    {
      name: 'wait_for_navigation',
      description: 'Wait until the current tab finishes loading.',
      baseTier: 'read_only',
      parameters: {
        type: 'object',
        properties: {
          timeoutMs: { type: 'number', minimum: 200, maximum: 15000 },
          tabId: { type: 'string' }
        },
        additionalProperties: false
      },
      execute: async (args, ctx) => {
        const { wc } = requireTabWc(ctx, args.tabId);
        const deadline = Date.now() + Number(args.timeoutMs ?? 8000);
        while (Date.now() < deadline) {
          if (!wc.isLoading()) {
            return { success: true, data: { url: wc.getURL(), title: wc.getTitle() } };
          }
          await new Promise((r) => setTimeout(r, 200));
        }
        return { success: false, error: 'Timed out waiting for navigation to finish' };
      }
    },
    {
      name: 'read_page',
      description: 'Read structured text, headings, tables, and links from the active or specified tab.',
      baseTier: 'read_only',
      parameters: {
        type: 'object',
        properties: {
          tabId: { type: 'string' }
        },
        additionalProperties: false
      },
      execute: async (args, ctx) => {
        const { tabId, wc } = requireTabWc(ctx, args.tabId);
        const p = await ctx.perception.capture(tabId, wc);
        ctx.updateLastPerception(p);
        return {
          success: true,
          data: {
            url: p.url,
            title: p.title,
            headings: p.headings,
            tablesSummary: p.tablesSummary,
            mainText: p.mainText,
            injectionWarnings: p.injectionWarnings
          }
        };
      }
    },
    {
      name: 'read_selected_text',
      description: 'Read the currently highlighted/selected text on the active tab.',
      baseTier: 'read_only',
      parameters: {
        type: 'object',
        properties: {
          tabId: { type: 'string' }
        },
        additionalProperties: false
      },
      execute: async (args, ctx) => {
        const { tabId, wc } = requireTabWc(ctx, args.tabId);
        const selectedText = await ctx.cdp.evaluateInternal<string>(
          tabId,
          wc,
          'window.getSelection ? window.getSelection().toString() : ""'
        );
        return { success: true, data: { selectedText: selectedText.trim() } };
      }
    },
    {
      name: 'extract',
      description: 'Extract structured content matching a CSS selector or page sections.',
      baseTier: 'read_only',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string' },
          limit: { type: 'number', minimum: 1, maximum: 100 },
          tabId: { type: 'string' }
        },
        additionalProperties: false
      },
      execute: async (args, ctx) => {
        const { tabId, wc } = requireTabWc(ctx, args.tabId);
        const limit = Number(args.limit ?? 30);
        if (args.selector) {
          const items = await ctx.cdp.evaluateInternal<Array<{ text: string; href?: string }>>(
            tabId,
            wc,
            `Array.from(document.querySelectorAll(${JSON.stringify(String(args.selector))})).slice(0, ${limit}).map((el) => ({
              text: (el.innerText || el.textContent || '').trim(),
              href: el.getAttribute ? el.getAttribute('href') || undefined : undefined
            }))`
          );
          return { success: true, data: { count: items.length, items } };
        }
        const p = await ctx.perception.capture(tabId, wc);
        ctx.updateLastPerception(p);
        return {
          success: true,
          data: { url: p.url, title: p.title, headings: p.headings, tables: p.tablesSummary, text: p.mainText }
        };
      }
    },
    {
      name: 'screenshot',
      description: 'Capture a visual screenshot of the current page with Set-of-Marks target coordinates.',
      baseTier: 'read_only',
      parameters: {
        type: 'object',
        properties: {
          tabId: { type: 'string' }
        },
        additionalProperties: false
      },
      execute: async (args, ctx) => {
        const { tabId, wc } = requireTabWc(ctx, args.tabId);
        const p = await ctx.perception.capture(tabId, wc, { includeScreenshot: true });
        ctx.updateLastPerception(p);
        if (p.screenshotBase64 && ctx.onScreenshotCaptured) {
          ctx.onScreenshotCaptured(p.screenshotBase64, p.url, p.viewport.width, p.viewport.height);
        }
        return {
          success: Boolean(p.screenshotBase64),
          data: {
            url: p.url,
            title: p.title,
            somTargetsCount: p.somTargets?.length ?? 0,
            captured: Boolean(p.screenshotBase64)
          },
          error: p.screenshotBase64 ? undefined : 'Failed to capture screenshot'
        };
      }
    },
    {
      name: 'inspect_accessibility',
      description: 'Inspect the browser Accessibility Tree for the current page.',
      baseTier: 'read_only',
      parameters: {
        type: 'object',
        properties: {
          tabId: { type: 'string' }
        },
        additionalProperties: false
      },
      execute: async (args, ctx) => {
        const { tabId, wc } = requireTabWc(ctx, args.tabId);
        const p = await ctx.perception.capture(tabId, wc, { includeAxTree: true });
        ctx.updateLastPerception(p);
        return { success: true, data: { axSummary: p.axSummary } };
      }
    },
    {
      name: 'inspect_dom',
      description: 'Inspect interactive DOM elements (including Shadow DOM and same-origin iframes).',
      baseTier: 'read_only',
      parameters: {
        type: 'object',
        properties: {
          tabId: { type: 'string' }
        },
        additionalProperties: false
      },
      execute: async (args, ctx) => {
        const { tabId, wc } = requireTabWc(ctx, args.tabId);
        const p = await ctx.perception.capture(tabId, wc, { includeAxTree: false });
        ctx.updateLastPerception(p);
        return {
          success: true,
          data: {
            count: p.interactiveElements.length,
            elements: p.interactiveElements.slice(0, 60)
          }
        };
      }
    },
    {
      name: 'find_element',
      description: 'Find an element by selector or text and report its state and bounding box.',
      baseTier: 'read_only',
      parameters: {
        type: 'object',
        properties: {
          atlasId: { type: 'string' },
          selector: { type: 'string' },
          text: { type: 'string' },
          tabId: { type: 'string' }
        },
        additionalProperties: false
      },
      execute: async (args, ctx) => {
        const { tabId, wc } = requireTabWc(ctx, args.tabId);
        const check = await ctx.resolver.resolveTarget(tabId, wc, {
          atlasId: args.atlasId as string | undefined,
          selector: args.selector as string | undefined,
          text: args.text as string | undefined
        });
        return { success: check.exists, data: check, error: check.exists ? undefined : check.reason };
      }
    },
    {
      name: 'get_element_text',
      description: 'Get the text content of a specific element.',
      baseTier: 'read_only',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string' },
          atlasId: { type: 'string' },
          tabId: { type: 'string' }
        },
        additionalProperties: false
      },
      execute: async (args, ctx) => {
        const { tabId, wc } = requireTabWc(ctx, args.tabId);
        const check = await ctx.resolver.resolveTarget(tabId, wc, {
          atlasId: args.atlasId as string | undefined,
          selector: args.selector as string | undefined
        });
        return { success: check.exists, data: { text: check.text ?? '' }, error: check.reason };
      }
    },
    {
      name: 'get_element_attributes',
      description: 'Get attributes of a specific element.',
      baseTier: 'read_only',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', minLength: 1 },
          tabId: { type: 'string' }
        },
        required: ['selector'],
        additionalProperties: false
      },
      execute: async (args, ctx) => {
        const { tabId, wc } = requireTabWc(ctx, args.tabId);
        const attrs = await ctx.cdp.evaluateInternal<Record<string, string> | null>(
          tabId,
          wc,
          `(() => {
            const el = document.querySelector(${JSON.stringify(String(args.selector))});
            if (!el) return null;
            const out = {};
            for (const a of el.attributes) {
              out[a.name] = el.type === 'password' && a.name === 'value' ? '[MASKED]' : a.value;
            }
            return out;
          })()`
        );
        return attrs
          ? { success: true, data: attrs }
          : { success: false, error: `Element "${args.selector}" not found` };
      }
    },
    {
      name: 'get_current_url',
      description: 'Get the current URL of the active or specified tab.',
      baseTier: 'read_only',
      parameters: {
        type: 'object',
        properties: { tabId: { type: 'string' } },
        additionalProperties: false
      },
      execute: async (args, ctx) => {
        const { wc } = requireTabWc(ctx, args.tabId);
        return { success: true, data: { url: wc.getURL() } };
      }
    },
    {
      name: 'get_page_title',
      description: 'Get the current title of the active or specified tab.',
      baseTier: 'read_only',
      parameters: {
        type: 'object',
        properties: { tabId: { type: 'string' } },
        additionalProperties: false
      },
      execute: async (args, ctx) => {
        const { wc } = requireTabWc(ctx, args.tabId);
        return { success: true, data: { title: wc.getTitle() } };
      }
    },
    {
      name: 'capture_page_diff',
      description: 'Capture current page perception and compute diff from previous observation.',
      baseTier: 'read_only',
      parameters: {
        type: 'object',
        properties: { tabId: { type: 'string' } },
        additionalProperties: false
      },
      execute: async (args, ctx) => {
        const { tabId, wc } = requireTabWc(ctx, args.tabId);
        const before = ctx.lastPerception;
        const after = await ctx.perception.capture(tabId, wc);
        ctx.updateLastPerception(after);
        const diff = ctx.perception.computeDiff(before, after);
        return { success: true, data: diff, pageDiff: diff };
      }
    },
    {
      name: 'open_tab',
      description: 'Open a new browser tab, optionally navigating to a URL.',
      baseTier: 'interact',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          activate: { type: 'boolean' }
        },
        additionalProperties: false
      },
      execute: async (args, ctx) => {
        const currentTab = ctx.tabManager.getTab(ctx.tabId);
        const windowId = currentTab?.info.windowId ?? ctx.tabManager.getDefaultWindowId();
        if (windowId === null) throw new Error('No active browser window');
        const created = ctx.tabManager.createTab(windowId, {
          url: args.url ? String(args.url) : 'about:blank',
          activate: args.activate !== false
        });
        if (args.activate !== false) {
          ctx.setActiveTabId(created.id);
        }
        return { success: true, data: { tabId: created.id, url: created.url } };
      }
    },
    {
      name: 'switch_tab',
      description: 'Switch focus to another open tab by tabId.',
      baseTier: 'interact',
      parameters: {
        type: 'object',
        properties: {
          tabId: { type: 'string', minLength: 1 }
        },
        required: ['tabId'],
        additionalProperties: false
      },
      execute: async (args, ctx) => {
        const targetId = String(args.tabId);
        const ok = ctx.tabManager.activateTab(targetId);
        if (!ok) return { success: false, error: `Tab not found: ${targetId}` };
        ctx.setActiveTabId(targetId);
        const wc = ctx.tabManager.getWebContents(targetId);
        if (wc) {
          const p = await ctx.perception.capture(targetId, wc);
          ctx.updateLastPerception(p);
        }
        return { success: true, data: { activeTabId: targetId } };
      }
    },
    {
      name: 'close_tab',
      description: 'Close an open tab by tabId.',
      baseTier: 'interact',
      parameters: {
        type: 'object',
        properties: {
          tabId: { type: 'string', minLength: 1 }
        },
        required: ['tabId'],
        additionalProperties: false
      },
      execute: async (args, ctx) => {
        const targetId = String(args.tabId);
        const ok = ctx.tabManager.closeTab(targetId);
        return ok
          ? { success: true, data: { closedTabId: targetId } }
          : { success: false, error: `Tab not found: ${targetId}` };
      }
    },
    {
      name: 'compare_tabs',
      description: 'Read and summarize multiple open tabs for side-by-side comparison.',
      baseTier: 'read_only',
      parameters: {
        type: 'object',
        properties: {
          tabIds: { type: 'array', items: { type: 'string' } }
        },
        additionalProperties: false
      },
      execute: async (args, ctx) => {
        const requestedIds = Array.isArray(args.tabIds) && args.tabIds.length > 0
          ? args.tabIds.map(String)
          : ctx.tabManager.getAllTabs().map((t) => t.id).slice(0, 6);

        const comparisons: Array<{ tabId: string; url: string; title: string; headings: string[]; excerpt: string }> = [];
        for (const id of requestedIds) {
          const wc = ctx.tabManager.getWebContents(id);
          if (!wc) continue;
          const p = await ctx.perception.capture(id, wc, { includeAxTree: false });
          comparisons.push({
            tabId: id,
            url: p.url,
            title: p.title,
            headings: p.headings.slice(0, 8),
            excerpt: p.mainText.slice(0, 2500)
          });
        }
        return { success: true, data: { comparedTabs: comparisons } };
      }
    },
    {
      name: 'search_history',
      description: 'Search local browser history (disabled in private browsing).',
      baseTier: 'read_only',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          limit: { type: 'number', minimum: 1, maximum: 50 }
        },
        additionalProperties: false
      },
      execute: async (args, ctx) => {
        if (ctx.isPrivate) {
          return { success: true, data: { entries: [], note: 'History search disabled in private browsing' } };
        }
        const entries = ctx.browserRepo.searchHistory(String(args.query ?? ''), Number(args.limit ?? 15));
        return { success: true, data: { entries } };
      }
    },
    {
      name: 'search_bookmarks',
      description: 'Search saved bookmarks.',
      baseTier: 'read_only',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' }
        },
        additionalProperties: false
      },
      execute: async (args, ctx) => {
        const res = ctx.browserRepo.listBookmarks(String(args.query ?? ''));
        return { success: true, data: res };
      }
    },
    {
      name: 'upload_file',
      description: 'Attach a local file to a file input element (requires sensitive confirmation).',
      baseTier: 'sensitive',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', minLength: 1 },
          filePath: { type: 'string', minLength: 1 },
          tabId: { type: 'string' }
        },
        required: ['selector', 'filePath'],
        additionalProperties: false
      },
      validate: (args) => {
        const fp = String(args.filePath);
        if (isSensitiveHostFilePath(fp)) return `Refusing sensitive host file path: ${fp}`;
        if (!fs.existsSync(fp)) return `File does not exist: ${fp}`;
        return null;
      },
      resolveTier: async (args) => ({
        tier: 'sensitive',
        targetDescription: `File input ${String(args.selector)}`,
        submittedDataSummary: path.basename(String(args.filePath)),
        expectedConsequence: 'Uploads a local file from disk to the remote website.',
        reversible: false
      }),
      execute: async (args, ctx) => {
        const { tabId, wc } = requireTabWc(ctx, args.tabId);
        const doc = await ctx.cdp.sendCommand<{ root: { nodeId: number } }>(tabId, wc, 'DOM.getDocument', {});
        const queried = await ctx.cdp.sendCommand<{ nodeId: number }>(tabId, wc, 'DOM.querySelector', {
          nodeId: doc.root.nodeId,
          selector: String(args.selector)
        });
        if (!queried.nodeId) {
          return { success: false, error: `File input "${args.selector}" not found` };
        }
        await ctx.cdp.sendCommand(tabId, wc, 'DOM.setFileInputFiles', {
          nodeId: queried.nodeId,
          files: [path.resolve(String(args.filePath))]
        });
        return { success: true, data: { uploaded: path.basename(String(args.filePath)) } };
      }
    },
    {
      name: 'download_file',
      description: 'Trigger download of a URL into the configured downloads directory.',
      baseTier: 'sensitive',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', minLength: 1 },
          tabId: { type: 'string' }
        },
        required: ['url'],
        additionalProperties: false
      },
      validate: (args) => {
        const u = String(args.url);
        if (!/^https?:\/\//i.test(u)) return 'Only http/https downloads are permitted';
        return null;
      },
      resolveTier: async (args) => ({
        tier: 'sensitive',
        targetDescription: String(args.url),
        submittedDataSummary: 'Download file',
        expectedConsequence: 'Downloads a remote file to local disk (subject to download safety checks).',
        reversible: true
      }),
      execute: async (args, ctx) => {
        const { wc } = requireTabWc(ctx, args.tabId);
        wc.downloadURL(String(args.url));
        return { success: true, data: { initiated: String(args.url) } };
      }
    },
    {
      name: 'run_page_script',
      description: 'Experimental: run a read-only DOM query expression when explicitly enabled & confirmed.',
      baseTier: 'sensitive',
      parameters: {
        type: 'object',
        properties: {
          expression: { type: 'string', minLength: 1, maxLength: 1000 },
          tabId: { type: 'string' }
        },
        required: ['expression'],
        additionalProperties: false
      },
      resolveTier: async (args) => ({
        tier: 'sensitive',
        targetDescription: 'Experimental page-context JavaScript execution',
        submittedDataSummary: String(args.expression).slice(0, 120),
        expectedConsequence: 'Executes limited page-context JavaScript (cannot access Electron internals or local filesystem).',
        reversible: false
      }),
      execute: async (args, ctx) => {
        if (!ctx.experimentalScriptingEnabled) {
          return {
            success: false,
            error: 'Experimental page scripting is disabled by default. Enable it in Settings → Security to use.'
          };
        }
        const { tabId, wc } = requireTabWc(ctx, args.tabId);
        const result = await ctx.cdp.evaluateInternal(tabId, wc, String(args.expression));
        return { success: true, data: { result } };
      }
    }
  ];

  for (const tool of tools) {
    registry.register(tool);
  }
}
