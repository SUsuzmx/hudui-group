/* ==== visual-exports: bridge module locals to window ==== */
(function exportVisualGlobals() {
  try {
    window.orbit = orbit;
    window.gestureRotation = gestureRotation;
    window.headParallax = headParallax;
    window.fx = fx;
    window.uniforms = uniforms;
    window.scene = scene;
    window.camera = camera;
    window.renderer = renderer;
    window.particles = particles;
    window.setPreset = setPreset;
    window.syncFxUniforms = syncFxUniforms;
    window.applyPresetOrbitBaseline = applyPresetOrbitBaseline;
    window.unlockCenteredView = function () {
      orbit.centerLocked = false;
      orbit.recentering = false;
    };
    window.getVisualOrbit = function () { return orbit; };
    window.getVisualGestureRotation = function () { return gestureRotation; };
    window.__visualGestureBound = true;
  } catch (e) { console.warn('[visual-exports]', e); }
})();
