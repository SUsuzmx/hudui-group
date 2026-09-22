'use strict';
(function loadMineradioVisualModules() {
  if (window.__mineradioVisualLoaded) return Promise.resolve(window.__mineradioVisualLoaded);
  if (window.__mineradioVisualLoading) return window.__mineradioVisualLoading;
  var base = (function () {
    var scripts = document.getElementsByTagName('script');
    for (var i = scripts.length - 1; i >= 0; i--) {
      var src = scripts[i].src || '';
      if (src.indexOf('visual-loader.js') >= 0) return src.replace(/visual-loader\.js.*$/, '');
    }
    return '/visual/';
  })();
  function loadScript(src, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      var done = false;
      var timer = setTimeout(function () { if (!done) { done = true; reject(new Error('script timeout: ' + src)); } }, timeoutMs || 30000);
      s.src = src + (src.indexOf('?') >= 0 ? '&' : '?') + 'v=' + Date.now();
      s.async = false;
      s.onload = function () { if (!done) { done = true; clearTimeout(timer); resolve(src); } };
      s.onerror = function () { if (!done) { done = true; clearTimeout(timer); reject(new Error('script failed: ' + src)); } };
      document.head.appendChild(s);
    });
  }
  function runtimePatch() {
    try {
      if (typeof window.syncDesktopOverlayState !== 'function') window.syncDesktopOverlayState = function () {};
      if (typeof window.tickGestureRotation !== 'function') window.tickGestureRotation = function () {};
      if (typeof window.applyParticleSpinDrag !== 'function') {
        window.applyParticleSpinDrag = function applyParticleSpinDrag(dx, dy) {
          try {
            var gr = window.gestureRotation || { x: 0, y: 0 };
            gr.y = (gr.y || 0) - (Number(dx) || 0) * 0.004;
            gr.x = Math.max(-0.9, Math.min(0.9, (gr.x || 0) + (Number(dy) || 0) * 0.003));
            window.gestureRotation = gr;
            var o = window.orbit;
            if (o) {
              o.centerLocked = false;
              o.recentering = false;
              o.userTheta = (o.userTheta || 0) - (Number(dx) || 0) * 0.003;
              o.theta = o.userTheta;
            }
          } catch (e) {}
        };
      }
      if (typeof window.unlockCenteredView !== 'function') {
        window.unlockCenteredView = function () {
          if (window.orbit) {
            window.orbit.centerLocked = false;
            window.orbit.recentering = false;
          }
        };
      }
      if (typeof window.applyAudioOutputDevice !== 'function') window.applyAudioOutputDevice = function () { return Promise.resolve(true); };
      if (typeof window.applyStageLyricLayoutOffset !== 'function') window.applyStageLyricLayoutOffset = function () {};
      if (typeof window.visibleMotionFollowVsync !== 'function') window.visibleMotionFollowVsync = function () { return false; };
      if (typeof window.isDeepBackgroundMode !== 'function') window.isDeepBackgroundMode = function () { return false; };
      if (typeof window.tickLyricsParticles !== 'function') window.tickLyricsParticles = function () {};
      if (typeof window.updateStageLyrics3D !== 'function') window.updateStageLyrics3D = function () {};
      if (typeof window.updateCamera !== 'function') window.updateCamera = function () {};
      if (typeof window.updateFreeCamera !== 'function') window.updateFreeCamera = function () {};
      if (typeof window.tickPresetTransition !== 'function') window.tickPresetTransition = function () {};
      if (typeof window.updateRipples !== 'function') window.updateRipples = function () {};
      if (typeof window.updateFloatLayer !== 'function') window.updateFloatLayer = function () {};
      if (typeof window.updateParticlePointerFrame !== 'function') window.updateParticlePointerFrame = function () {};
      if (typeof window.processRealtimeBeatEngine !== 'function') window.processRealtimeBeatEngine = function () { return null; };
      if (!window.shelfManager) window.shelfManager = {};
      ['hasOpenContent','update','onCoverChange','rebuild'].forEach(function (m) {
        if (typeof window.shelfManager[m] !== 'function') window.shelfManager[m] = function () { return false; };
      });
      if (!window.gestureRotation) window.gestureRotation = { x: 0, y: 0 };
      if (!window.headParallax) window.headParallax = { active: false, x: 0, y: 0 };
      if (!window.orbit) {
        window.orbit = {
          centerLocked: false, userTheta: 0, userPhi: 0.08, userRadius: 6.6,
          theta: 0, phi: 0.08, radius: 6.6, minRadius: 2.4, maxRadius: 14,
          minPhi: -1.4, maxPhi: 1.4, rotating: false, recentering: false,
          last: { x: 0, y: 0 },
        };
      }
      try {
        if (window.fx && Number(window.fx.preset) === 6) {
          if (typeof window.setPreset === 'function') window.setPreset(0, { silent: true, noSave: true });
          else window.fx.preset = 0;
        }
        var orig = window.loadSkullParticleAsset;
        window.loadSkullParticleAsset = function () {
          try { return Promise.resolve(typeof orig === 'function' ? orig() : null).catch(function () { return null; }); }
          catch (e) { return Promise.resolve(null); }
        };
      } catch (e) {}
      if (window.uniforms && window.uniforms.uAlpha && !(window.uniforms.uAlpha.value > 0.01)) window.uniforms.uAlpha.value = 0.96;
      if (window.uniforms && window.uniforms.uParticleDim) window.uniforms.uParticleDim.value = 1;
      if (window.fx) window.fx.particleLyrics = true;
      if (window.particles) window.particles.visible = true;
      if (window.audio) {
        window.playing = !window.audio.paused && !window.audio.ended;
        try {
          if (window.audio.volume < 0.05) window.audio.volume = 1;
          window.audio.muted = false;
        } catch (e) {}
      }
      // Web Audio 绑定后若输出被静音支路吞掉，恢复可听
      try {
        if (window.audioCtx && window.audioCtx.state === 'suspended') {
          window.audioCtx.resume().catch(function () {});
        }
        if (window.gainNode && window.gainNode.gain && window.gainNode.gain.value < 0.05) {
          window.gainNode.gain.value = 1;
        }
        if (window.analysisSinkNode && window.analysisSinkNode.gain && !window.gainNode
          && window.analysisSinkNode.gain.value < 0.01) {
          window.analysisSinkNode.gain.value = 1;
        }
      } catch (e) {}
      // 3D 歌词时间轴：无拖动预览时必须用 audio.currentTime
      if (typeof window.getProgressDragPreviewSeconds !== 'function') {
        window.getProgressDragPreviewSeconds = function () { return null; };
      }
      if (typeof window.getAdjustedLyricPlaybackTime !== 'function') {
        window.getAdjustedLyricPlaybackTime = function (rawTime) {
          var t = Number(rawTime);
          if (!isFinite(t)) t = (window.audio && window.audio.currentTime) || 0;
          return Math.max(0, t);
        };
      }
      if (typeof window.createLyricsParticles !== 'function' && window.THREE && window.scene && window.stageLyrics) {
        try {
          if (!window.stageLyrics.group) {
            window.stageLyrics.group = new window.THREE.Group();
            window.scene.add(window.stageLyrics.group);
          }
        } catch (e) {}
      }
      window.__visualParticleDebug = {
        uAlpha: window.uniforms && window.uniforms.uAlpha ? window.uniforms.uAlpha.value : null,
        hasParticles: !!window.particles,
        hasRenderer: !!window.renderer,
        canvasCount: document.querySelectorAll('#canvas-container canvas').length,
        lyricLines: window.lyricsLines ? window.lyricsLines.length : 0,
        fxPreset: window.fx && window.fx.preset,
        mode: 'script-tag',
      };
    } catch (e) { console.warn('[visual-loader] patch', e); }
  }
  window.__mineradioVisualLoading = loadScript(base + 'vendor/three.r128.min.js', 25000)
    .then(function () { return loadScript(base + 'vendor/music-tempo.min.js', 15000); })
    .then(function () { return loadScript(base + 'vendor/gsap.min.js', 15000); })
    .then(function () { return loadScript(base + 'mineradio-bundle.js', 45000); })
    .then(function () {
      runtimePatch();
      window.__mineradioVisualLoaded = true;
      window.__mineradioVisualLoading = null;
      return true;
    })
    .catch(function (err) {
      window.__mineradioVisualLoading = null;
      console.error('[visual-loader]', err);
      throw err;
    });
  return window.__mineradioVisualLoading;
})();
window.loadMineradioVisual = function () {
  return window.__mineradioVisualLoading || Promise.resolve(window.__mineradioVisualLoaded);
};
