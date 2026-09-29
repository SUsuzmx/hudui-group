import fs from 'node:fs';

function patch(path, pairs) {
  let c = fs.readFileSync(path, 'utf8');
  const crlf = c.includes('\r\n');
  if (crlf) c = c.replace(/\r\n/g, '\n');
  let n = 0;
  for (const [from, to] of pairs) {
    if (c.includes(from)) {
      c = c.split(from).join(to);
      n++;
    } else {
      console.log('  MISS', path, JSON.stringify(from.slice(0, 70)));
    }
  }
  if (crlf) c = c.replace(/\n/g, '\r\n');
  fs.writeFileSync(path, c, 'utf8');
  console.log(path, n + '/' + pairs.length);
}

// ---- App.vue ----
patch('client/src/App.vue', [
  [
    "const MusicFloatBar = asyncPage(() => import('./components/MusicFloatBar.vue'));\nimport { musicPlayer } from './music-player.js';",
    `const MusicFloatBar = asyncPage(() => import('./components/MusicFloatBar.vue'));
const ListenTogetherView = asyncPage(() => import('./components/ListenTogetherView.vue'));
const ListenTogetherBar = asyncPage(() => import('./components/ListenTogetherBar.vue'));
import { musicPlayer } from './music-player.js';
import { listenTogether, leaveRoom, joinRoom, createRoom } from './listen-together.js';`,
  ],
  [
    `function openSub(payload) {
  if (payload?.type === 'video-call') {
    openVideoCall(payload);
    return;
  }
  nav.push();
  subView.value = payload;
  transitionName.value = 'page-push';
  view.value = 'sub';
}`,
    `function openSub(payload) {
  if (payload?.type === 'video-call') {
    openVideoCall(payload);
    return;
  }
  if (payload?.type === 'listen-together') {
    nav.push();
    subView.value = payload;
    transitionName.value = 'page-push';
    view.value = 'sub';
    return;
  }
  nav.push();
  subView.value = payload;
  transitionName.value = 'page-push';
  view.value = 'sub';
}

function openListenTogether() {
  if (!listenTogether.state.room) {
    toast('暂无一起听房间');
    return;
  }
  openSub({ type: 'listen-together' });
}

async function handleJoinListen(payload) {
  const ext = payload?.ext || {};
  const roomId = ext.roomId;
  if (!roomId) return;
  if (ext.ended) {
    toast('本次一起听已结束');
    return;
  }
  // 加入前提示将切换为房间歌曲
  if (musicPlayer.state.current && musicPlayer.state.current.id !== ext.id) {
    toast('将切换为房间歌曲');
  }
  const res = await joinRoom(roomId, { inviteMessageId: payload?.messageId });
  if (res?.ok) {
    openSub({ type: 'listen-together' });
  }
}`,
  ],
  [
    `      <div v-else-if="view === 'sub'" :key="'stub-' + (subView?.title || 'x')" class="stub-fallback">`,
    `      <ListenTogetherView
        v-else-if="view === 'sub' && subView?.type === 'listen-together'"
        key="listen-together"
        :me="me"
        @back="goBack"
        @open-chat="goBack"
      />
      <div v-else-if="view === 'sub'" :key="'stub-' + (subView?.title || 'x')" class="stub-fallback">`,
  ],
  [
    `    <!-- 通话：挂载后可最小化，不卸载以保持 WebRTC -->`,
    `    <!-- 一起听迷你条（聊天/列表可见时） -->
    <ListenTogetherBar
      v-if="listenTogether.inRoom && !(view === 'sub' && subView?.type === 'listen-together')"
      @open-room="openListenTogether"
    />

    <!-- 通话：挂载后可最小化，不卸载以保持 WebRTC -->`,
  ],
]);
