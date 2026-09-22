'use strict';
// 视觉舞台防御桩：未搬模块的 function 声明（依赖拼接脚本函数提升）
function readCustomLyricMap() { try { return JSON.parse(localStorage.getItem('mineradio-custom-lyric-map-v1') || '{}') || {}; } catch (e) { return {}; } }
function readCustomLyricPrefs() { try { return JSON.parse(localStorage.getItem('mineradio-custom-lyric-prefs-v1') || '{}') || {}; } catch (e) { return {}; } }
function loadListenStatsState() { return { history: [], songs: {}, artists: {}, updatedAt: 0 }; }
function readPlaybackQualityPreference() { return { netease: 'exhigh', qq: 'exhigh' }; }
function getProviderPlaybackQuality() { return 'exhigh'; }
function readAudioOutputDevicePreference() { return ''; }
function readAudioOutputMirrorPreference() { return []; }
function readAudioInputBridgePreference() { return { enabled: false }; }
async function applyAudioOutputDevice() { return true; }
function bindPlaybackProgressEvents() {}
function bindAudioOutputControls() {}
function readHotkeySettings() { return {}; }
function readPlaylistPanelTabPreference() { return 'queue'; }
function readSavedVolume() { return 1; }
function readBooleanPreference(k, fb) { return !!fb; }
function readCloseBehaviorPreference() { return 'minimize'; }
function readStartupResumeModePreference() { return 'fresh'; }
function getRenderPixelRatio() {
  // 手机画质向电脑看齐：原先 cap 1.5 会比 DPR2/3 屏更糊
  var dpr = window.devicePixelRatio || 1;
  var coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  return Math.min(dpr, coarse ? 2 : 2);
}
function readNow() { return Date.now(); }
function cloneLyricLines(lines) { return (Array.isArray(lines) ? lines : []).map(function (l) { return Object.assign({}, l); }); }
function currentLyricSong() { return null; }
function escHtml(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function apiJson() { return Promise.resolve(null); }
function getProgressDragPreviewSeconds() { return null; }
function isProgressDragPreviewActive() { return false; }
function getAdjustedLyricPlaybackTime(rawTime) {
  var t = Number(rawTime);
  if (!isFinite(t)) { try { t = (window.audio && window.audio.currentTime) || 0; } catch (e) { t = 0; } }
  return Math.max(0, t);
}
function getActiveLyricTimingOffsetSeconds() { return 0; }
function getLyricTimingOffsetForSong() { return 0; }
function syncDesktopOverlayState() {}
function applyStageLyricLayoutOffset() {}
function visibleMotionFollowVsync() { return false; }
function isDeepBackgroundMode() { return false; }
function applyParticleSpinDrag() {}
function shelfLayoutProfile() { return { portrait: false }; }
function currentCoverSong() { return null; }
function songProviderKey(song) { return String((song && (song.source || song.provider)) || 'qq'); }
function songSourceTagHtml() { return ''; }
function scheduleMainRendererViewportRefresh() {}
function syncGestureControlHostVisibility() {}
function hasAnyPlatformLogin() { return false; }
function notifyDesktopLyricsBeatMapReady() {}
function togglePlay() { try { window.musicPlayerToggle && window.musicPlayerToggle(); } catch (e) {} }
function nextTrack() { try { window.musicPlayerNext && window.musicPlayerNext(); } catch (e) {} }
function prevTrack() { try { window.musicPlayerPrev && window.musicPlayerPrev(); } catch (e) {} }
function toggleFullscreen() {}
function closeMiniQueue() {}
function setHomeControlsLocked() {}
function updatePlaybackQualityUi() {}
function applyRestoredPlaybackProgressUi() {}
function clearStartupAutoplayRetryTimer() {}
function queueStartupAutoplayAfterHomeReveal() {}
function closeUploadTip() {}
function togglePlaylistPanel() {}
function startGestureControl() {}
function stopGestureControl() {}
/** 11-main-loop.animate() 每帧裸调用，必须存在 */
function applyParticleSpinDrag(dx, dy) {
  // 仅在外部手势未处理时给轻微粒子转动；主路径由 visual-stage bindStageGestures 写 gestureRotation
  try {
    if (window.__visualGestureBound) return;
    var gr = window.gestureRotation || { x: 0, y: 0 };
    gr.y = (gr.y || 0) + (Number(dx) || 0) * 0.004;
    gr.x = Math.max(-0.9, Math.min(0.9, (gr.x || 0) + (Number(dy) || 0) * 0.003));
    window.gestureRotation = gr;
  } catch (e) {}
}
function unlockCenteredView() {
  if (typeof orbit !== 'undefined' && orbit) {
    orbit.centerLocked = false;
    orbit.recentering = false;
  }
}
function tickGestureRotation() {}
function tickIdleGuide() {}
function tickCustomBackground() {}
function tickWallpaperEngine() {}
function tickCoverPicker() {}
function tickDesktopOverlay() {}
function tickHomeDiscover() {}
function tickLoginStatus() {}
function tickListenStats() {}
function tickPresetTransition() {}
function tickLyricsParticles() {}
function tickBeatMap() {}
function tickPodcastDjBeatMap() {}
function tickDeepBackgroundFrame() {}
function updateParticlePointerFrame() {}
function updateCinema() {}
function updateCinemaDynamics() {}
function updateCinemaTrackProfile() {}
function updateFreeCamera() {}
function updateCamera() {}
function updateRipples() {}
function updateFloatLayer() {}
function updateHomeAudioVisual() {}
function updateSkullParticleLayer() {}
function updateStageLyrics3D() {}
function applySkullCameraPose() {}
function processRealtimeBeatEngine() { return null; }
function scheduleBeatCamera() {}
function stepSonicAudioMonitor() { return null; }
function applySkullCameraPoseSafe() {}
function sampleRenderPerf() {}
function sampleAdaptiveFrameCost() { return null; }
function shouldSkipAdaptiveRenderFrame() { return isCoarsePointer() ? false : false; }
function mainLoopDeepBackgroundSleeping() { return false; }
function isMainSceneCoveredBySplash() { return false; }
function shouldSkipFixedRenderCadenceFrame() { return false; }
function capMainLoopFpsForBudget(a, b) { var n = Number(b) || Number(a) || 30; return isCoarsePointer() ? Math.max(n, 45) : n; }
function mainLoopInteractionActive() { return false; }
function unlockCenteredView() {}
function markRenderInteraction() {}
function idleGuidePointerMove() {}
function idleGuidePointerDown() {}
function idleGuidePointerUp() {}
function idleGuidePointerLeave() {}
function idleGuideWheel() {}
function updateControlsAutoHideFromPointer() {}
function resetLyricRenderUploadFrameBudget() {}
function lyricMotionProfile() { return { floatAmp: 1 }; }
function lyricVerticalFloatEnabled() { return true; }
function currentLyricFallbackText() { return ''; }
function buildStageLyricPlaybackPayload() { return null; }
function clearStageLyrics() {}
function showStageLine() { return false; }
function findStageLyricIndexAtTime() { return -1; }
function stageLyricWarmupPending() { return false; }
function upgradeCurrentStageLyricFromPreparedTrack() {}
function retireCurrentStageLyricForIdle() {}
function scheduleStageLyricPrewarmForIndex() {}
function requestStageLyricWarmup() {}
function scheduleStageLyricSingleLineBootstrapPrewarm() {}
function resetStageLyricResumeFrameGates() {}
function ensureStageLyricPlaybackWarmup() {}
function requestStageLyricLightweightUpgrade() {}
function getLyricLineProgress() { return 0; }
function updateLyricMeshProgress() {}
function stageLyricProgressPreviewActive() { return false; }
function stageLyricPlaybackSeconds() {
  try { return (window.audio && window.audio.currentTime) || 0; } catch (e) { return 0; }
}
function setLyricTrackTarget() { return false; }
function normalizeStageLyricPayload() { return null; }
function applyStageLyricLayoutOffset() {}
function syncDesktopOverlayState() {}
function consumeFrameGate(gate, now, dt, fps) {
  if (!gate) return Number(dt) || 0.016;
  return Number(dt) || 0.016;
}
function createFrameGate() { return { last: 0, pendingDt: 0 }; }
function getRenderLoadTier() { return 0; }
function isCoarsePointer() { try { return !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches); } catch (e) { return false; } }
function isDeepBackgroundMode() { return false; }
function visibleMotionFollowVsync() { return false; }
function normalizeForegroundFpsMode() { return 'adaptive'; }
function selectAdaptiveRenderCadence() { return null; }
function runFrameGate(g) { g && (g.lastRunAt = Date.now()); return 0.016; }

var gestureRotation = { x: 0, y: 0 };
var headParallax = { active: false, x: 0, y: 0 };
var orbit = {
  centerLocked: false, userTheta: 0, userPhi: 0.08, userRadius: 6.6,
  theta: 0, phi: 0.08, radius: 6.6, minRadius: 2.4, maxRadius: 14,
  minPhi: -1.4, maxPhi: 1.4, rotating: false, recentering: false,
  last: { x: 0, y: 0 }, lookAt: { x: 0, y: 0, z: 0 },
  cineTheta: 0, cinePhi: 0, cineRadius: 0,
  focus: { active: false },
  beatGlow: 0, glowFollowX: 0, glowFollowY: 0,
};
var shelfManager = {
  hasOpenContent: function () { return false; },
  update: function () {},
  onCoverChange: function () {},
  rebuild: function () {},
};
var shelfPinnedOpen = false;
var camPunch = 0;
var prevTime = performance.now();
var audioEnergy = 0;
var beatPulse = 0;
var smoothBass = 0, smoothMid = 0, smoothTreb = 0, smoothEnergy = 0;
var bass = 0, mid = 0, treble = 0;
var frequencyData = new Uint8Array(1024);
var timeDomainData = new Uint8Array(2048);
var bassPeak = 0.12, midPeak = 0.10, treblePeak = 0.08, energyPeak = 0.10;
var beatOnsetFlag = false;
var currentBeatMap = null;
var currentDjBeatMap = null;
var djMode = { active: false };
var beatCam = { punch: 0, radiusKick: 0 };
var lyricSunEnergy = 0;
var skullBeatFlash = 0;
var particles = null;
var bloomParticles = null;
var floatGroup = null;
var backCoverGroup = null;
var skullParticleGroup = null;
var stageLyrics = { group: null, current: null, currentIdx: -1, currentText: '', currentPayload: null, palette: {}, outgoing: [], highBloom: 0, beatGlow: 0 };
var playing = false;
var lyricsLines = [];
var lyricsVisible = false;
var fx = null;
var uniforms = null;
var scene = null;
var camera = null;
var renderer = null;
var audio = null;

(function mineradioVisualStubs() {
  try {
    var origGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, attrs) {
      if (type === '2d') attrs = Object.assign({}, attrs || {}, { willReadFrequently: true });
      return origGetContext.call(this, type, attrs);
    };
  } catch (e) {}
  if (typeof window.showToast !== 'function') {
    window.showToast = function (msg) { try { console.info('[visual]', msg); } catch (e) {} };
  }
  window.coverProxySrc = function coverProxySrc(url) {
    if (!url) return '';
    if (/^data:image\//i.test(url) || /^blob:/i.test(url)) return url;
    if (url.charAt(0) === '/' && !/^\/\//.test(url)) url = location.origin + url;
    if (!/^https?:\/\//i.test(url)) return '';
    return '/api/cover?url=' + encodeURIComponent(url);
  };
  if (typeof window.SKULL_PRESET_INDEX === 'undefined') window.SKULL_PRESET_INDEX = 6;
  if (typeof window.appPerfMarks === 'undefined') window.appPerfMarks = [];
  // 确保 animate 裸调用的符号挂在 window 上
  [
    'tickGestureRotation', 'syncDesktopOverlayState', 'applyAudioOutputDevice',
    'tickLyricsParticles', 'updateStageLyrics3D', 'updateCamera', 'updateFreeCamera',
    'tickPresetTransition', 'updateRipples', 'updateFloatLayer', 'updateParticlePointerFrame',
  ].forEach(function (name) {
    if (typeof window[name] !== 'function') {
      window[name] = function () {};
    }
  });
})();


var shelfManager = {
  hasOpenContent: function () { return false; },
  update: function () {},
  onCoverChange: function () {},
  rebuild: function () {},
};
var shelfPinnedOpen = false;
var gestureRotation = { x: 0, y: 0 };
var headParallax = { active: false, x: 0, y: 0 };
if (typeof orbit === 'undefined') {
  var orbit = { centerLocked: false, userTheta: 0, userPhi: 0.08, userRadius: 6.6, theta: 0, phi: 0.08, radius: 6.6, minRadius: 2.4, maxRadius: 14, minPhi: -1.4, maxPhi: 1.4, rotating: false, last: { x: 0, y: 0 }, recentering: false };
}

(function mineradioVisualStubs() {
  try {
    var origGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, attrs) {
      if (type === '2d') attrs = Object.assign({}, attrs || {}, { willReadFrequently: true });
      return origGetContext.call(this, type, attrs);
    };
  } catch (e) {}
  if (typeof window.showToast !== 'function') {
    window.showToast = function (msg) { try { console.info('[visual]', msg); } catch (e) {} };
  }
  window.coverProxySrc = function coverProxySrc(url) {
    if (!url) return '';
    if (/^data:image\//i.test(url) || /^blob:/i.test(url)) return url;
    if (url.charAt(0) === '/' && !/^\/\//.test(url)) url = location.origin + url;
    if (!/^https?:\/\//i.test(url)) return '';
    return '/api/cover?url=' + encodeURIComponent(url);
  };
  if (typeof window.SKULL_PRESET_INDEX === 'undefined') window.SKULL_PRESET_INDEX = 6;
  if (typeof window.appPerfMarks === 'undefined') window.appPerfMarks = [];
})();
