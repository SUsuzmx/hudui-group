import fs from 'node:fs';
import path from 'node:path';

const root = 'C:/perry/client/public/visual';
const modulePaths = [
  'js/modules/00-visual-stubs.js',
  'js/modules/00-state/00-core-stores.js',
  'js/modules/00-state/01-perf-render-state.js',
  'js/modules/00-state/02-preferences-ui-modes.js',
  'js/modules/00-state/03-beat-dj-state.js',
  'js/modules/00-state/04-fx-defaults.js',
  'js/modules/00-state/05-packaged-fx-archive.js',
  'js/modules/00-state/06-fx-runtime-layout.js',
  'js/modules/00-state/07-ui-playback-runtime.js',
  'js/modules/00-state/08-desktop-render-power.js',
  'js/modules/00-state/09-performance-probe.js',
  'js/modules/00-state/10-frame-scheduler.js',
  'js/modules/00-state/11-system-memory-controls.js',
  'js/modules/01-scene/00-renderer-quality.js',
  'js/modules/01-scene/01-orbit-free-camera.js',
  'js/modules/01-scene/02-beat-camera-runtime.js',
  'js/modules/01-scene/03-focus-cinema-camera.js',
  'js/modules/01-scene/04-bottom-controls-cursor.js',
  'js/modules/02-visual/00-pointer-cover-particles.js',
  'js/modules/02-visual/01-float-skull-backcover.js',
  'js/modules/02-visual/02-lyrics-state-layout.js',
  'js/modules/02-visual/03-lyrics-star-river.js',
  'js/modules/02-visual/04-visual-settings-persistence.js',
  'js/modules/02-visual/05-lyrics-fonts-texture.js',
  'js/modules/02-visual/06-custom-background-colorlab.js',
  'js/modules/02-visual/07-lyrics-palette-text-utils.js',
  'js/modules/02-visual/08-lyrics-display-modes.js',
  'js/modules/02-visual/09-lyrics-payloads.js',
  'js/modules/02-visual/10-lyrics-mask-textures.js',
  'js/modules/02-visual/11-lyrics-shaders.js',
  'js/modules/02-visual/12-lyrics-row-layers.js',
  'js/modules/02-visual/13-lyrics-mesh-build.js',
  'js/modules/02-visual/14-stage-lyrics-rendering.js',
  'js/modules/02-visual/15-ripples-cover-depth.js',
  'js/modules/sonic-topography-preset.js',
  'js/modules/sonic-workshop-preset.js',
  'js/modules/03-beat/00-tempo-worker-cache-prefetch.js',
  'js/modules/03-beat/01-audio-beat-analysis.js',
  'js/modules/03-beat/02-podcast-dj-analysis.js',
  'js/modules/03-beat/03-local-beat-cache-modal.js',
  'js/modules/03-beat/04-beat-map-runtime.js',
  'js/modules/03-beat/05-cover-loading-crop.js',
  'js/modules/03-beat/06-sonic-audio-monitor.js',
  'js/modules/05-playback/01-cover-custom-map.js',
  'js/modules/05-playback/08-audio-graph-controls.js',
  'js/modules/06-lyrics/00-lyrics-fetch-parse.js',
  'js/modules/07-fx/00-preset-archive-data.js',
  'js/modules/07-fx/01-lyric-color-controls.js',
  'js/modules/07-fx/02-accent-background-controls.js',
  'js/modules/07-fx/03-cover-picker-fonts.js',
  'js/modules/07-fx/03-wallpaper-engine-library.js',
  'js/modules/07-fx/04-preset-grid-uniforms.js',
  'js/modules/07-fx/05-fx-panel-performance.js',
  'js/modules/07-fx/06-hotkeys.js',
  'js/modules/07-fx/07-bindings-shelf-immersive.js',
  'js/modules/07-fx/08-cache-storage-settings.js',
  'js/modules/07-fx/09-console-workspace.js',
  'js/modules/09-idle-toast-libraries.js',
  'js/modules/11-main-loop.js',
];
const parts = [];
for (const rel of modulePaths) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) { console.error('missing', rel); process.exit(1); }
  parts.push('\n/* ==== ' + rel + ' ==== */\n' + fs.readFileSync(full, 'utf8'));
}
const out = '/* Mineradio visual bundle generated */\n' + parts.join('\n') + '\n//# sourceURL=mineradio-visual-bundle.js\n';
fs.writeFileSync(path.join(root, 'mineradio-bundle.js'), out);
console.log('bundle bytes', out.length);
