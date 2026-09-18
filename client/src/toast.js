export function toast(msg, ms = 2200) {
  if (typeof window !== 'undefined' && typeof window.__huduiToast === 'function') {
    window.__huduiToast(msg, ms);
    return;
  }
  // 兜底
  try { console.log('[toast]', msg); } catch { /* ignore */ }
}
