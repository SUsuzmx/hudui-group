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
  // 预加载时可能建过隐藏 staging 容器，进详情页后清掉，避免双 id
  try {
    document.querySelectorAll('#canvas-container[data-visual-staging]').forEach((node) => {
      if (node !== cc) node.remove();
    });
  } catch { /* ignore */ }
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

/** 预加载时保证视觉引擎有可挂载的 canvas 容器，避免 mineradio 启动空指针 */
function ensureCanvasHost() {
  let cc = document.getElementById('canvas-container');
  if (cc) return cc;
  cc = document.createElement('div');
  cc.id = 'canvas-container';
  cc.setAttribute('data-visual-staging', '1');
  cc.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none';
  (document.body || document.documentElement).appendChild(cc);
  return cc;
}

export { adoptRendererCanvas };

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

let gestureAbort = null;

function stageVisible() {
  try {
    const root = document.querySelector('.player-stage');
    return !!(root && root.offsetParent !== null);
  } catch { return false; }
}
function inStage(el) {
  try { return !!(el && el.closest && el.closest('.player-stage, .visual-stage-root, #canvas-container')); }
  catch { return false; }
}
function isUiTarget(el) {
  if (!el || !el.closest) return false;
  return !!el.closest('.bottom-bar, .fx-dock, .fx-fab, .mini-queue-popover, .top-chrome, .stage-status, .chrome-btn');
}

function getLiveOrbit() {
  try {
    if (typeof window.getVisualOrbit === 'function') {
      const o = window.getVisualOrbit();
      if (o) return o;
    }
  } catch { /* ignore */ }
  return window.orbit || null;
}

function getLiveGestureRotation() {
  try {
    if (typeof window.getVisualGestureRotation === 'function') {
      const g = window.getVisualGestureRotation();
      if (g) return g;
    }
  } catch { /* ignore */ }
  return window.gestureRotation || { x: 0, y: 0 };
}

function unlockOrbit(orbit) {
  if (!orbit) return;
  orbit.rotating = true;
  orbit.centerLocked = false;
  orbit.recentering = false;
  try { if (orbit.focus) orbit.focus.active = false; } catch { /* ignore */ }
}

/** 可重复调用：每次进详情页绑到当前舞台 DOM（预加载隐藏节点会被换掉） */
export function ensureStageGestures() {
  if (gestureAbort) {
    try { gestureAbort.abort(); } catch { /* ignore */ }
    gestureAbort = null;
  }
  const pointers = new Map();
  let lastDist = 0;
  const ac = new AbortController();
  gestureAbort = ac;
  window.__visualGestureBound = true;

  const onDown = (e) => {
    if (!stageVisible() || !inStage(e.target) || isUiTarget(e.target)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const orbit = getLiveOrbit();
    if (pointers.size === 1 && orbit) {
      unlockOrbit(orbit);
      if (orbit.last) { orbit.last.x = e.clientX; orbit.last.y = e.clientY; }
    }
    if (pointers.size === 2) {
      const pts = [...pointers.values()];
      lastDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (orbit) unlockOrbit(orbit);
    }
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
  };
  const onMove = (e) => {
    if (!pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const orbit = getLiveOrbit();
    if (pointers.size >= 2) {
      const pts = [...pointers.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (orbit && lastDist > 0 && dist > 0) {
        const scale = lastDist / dist;
        unlockOrbit(orbit);
        const next = Math.min(orbit.maxRadius || 14, Math.max(orbit.minRadius || 2.4, (orbit.userRadius || 6.6) * scale));
        orbit.userRadius = next;
        orbit.radius = next;
      }
      lastDist = dist;
      return;
    }
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    if (!dx && !dy) return;
    if (orbit) {
      unlockOrbit(orbit);
      orbit.userTheta = (orbit.userTheta || 0) - dx * 0.01;
      orbit.userPhi = Math.min(orbit.maxPhi ?? 1.4, Math.max(orbit.minPhi ?? -1.4, (orbit.userPhi || 0.08) - dy * 0.008));
      orbit.theta = orbit.userTheta;
      orbit.phi = orbit.userPhi;
      if (orbit.last) { orbit.last.x = e.clientX; orbit.last.y = e.clientY; }
    }
    const gr = getLiveGestureRotation();
    if (gr) {
      gr.y = (gr.y || 0) - dx * 0.01;
      gr.x = Math.max(-0.8, Math.min(0.8, (gr.x || 0) - dy * 0.008));
      try {
        const p = window.particles;
        if (p && p.rotation) {
          p.rotation.y = gr.y;
          p.rotation.x = gr.x;
        }
      } catch (e) { /* ignore */ }
    }
  };
  const onUp = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size === 0) {
      const orbit = getLiveOrbit();
      if (orbit) orbit.rotating = false;
      lastDist = 0;
    }
  };
  const onWheel = (e) => {
    if (!stageVisible() || !inStage(e.target) || isUiTarget(e.target)) return;
    e.preventDefault();
    const orbit = getLiveOrbit();
    if (!orbit) return;
    unlockOrbit(orbit);
    const next = Math.min(orbit.maxRadius || 14, Math.max(orbit.minRadius || 2.4, (orbit.userRadius || 6.6) * (e.deltaY > 0 ? 1.08 : 0.92)));
    orbit.userRadius = next;
    orbit.radius = next;
  };

  const opts = { signal: ac.signal, passive: false };
  document.addEventListener('pointerdown', onDown, opts);
  document.addEventListener('pointermove', onMove, opts);
  document.addEventListener('pointerup', onUp, opts);
  document.addEventListener('pointercancel', onUp, opts);
  document.addEventListener('wheel', onWheel, opts);

  const stageRoot = document.querySelector('.player-stage') || document.querySelector('.visual-stage-root');
  if (stageRoot) {
    stageRoot.style.touchAction = 'none';
  }
  return true;
}

function bindStageGestures() {
  return ensureStageGestures();
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
      ensureCanvasHost();
      await loadScript('/visual/visual-loader.js');
      if (typeof window.loadMineradioVisual !== 'function') throw new Error('visual-loader 未导出 loadMineradioVisual');
      await window.loadMineradioVisual();
      const el = musicPlayer.ensureAudio();
      window.audio = el;
      window.musicPlayerToggle = () => musicPlayer.togglePlay();
      window.musicPlayerNext = () => musicPlayer.nextTrack();
      window.musicPlayerPrev = () => musicPlayer.prevTrack();
      const sync = () => {
        window.playing = musicPlayer.state.playing;
        if (window.playing) ensureAudioAudible();
      };
      el.addEventListener('play', sync);
      el.addEventListener('pause', sync);
      sync();
      adoptRendererCanvas();
      forceParticleVisible();
      ensureStageGestures();
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


function scheduleBeatForTrack(track, el) {
  try {
    if (typeof window.scheduleBeatAnalysis !== 'function') return;
    let rawUrl = track.url || (el && (el.currentSrc || el.src)) || '';
    if (!rawUrl) return;
    if (rawUrl.includes('/api/audio')) {
      const m = rawUrl.match(/[?&]url=([^&]+)/);
      if (m) { try { rawUrl = decodeURIComponent(m[1]); } catch { /* ignore */ } }
    }
    const audioUrl = /^https?:/i.test(rawUrl) ? ('/api/audio?url=' + encodeURIComponent(rawUrl)) : rawUrl;
    const songObj = {
      source: track.source,
      id: track.id,
      mid: track.mid,
      songmid: track.mid,
      name: track.title,
      artist: track.artist,
      duration: track.duration,
    };
    let songId = '';
    try {
      if (typeof window.beatMapSongKey === 'function') songId = window.beatMapSongKey(songObj) || '';
    } catch { /* ignore */ }
    if (!songId) songId = `${track.source}:${track.id}`;
    let tok = 0;
    if (typeof window.beginBeatAnalysisToken === 'function') tok = window.beginBeatAnalysisToken();
    window.scheduleBeatAnalysis(songId, audioUrl, tok, songObj);
  } catch (e) {
    console.warn('[visual] beat schedule', e);
  }
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
    scheduleBeatForTrack(track, el);
  }
  try {
    if (typeof window.initAudio === 'function' && (el.readyState >= 2 || !el.paused)) window.initAudio();
    ensureAudioAudible();
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
  const target = next;
  try {
    const apply = window.setPreset;
    if (typeof apply === 'function') {
      apply(target, { silent: true, preserveCamera: true });
    } else {
      if (window.fx) window.fx.preset = target;
      if (window.uniforms?.uPreset) window.uniforms.uPreset.value = target;
      if (typeof window.syncFxUniforms === 'function') window.syncFxUniforms();
      if (typeof window.applyPresetOrbitBaseline === 'function') {
        window.applyPresetOrbitBaseline(target, { syncCurrent: false });
      }
    }
    const o = window.orbit;
    if (o) { o.centerLocked = false; o.recentering = false; }
  } catch (e) { console.warn('[visual] setPreset', e); }
  forceParticleVisible();
  adoptRendererCanvas();
  savePresetId(target);
  return target;
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
  };
  // 只同步 playing；tickLyricsParticles / updateStageLyrics3D 由 11-main-loop 驱动，双跑会卡顿
  lyricPollTimer = setInterval(sync, 150);
}

export function stopVisualWatch() {
  if (lyricPollTimer) { clearInterval(lyricPollTimer); lyricPollTimer = 0; }
}

/** 进列表页预加载引擎，详情页秒开 */
export function preloadVisualStage() {
  try { ensureCanvasHost(); } catch { /* ignore */ }
  return initVisualStage().then(() => true).catch((e) => {
    console.warn('[visual] preload', e);
    return false;
  });
}

/** Web Audio 绑定后恢复可听（capture 支路 gain=0 会吞声） */
export function ensureAudioAudible() {
  try {
    const el = musicPlayer.ensureAudio();
    if (el) {
      if (!(el.volume > 0)) el.volume = 1;
      el.muted = false;
    }
    if (window.audioCtx && window.audioCtx.state === 'suspended') {
      window.audioCtx.resume().catch(() => {});
    }
    // MediaElementSource 支路必须经 gainNode 出声；capture 支路 analysisSink 默认 0 由元素自身外放
    if (window.gainNode?.gain) {
      if (Number(window.gainNode.gain.value) < 0.05) window.gainNode.gain.value = 1;
    }
    if (!window.gainNode && window.analysisSinkNode?.gain) {
      const sinkNeed = !(el && !el.paused && el.captureStream);
      if (sinkNeed && Number(window.analysisSinkNode.gain.value) < 0.01) {
        window.analysisSinkNode.gain.value = 1;
      }
    }
  } catch (e) { /* ignore */ }
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
