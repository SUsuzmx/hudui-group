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

export function playMsgSound({ force = false } = {}) {
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('hudui_msg_sound') === '0') return;
    // 前台也提示（对齐微信）；force 可用于强制
    if (!force && typeof document !== 'undefined' && document.hidden) {
      // 后台由系统通知发声，这里仍轻提示
    }
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    o.type = 'sine';
    o.frequency.setValueAtTime(880, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.07);
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.05, ctx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);
    o.start();
    o.stop(ctx.currentTime + 0.14);
    setTimeout(() => ctx.close?.().catch(() => {}), 200);
  } catch { /* ignore */ }
}

/** 发送成功时的轻提示（比接收更短） */
export function playSendSound() {
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('hudui_msg_sound') === '0') return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    o.type = 'triangle';
    o.frequency.value = 520;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.03, ctx.currentTime + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.08);
    o.start();
    o.stop(ctx.currentTime + 0.09);
    setTimeout(() => ctx.close?.().catch(() => {}), 150);
  } catch { /* ignore */ }
}

export { permission as notifyPermission };
