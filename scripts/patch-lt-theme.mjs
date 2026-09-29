import fs from 'node:fs';

const p = 'client/src/components/ListenTogetherView.vue';
let c = fs.readFileSync(p, 'utf8');
const crlf = c.includes('\r\n');
if (crlf) c = c.replace(/\r\n/g, '\n');
const start = c.indexOf('<style scoped>');
const end = c.lastIndexOf('</style>');
if (start < 0 || end < 0) {
  console.log('style not found');
  process.exit(1);
}

const style = String.raw`<style scoped>
.lt-root {
  position: absolute;
  inset: 0;
  z-index: 40;
  background: linear-gradient(165deg, #e0f7fa 0%, #c7f0e4 42%, #a7f3d0 100%);
  color: #1f2d2a;
  overflow: hidden;
  font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif;
}
.lt-root.collapsed { background: transparent; }
.lt-songdetail {
  position: absolute !important;
  inset: 0 !important;
  z-index: 20;
}

.lt-panel {
  position: absolute;
  inset: 0;
  z-index: 10;
  display: flex;
  flex-direction: column;
  background: linear-gradient(165deg, #e0f7fa 0%, #b8efe0 48%, #a7f3d0 100%);
  padding-bottom: env(safe-area-inset-bottom, 0px);
}
.lt-top {
  display: flex;
  align-items: center;
  height: 52px;
  padding: env(safe-area-inset-top, 0px) 8px 0;
  flex-shrink: 0;
}
.lt-top-title {
  flex: 1;
  text-align: center;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: #0f3d36;
}
.lt-top-btn {
  width: 44px;
  height: 44px;
  border: 0;
  background: rgba(255, 255, 255, 0.55);
  border-radius: 12px;
  color: #0d9488;
  font-size: 22px;
  line-height: 1;
}
.lt-tip {
  margin: 0 16px 8px;
  padding: 8px 10px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.78);
  color: #0f766e;
  font-size: 12px;
  box-shadow: 0 2px 8px rgba(20, 120, 110, 0.08);
}

.lt-cover-zone {
  position: relative;
  width: min(230px, 56vw);
  height: min(230px, 56vw);
  margin: 14px auto 0;
  flex-shrink: 0;
}
.lt-cover {
  position: absolute;
  left: 12%;
  right: 12%;
  top: 0;
  bottom: 18%;
  border-radius: 18px;
  overflow: hidden;
  background: linear-gradient(145deg, #99f6e4, #5eead4);
  box-shadow: 0 14px 32px rgba(20, 120, 110, 0.18);
  z-index: 2;
}
.lt-cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
.lt-cover-fb {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 56px;
  color: #0f766e;
  opacity: 0.55;
}
.lt-wire {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 1;
  pointer-events: none;
}
.lt-wire path {
  fill: none;
  stroke: rgba(15, 148, 136, 0.55);
  stroke-width: 2.2;
  stroke-linecap: round;
}
.lt-wire .wire-jack { fill: #14b8a6; }
.lt-avatar {
  position: absolute;
  top: 38%;
  z-index: 3;
  border-radius: 50%;
  padding: 2.5px;
  box-shadow: 0 8px 18px rgba(20, 120, 110, 0.2);
}
.lt-avatar.left {
  left: -2%;
  transform: rotate(-12deg);
  background: linear-gradient(145deg, #22d3ee, #4fd1c5);
}
.lt-avatar.right {
  right: -2%;
  transform: rotate(12deg);
  background: linear-gradient(145deg, #4fd1c5, #2dd4bf);
}
.lt-avatar.empty { opacity: 0.5; }
.lt-avatar-ph {
  display: flex;
  width: 58px;
  height: 58px;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.85);
  color: #0f766e;
  font-size: 18px;
}
.lt-avatar-more {
  position: absolute;
  right: 2%;
  bottom: 4%;
  z-index: 3;
  font-size: 11px;
  color: #0f766e;
}

.lt-song-meta {
  text-align: center;
  margin-top: 26px;
  padding: 0 20px;
  flex-shrink: 0;
}
.lt-song-title {
  font-size: 22px;
  font-weight: 800;
  color: #0b1f1c;
}
.lt-song-artist {
  margin-top: 6px;
  font-size: 13px;
  color: #5b756f;
}

.lt-progress {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 18px 22px 0;
  flex-shrink: 0;
}
.lt-time {
  width: 40px;
  font-size: 11px;
  color: #6b857f;
  font-variant-numeric: tabular-nums;
}
.lt-time:last-child { text-align: right; }
.lt-bar {
  position: relative;
  flex: 1;
  height: 22px;
  display: flex;
  align-items: center;
}
.lt-bar::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  height: 4px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.7);
  box-shadow: inset 0 0 0 1px rgba(20, 120, 110, 0.08);
}
.lt-bar-fill {
  position: absolute;
  left: 0;
  height: 4px;
  border-radius: 2px;
  background: linear-gradient(90deg, #4fd1c5, #22d3ee);
  pointer-events: none;
}
.lt-bar-input {
  position: relative;
  width: 100%;
  opacity: 0;
  height: 22px;
  margin: 0;
}

.lt-controls {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 18px;
  padding: 14px 20px 10px;
  flex-shrink: 0;
}
.lt-ctrl-ghost {
  border: 0;
  background: rgba(255, 255, 255, 0.55);
  border-radius: 12px;
  color: #0d9488;
  font-size: 18px;
  width: 44px;
  height: 44px;
}
.lt-ctrl-ghost:disabled { opacity: 0.35; }
.lt-ctrl-play {
  width: 64px;
  height: 64px;
  border: 0;
  border-radius: 50%;
  background: linear-gradient(145deg, #22d3ee, #4fd1c5);
  color: #fff;
  font-size: 20px;
  box-shadow: 0 12px 28px rgba(20, 180, 170, 0.35);
}
.lt-ctrl-play:disabled { opacity: 0.5; }

.lt-tabs {
  display: flex;
  gap: 8px;
  padding: 8px 16px 4px;
  flex-shrink: 0;
}
.lt-tab {
  flex: 1;
  border: 0;
  border-radius: 14px 14px 0 0;
  padding: 10px 6px;
  background: rgba(255, 255, 255, 0.45);
  color: #3d5c56;
  font-size: 13px;
}
.lt-tab.on {
  background: rgba(255, 255, 255, 0.92);
  color: #0f766e;
  font-weight: 700;
  box-shadow: 0 -2px 10px rgba(20, 120, 110, 0.08);
}

.lt-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  margin: 0 12px;
  border-radius: 16px 16px 0 0;
  background: rgba(255, 255, 255, 0.82);
  padding: 8px 8px 12px;
  box-shadow: 0 -4px 18px rgba(20, 120, 110, 0.08);
}
.lt-list-empty {
  padding: 28px 12px;
  text-align: center;
  color: #7a918c;
  font-size: 13px;
}
.lt-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 8px;
}
.lt-row-cover {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  overflow: hidden;
  background: #d9f5ef;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.lt-row-cover img { width: 100%; height: 100%; object-fit: cover; }
.lt-row-main { flex: 1; min-width: 0; }
.lt-row-title {
  font-size: 14px;
  color: #172b27;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.lt-row-sub {
  margin-top: 2px;
  font-size: 11px;
  color: #6b857f;
}
.lt-row-btn {
  border: 0;
  border-radius: 999px;
  padding: 7px 14px;
  background: linear-gradient(135deg, #4fd1c5, #22d3ee);
  color: #fff;
  font-size: 12px;
  flex-shrink: 0;
  font-weight: 600;
}
.lt-row-btn.danger { background: rgba(239, 68, 68, 0.85); }
.lt-row-btn:disabled { opacity: 0.5; }

.lt-search {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 10px 12px 4px;
  padding: 10px 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.9);
  box-shadow: 0 4px 14px rgba(20, 120, 110, 0.1);
  flex-shrink: 0;
}
.lt-search-icon { color: #0d9488; font-size: 16px; }
.lt-search input {
  flex: 1;
  border: 0;
  outline: none;
  background: transparent;
  color: #172b27;
  font-size: 14px;
}
.lt-search input::placeholder { color: #8aa39d; }
.lt-search-go {
  border: 0;
  border-radius: 999px;
  padding: 6px 12px;
  background: linear-gradient(135deg, #4fd1c5, #22d3ee);
  color: #fff;
  font-size: 12px;
  font-weight: 600;
}

.lt-collapse {
  border: 0;
  background: transparent;
  color: #0d9488;
  padding: 10px 0 calc(10px + env(safe-area-inset-bottom, 0px));
  flex-shrink: 0;
}
.lt-collapse-tri {
  display: inline-flex;
  width: 36px;
  height: 22px;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.65);
  font-size: 11px;
}

.lt-sheet-mask {
  position: absolute;
  inset: 0;
  z-index: 30;
  background: rgba(15, 60, 55, 0.28);
  display: flex;
  align-items: flex-end;
}
.lt-sheet {
  width: 100%;
  max-height: 72vh;
  overflow-y: auto;
  border-radius: 20px 20px 0 0;
  background: #f4fffb;
  padding: 14px 14px calc(18px + env(safe-area-inset-bottom, 0px));
  box-shadow: 0 -8px 30px rgba(20, 120, 110, 0.15);
}
.lt-sheet-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 16px;
  font-weight: 700;
  color: #0b1f1c;
}
.lt-sheet-title button {
  border: 0;
  background: transparent;
  color: #0d9488;
  font-size: 13px;
  font-weight: 600;
}
.lt-sheet-sub {
  margin: 6px 0 10px;
  font-size: 12px;
  color: #5b756f;
}
.lt-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  font-size: 12px;
  color: #0f766e;
}
.lt-leave {
  margin-top: 14px;
  width: 100%;
  border: 0;
  border-radius: 12px;
  padding: 13px;
  background: rgba(239, 68, 68, 0.9);
  color: #fff;
  font-size: 14px;
  font-weight: 600;
}

@media (max-width: 360px) {
  .lt-song-title { font-size: 18px; }
  .lt-ctrl-play { width: 56px; height: 56px; }
}
</style>`;

c = c.slice(0, start) + style + c.slice(end + '</style>'.length);
if (crlf) c = c.replace(/\n/g, '\r\n');
fs.writeFileSync(p, c, 'utf8');
console.log('ListenTogetherView theme applied');
