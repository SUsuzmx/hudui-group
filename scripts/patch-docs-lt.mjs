import fs from 'node:fs';

const p = 'docs/MUSIC-VISUAL.md';
let c = fs.readFileSync(p, 'utf8');
const crlf = c.includes('\r\n');
if (crlf) c = c.replace(/\r\n/g, '\n');

if (!c.includes('一起听与视觉舞台')) {
  const block = [
    '## 一起听与视觉舞台',
    '',
    '- 一起听**收起控制台**时复用 `SongDetailView` 的 3D 舞台与 3D 歌词；**展开控制台时不显示**舞台。',
    '- 舞台 DOM（`#thumb-cover` / `#album-bg` / `#canvas-container`）仅在 SongDetail 挂载时存在。`syncTrackToVisual` 会先判断 DOM，避免 `null.src`。',
    '- 一起听与单曲「听一听」共用 `music-player.js` 的**同一 `<audio>`**；房间模式 `listenMode`，不显示歌曲悬浮条。',
    '- 同步不走 `timeupdate` 上报；服务器按 `position_ms + now - anchor_at` 推算，客户端约 5s 校准。',
    '',
    '## 酷狗接入说明',
  ].join('\n');
  c = c.replace('## 酷狗接入说明', block);
}

if (crlf) c = c.replace(/\n/g, '\r\n');
fs.writeFileSync(p, c, 'utf8');
console.log('MUSIC-VISUAL updated:', c.includes('一起听与视觉舞台'));
