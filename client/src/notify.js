// 后台消息通知
let permission = typeof Notification !== 'undefined' ? Notification.permission : 'denied';

export async function ensureNotifyPermission() {
  if (typeof Notification === 'undefined') return false;
  if (Notification.permission === 'granted') {
    permission = 'granted';
    return true;
  }
  if (Notification.permission === 'denied') return false;
  try {
    const p = await Notification.requestPermission();
    permission = p;
    return p === 'granted';
  } catch {
    return false;
  }
}

export function notifyMessage({ title, body, tag } = {}) {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission !== 'granted') return;
  if (typeof document !== 'undefined' && !document.hidden) return;
  try {
    const n = new Notification(title || '微信', {
      body: body || '',
      tag: tag || 'hudui-msg',
      icon: '/icon-192.png',
      silent: false,
    });
    n.onclick = () => {
      try { window.focus(); } catch { /* ignore */ }
      n.close();
    };
  } catch { /* ignore */ }
}

export function playMsgSound() {
  try {
    if (typeof document === 'undefined' || !document.hidden) return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    o.frequency.value = 880;
    g.gain.value = 0.04;
    o.start();
    o.stop(ctx.currentTime + 0.08);
  } catch { /* ignore */ }
}

export { permission as notifyPermission };
