import fs from 'node:fs';

function patch(p, pairs) {
  let c = fs.readFileSync(p, 'utf8');
  const crlf = c.includes('\r\n');
  if (crlf) c = c.replace(/\r\n/g, '\n');
  let n = 0;
  for (const [a, b] of pairs) {
    if (c.includes(a)) {
      c = c.split(a).join(b);
      n++;
    } else console.log('MISS', p, JSON.stringify(a.slice(0, 70)));
  }
  if (crlf) c = c.replace(/\n/g, '\r\n');
  fs.writeFileSync(p, c, 'utf8');
  console.log(p, n + '/' + pairs.length);
}

patch('client/src/components/SongDetailView.vue', [
  [
    "import { musicPlayer, fmtAudioTime } from '../music-player.js';",
    `import { musicPlayer, fmtAudioTime } from '../music-player.js';
import { listenTogether, control as listenControl } from '../listen-together.js';`,
  ],
  [
    "const emit = defineEmits(['close']);",
    `const emit = defineEmits(['close', 'invite-listen']);

function onPlayToggle() {
  if (listenTogether.inRoom) {
    if (!listenTogether.canControl) return;
    listenControl(listenTogether.state.room?.playing ? 'pause' : 'play');
    return;
  }
  musicPlayer.togglePlay();
}
function onPrev() {
  if (listenTogether.inRoom) {
    if (!listenTogether.canControl) return;
    listenControl('previous');
    return;
  }
  musicPlayer.prevTrack();
}
function onNext() {
  if (listenTogether.inRoom) {
    if (!listenTogether.canControl) return;
    listenControl('next');
    return;
  }
  musicPlayer.nextTrack();
}`,
  ],
  ['@click="musicPlayer.prevTrack()"', '@click="onPrev()"'],
  ['@click="musicPlayer.togglePlay()"', '@click="onPlayToggle()"'],
  ['@click="musicPlayer.nextTrack()"', '@click="onNext()"'],
  [
    '<button type="button" class="ctrl-btn" :class="{ active: showQueue }" title="当前队列"',
    `<button type="button" class="ctrl-btn" title="邀请一起听" @click="emit('invite-listen')">
            <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <circle cx="9" cy="8" r="3"/><path d="M3 19c0-3 3-5 6-5s6 2 6 5"/><path d="M18 8v6M15 11h6"/>
            </svg>
          </button>
          <button type="button" class="ctrl-btn" :class="{ active: showQueue }" title="当前队列"`,
  ],
]);

// MusicFloatBar: 真实宽度边界 + 一起听标识
patch('client/src/components/MusicFloatBar.vue', [
  [
    "import { musicPlayer, fmtAudioTime } from '../music-player.js';",
    `import { musicPlayer, fmtAudioTime } from '../music-player.js';
import { listenTogether, leaveRoom, control as listenControl } from '../listen-together.js';`,
  ],
  [
    `function snapX(x) {
  const w = window.innerWidth || 375;
  const size = 64;
  const pad = 8;`,
    `function elSize() {
  const el = document.querySelector('.music-float, .float-bar, [class*=float]');
  return {
    w: el?.offsetWidth || 168,
    h: el?.offsetHeight || 56,
  };
}

function snapX(x) {
  const w = window.innerWidth || 375;
  const size = elSize().w;
  const pad = 8;`,
  ],
  [
    `function clamp(x, y) {
  const w = window.innerWidth || 375;
  const h = window.innerHeight || 667;
  const size = 64;
  return {
    x: Math.min(Math.max(8, x), Math.max(8, w - size - 8)),
    y: Math.min(Math.max(8, y), Math.max(8, h - size - 8)),
  };
}`,
    `function clamp(x, y) {
  const w = window.innerWidth || 375;
  const h = window.innerHeight || 667;
  const size = elSize();
  return {
    x: Math.min(Math.max(8, x), Math.max(8, w - size.w - 8)),
    y: Math.min(Math.max(8, y), Math.max(8, h - size.h - 8)),
  };
}`,
  ],
]);

// PrivateChatView: AI 不展示一起听入口
patch('client/src/components/PrivateChatView.vue', [
  [
    '<button class="plus-item" type="button" @click="openListenTogether"><span class="plus-icon">🎧</span><span>一起听</span></button>',
    '<button v-if="!target?.isAI" class="plus-item" type="button" @click="openListenTogether"><span class="plus-icon">🎧</span><span>一起听</span></button>',
  ],
]);

// 一起听文案
patch('client/src/components/ListenTogetherView.vue', [
  ['点一首歌，开始一起听', '挑首歌，叫上朋友一起听。'],
  ['选择后创建房间并播放', '选好就开始，大家同步听。'],
  ['{{ room ? \'添加\' : \'点歌\' }}', '{{ room ? \'添加\' : \'开始一起听\' }}'],
  ['仅主持人可以操作', '现在由主持人控制播放。'],
  ['当前歌曲暂时无法播放', '这首歌暂时放不出来，换一首试试。'],
  ['主持人已转移', '接下来交给朋友。'],
]);
