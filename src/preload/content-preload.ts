import { ipcRenderer } from 'electron';

// Minimal isolated preload for untrusted web pages.
// Exposes ZERO globals onto window and ONLY forwards text selection bounding coordinates to main.
let lastSent = '';
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function reportSelection() {
  try {
    const sel = window.getSelection();
    const text = (sel?.toString() || '').trim();
    if (!text) {
      if (lastSent !== '') {
        lastSent = '';
        ipcRenderer.send('lavray:content:selection', { text: '', x: 0, y: 0 });
      }
      return;
    }
    if (text.length > 9000) return;
    if (sel && sel.rangeCount > 0) {
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      lastSent = text;
      ipcRenderer.send('lavray:content:selection', {
        text,
        x: Math.max(0, Math.round(rect.left + rect.width / 2)),
        y: Math.max(0, Math.round(rect.top))
      });
    }
  } catch {
    // Never interfere with host page behavior
  }
}

window.addEventListener(
  'mouseup',
  () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(reportSelection, 140);
  },
  { passive: true }
);

window.addEventListener(
  'keyup',
  () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(reportSelection, 180);
  },
  { passive: true }
);
