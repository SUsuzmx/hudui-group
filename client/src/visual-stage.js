/**
 * 视觉舞台桥接：本项目播放器 ↔ Mineradio 全局视觉系统
 */
import { api } from './api.js';
import { musicPlayer } from './music-player.js';

let loadPromise = null;
let ready = false;
let lastSongKey = '';
let lyricPollTimer = 0;
let lastError = '';

export function getVisualStageError() { return lastError; }
export function isVisualReady() { return ready; }

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.loadMineradioVisual && (window.__mineradioVisualLoaded || window.__mineradioVisualLoading)) {
      resolve();
      return;
    }
    const s = document.createElement('script');
    s.src = src + (src.includes('?') ? '&' : '?') + 't=' + Date.now();
    s.async = false;
    s.dataset.visual = src;
    let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; reject(new Error('visual-loader.js 加载超时')); } }, 25000);
    s.onload = () => { if (!done) { done = true; clearTimeout(timer); resolve(); } };
    s.onerror = () => { if (!done) { done = true; clearTimeout(timer); reject(new Error('load fail ' + src)); } };
    document.head.appendChild(s);
  });
}

function adoptRendererCanvas() {
  const cc = document.getElementById('canvas-container');
  const el = window.renderer && window.renderer.domElement;
  if (!cc || !el) return false;
  if (!cc.contains(el)) cc.appendChild(el);
  try {
    if (window.renderer?.setSize) {
      window.renderer.setSize(cc.clientWidth || 300, cc.clientHeight || 300, false);
    }
  } catch (e) { /* ignore */ }
  el.style.width = '100%';
  el.style.height = '100%';
  el.style.display = 'block';
  return true;
}

function forceParticleVisible() {
  try {
    if (window.uniforms?.uAlpha && !(window.uniforms.uAlpha.value > 0.01)) window.uniforms.uAlpha.value = 0.96;
    if (window.uniforms?.uParticleDim) window.uniforms.uParticleDim.value = 1;
    if (window.fx) window.fx.particleLyrics = true;
    if (window.particles) window.particles.visible = true;
  } catch (e) { /* ignore */ }
}

function particlesActive() {
  try {
    return !!(window.particles && window.particles.visible !== false);
  } catch { return false; }
}

function bindStageGestures(root) {
  if (!root || root.__visualGestureBound) return;
  root.__visualGestureBound = true;
  const pointers = new Map();
  let lastDist = 0;
  const isUi = (e) => {
    const el = e.target;
    return !!(el && el.closest && el.closest('.bar, .fx-dock, .queue-sheet, button, input'));
  };
  const onDown = (e) => {
    if (isUi(e)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const orbit = window.orbit;
    if (pointers.size === 1 && orbit) {
      orbit.rotating = true;
      orbit.centerLocked = false;
      orbit.recentering = false;
      orbit.last.x = e.clientX;
      orbit.last.y = e.clientY;
    }
    if (pointers.size === 2) {
      const pts = [...pointers.values()];
      lastDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    }
  };
  const onMove = (e) => {
    if (!pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const orbit = window.orbit;
    if (!orbit) return;
    if (pointers.size >= 2) {
      const pts = [...pointers.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (lastDist > 0 && dist > 0) {
        const scale = lastDist / dist;
        orbit.userRadius = Math.min(orbit.maxRadius || 14, Math.max(orbit.minRadius || 2.4, (orbit.userRadius || 6.6) * scale));
        orbit.radius = orbit.userRadius;
      }
      lastDist = dist;
      return;
    }
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    orbit.rotating = true;
    orbit.centerLocked = false;
    orbit.recentering = false;
    // 相机轨道（updateFreeCamera / updateCinema 读 userTheta/userPhi/radius）
    orbit.userTheta = (orbit.userTheta || 0) - dx * 0.006;
    orbit.userPhi = Math.min(orbit.maxPhi ?? 1.4, Math.max(orbit.minPhi ?? -1.4, (orbit.userPhi || 0.08) + dy * 0.004));
    orbit.theta = orbit.userTheta;
    orbit.phi = orbit.userPhi;
    orbit.last.x = e.clientX;
    orbit.last.y = e.clientY;
    // 粒子层旋转：主循环用 gestureRotation，不读 orbit.userTheta
    const gr = window.gestureRotation;
    if (gr) {
      gr.y = (gr.y || 0) - dx * 0.006;
      gr.x = Math.max(-0.8, Math.min(0.8, (gr.x || 0) + dy * 0.004));
    }
    // 部分预设走 applyParticleSpinDrag（内部再写 orbit/particles）
    try {
      if (typeof window.applyParticleSpinDrag === 'function' && particlesActive()) {
        const dt = 1 / 60;
        window.applyParticleSpinDrag(dx, dy, dt);
      }
    } catch { /* ignore */ }
  };
  const onUp = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size === 0 && window.orbit) window.orbit.rotating = false;
    lastDist = 0;
  };
  const onWheel = (e) => {
    if (isUi(e)) return;
    e.preventDefault();
    const orbit = window.orbit;
    if (!orbit) return;
    orbit.userRadius = Math.min(orbit.maxRadius || 14, Math.max(orbit.minRadius || 2.4, (orbit.userRadius || 6.6) * (e.deltaY > 0 ? 1.08 : 0.92)));
    orbit.radius = orbit.userRadius;
    orbit.centerLocked = false;
    orbit.recentering = false;
  };
  root.style.pointerEvents = 'auto';
  root.style.touchAction = 'none';
  root.addEventListener('pointerdown', onDown);
  root.addEventListener('pointermove', onMove);
  root.addEventListener('pointerup', onUp);
  root.addEventListener('pointercancel', onUp);
  root.addEventListener('wheel', onWheel, { passive: false });
}

export function initVisualStage() {
  if (ready && window.THREE) return Promise.resolve(true);
  if (loadPromise && ready) return loadPromise;
  lastError = '';
  loadPromise = (async () => {
    if (!document.getElementById('visual-stage-css')) {
      const link = document.createElement('link');
      link.id = 'visual-stage-css';
      link.rel = 'stylesheet';
      link.href = '/visual/stage-embed.css?t=' + Date.now();
      document.head.appendChild(link);
    }
    const timeout = new Promise((resolve, reject) => {
      const t0 = Date.now();
      const poll = setInterval(() => {
        if (window.THREE && (window.particles || window.renderer)) { clearInterval(poll); resolve(true); return; }
        if (Date.now() - t0 > 55000) { clearInterval(poll); reject(new Error('视觉引擎加载超时（60s）')); }
      }, 400);
    });
    const work = (async () => {
      await loadScript('/visual/visual-loader.js');
      if (typeof window.loadMineradioVisual !== 'function') throw new Error('visual-loader 未导出 loadMineradioVisual');
      await window.loadMineradioVisual();
      const el = musicPlayer.ensureAudio();
      window.audio = el;
      window.musicPlayerToggle = () => musicPlayer.togglePlay();
      window.musicPlayerNext = () => musicPlayer.nextTrack();
      window.musicPlayerPrev = () => musicPlayer.prevTrack();
      const sync = () => { window.playing = musicPlayer.state.playing; };
      el.addEventListener('play', sync);
      el.addEventListener('pause', sync);
      sync();
      adoptRendererCanvas();
      forceParticleVisible();
      bindStageGestures(document.getElementById('canvas-container') || document.querySelector('.visual-stage-root'));
      // 默认丝绸/封面粒子（或用户上次选择），无需手动点 FX
      ensureDefaultPreset();
      ready = true;
      return true;
    })();
    return Promise.race([work, timeout]);
  })().then((ok) => ok).catch((e) => {
    lastError = e.message || String(e);
    loadPromise = null;
    ready = false;
    throw e;
  });
  return loadPromise;
}

function absoluteCover(cover) {
  if (!cover) return '';
  if (/^(https?:|data:|blob:)/i.test(cover)) return cover;
  if (cover.startsWith('/')) return location.origin + cover;
  return cover;
}

export function syncTrackToVisual(track) {
  if (!ready || !track) return;
  const key = `${track.source}:${track.id}`;
  const cover = absoluteCover(track.cover);
  try { ensureDefaultPreset(); } catch (e) { console.warn('[visual] preset', e); }
  try {
    if (typeof window.loadCoverFromUrl === 'function' && cover) {
      window.loadCoverFromUrl(cover, { trackSwitch: key !== lastSongKey });
    }
  } catch (e) { console.warn('[visual] cover', e); }
  const el = musicPlayer.ensureAudio();
  if (window.audio !== el) window.audio = el;
  if (key !== lastSongKey) {
    lastSongKey = key;
    loadLyricsForTrack(track);
  }
  try {
    if (typeof window.initAudio === 'function' && (el.readyState >= 2 || !el.paused)) window.initAudio();
  } catch (e) { console.warn('[visual] initAudio', e); }
}

async function loadLyricsForTrack(track) {
  const provider = track.source === 'netease' ? 'netease' : 'qq';
  try {
    const data = await api.musicProviderLyric(provider, { id: track.id, mid: track.mid || '' });
    applyLrcToVisual(data?.lrc || data?.lyric || '');
  } catch (e) {
    console.warn('[visual] lyric', e);
    applyLrcToVisual('');
  }
}

export function applyLrcToVisual(lrcText) {
  if (!ready) return;
  try {
    if (window.fx) window.fx.particleLyrics = true;
    if (typeof window.parseLyricText === 'function' && lrcText) {
      const raw = window.parseLyricText(lrcText) || [];
      window.lyricsLines = raw.map((l) => ({
        ...l,
        t: Number(l.t ?? l.time ?? 0) || 0,
        text: String(l.text || ''),
        duration: Number(l.duration) || 2,
      }));
      window.lyricsVisible = true;
      window.lyricsTimingSource = 'lrc';
      if (typeof window.createLyricsParticles === 'function') {
        try { window.createLyricsParticles(); } catch (e) { /* ignore */ }
      }
      const el = window.audio || musicPlayer.ensureAudio();
      window.audio = el;
      const t = el?.currentTime || 0;
      let idx = 0;
      for (let i = 0; i < window.lyricsLines.length; i += 1) {
        if (Number(window.lyricsLines[i].t) <= t + 0.05) idx = i;
        else break;
      }
      if (typeof window.showStageLine === 'function' && window.lyricsLines[idx]?.text) {
        window.showStageLine(window.lyricsLines[idx].text);
      }
      window.playing = !!(el && !el.paused && !el.ended);
    } else {
      window.lyricsLines = [];
      window.lyricsVisible = false;
    }
  } catch (e) {
    console.warn('[visual] parse lyric', e);
  }
}

const PRESET_KEY = 'hudui_visual_preset';
export const DEFAULT_PRESET_ID = 0; // 丝绸 / 封面粒子

function readSavedPresetId() {
  try {
    const raw = localStorage.getItem(PRESET_KEY);
    if (raw == null || raw === '') return DEFAULT_PRESET_ID;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 && n <= 12 ? n : DEFAULT_PRESET_ID;
  } catch {
    return DEFAULT_PRESET_ID;
  }
}

function savePresetId(id) {
  try { localStorage.setItem(PRESET_KEY, String(Number(id) || 0)); } catch { /* ignore */ }
}

export function setVisualPreset(index) {
  const id = Number(index);
  const next = Number.isFinite(id) && id >= 0 && id <= 12 ? id : DEFAULT_PRESET_ID;
  try {
    if (typeof window.setPreset === 'function') {
      window.setPreset(next, { silent: true });
    } else if (window.fx) {
      window.fx.preset = next;
      if (window.uniforms?.uPreset) window.uniforms.uPreset.value = next;
      if (typeof window.syncFxUniforms === 'function') window.syncFxUniforms();
    }
  } catch (e) { console.warn('[visual] setPreset', e); }
  forceParticleVisible();
  adoptRendererCanvas();
  savePresetId(next);
  return next;
}

/** 进详情页自动应用默认/上次预设，避免每次手动点 */
export function ensureDefaultPreset() {
  const id = readSavedPresetId();
  setVisualPreset(id);
  return id;
}

export function getActivePresetId() {
  try {
    if (window.fx && Number.isFinite(Number(window.fx.preset))) return Number(window.fx.preset);
  } catch { /* ignore */ }
  return readSavedPresetId();
}

export function setFxField(key, value) {
  if (!ready || !window.fx) return;
  try {
    window.fx[key] = value;
    if (typeof window.syncFxUniforms === 'function') window.syncFxUniforms();
  } catch (e) { console.warn(e); }
}

export function startVisualWatch() {
  if (lyricPollTimer) return;
  const sync = () => {
    if (!ready) return;
    const el = musicPlayer.ensureAudio();
    if (window.audio !== el) window.audio = el;
    window.playing = !!(el && !el.paused && !el.ended && el.readyState >= 2);
    if (window.fx && Array.isArray(window.lyricsLines) && window.lyricsLines.length) {
      window.fx.particleLyrics = true;
    }
    try {
      if (window.playing && typeof window.tickLyricsParticles === 'function') window.tickLyricsParticles();
      if (typeof window.updateStageLyrics3D === 'function') window.updateStageLyrics3D(0.016);
    } catch (e) { /* ignore */ }
  };
  lyricPollTimer = setInterval(sync, 80);
  const raf = () => { if (!lyricPollTimer) return; sync(); requestAnimationFrame(raf); };
  requestAnimationFrame(raf);
}

export function stopVisualWatch() {
  if (lyricPollTimer) { clearInterval(lyricPollTimer); lyricPollTimer = 0; }
}

export const PRESET_LIST = [
  { id: 0, name: '丝绸 / 封面粒子' },
  { id: 1, name: '隧道 / 滚筒' },
  { id: 2, name: '星球' },
  { id: 3, name: '虚空' },
  { id: 4, name: '唱片' },
  { id: 5, name: '星河' },
  { id: 6, name: '安魂 / 骷髅' },
  { id: 7, name: '音域回响 Topo' },
  { id: 8, name: '音域回响 WE' },
  { id: 9, name: '月蚀圣环' },
  { id: 10, name: '雨幕霓虹' },
  { id: 11, name: '折光蝶群' },
  { id: 12, name: '深海绽放' },
];
