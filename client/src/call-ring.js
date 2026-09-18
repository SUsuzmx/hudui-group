// 来电铃声 + 震动
let ctx = null;
let nodes = [];
let ringing = false;
let vibrateTimer = null;

function ensureCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  return ctx;
}

function beep(freq, durationMs, when = 0) {
  const ac = ensureCtx();
  if (!ac) return;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.value = 0.0001;
  osc.connect(gain);
  gain.connect(ac.destination);
  const t0 = ac.currentTime + when / 1000;
  osc.start(t0);
  gain.gain.exponentialRampToValueAtTime(0.08, t0 + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + durationMs / 1000);
  osc.stop(t0 + durationMs / 1000 + 0.02);
  nodes.push(osc);
}

function ringLoop() {
  if (!ringing) return;
  beep(880, 180, 0);
  beep(660, 180, 220);
  if (navigator.vibrate) {
    try { navigator.vibrate([200, 100, 200, 100, 200]); } catch { /* ignore */ }
  }
  vibrateTimer = setTimeout(ringLoop, 1400);
}

export function startRingtone() {
  if (ringing) return;
  ringing = true;
  try { ensureCtx()?.resume?.(); } catch { /* ignore */ }
  ringLoop();
}

export function stopRingtone() {
  ringing = false;
  if (vibrateTimer) clearTimeout(vibrateTimer);
  vibrateTimer = null;
  try { navigator.vibrate?.(0); } catch { /* ignore */ }
  for (const n of nodes) {
    try { n.stop(); } catch { /* ignore */ }
  }
  nodes = [];
}

export function isRinging() {
  return ringing;
}
