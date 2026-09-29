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
      console.log('  MISS', path, JSON.stringify(from.slice(0, 80)));
    }
  }
  if (crlf) c = c.replace(/\n/g, '\r\n');
  fs.writeFileSync(path, c, 'utf8');
  console.log(path, n + '/' + pairs.length);
}

const chatImports = `import WxPayCard from './WxPayCard.vue';`;
const chatImportsNew = `import WxPayCard from './WxPayCard.vue';
import ListenTogetherCard from './ListenTogetherCard.vue';
import ListenTogetherBar from './ListenTogetherBar.vue';
import {
  listenTogether,
  createRoom,
  joinRoom,
  leaveRoom,
} from '../listen-together.js';
import { musicPlayer } from '../music-player.js';`;

const chatPlus = `          <button class="plus-item" type="button" @click="openGroupTools"><span class="plus-icon">🧰</span><span>群工具</span></button>`;
const chatPlusNew = `          <button class="plus-item" type="button" @click="openListenTogether"><span class="plus-icon">🎧</span><span>一起听</span></button>
          <button class="plus-item" type="button" @click="openGroupTools"><span class="plus-icon">🧰</span><span>群工具</span></button>`;

const chatCard = `            <WxPayCard
              v-else-if="payKindOf(m)"`;
const chatCardNew = `            <ListenTogetherCard
              v-else-if="m.mediaType === 'listentogether'"
              class="bubble"
              :ext="parseExt(m)"
              :is-mine="isMineMsg(m)"
              :member-count="parseExt(m).memberCount || 1"
              :status="parseExt(m).ended ? 'ended' : ''"
              @join="onJoinListenCard(m)"
            />
            <WxPayCard
              v-else-if="payKindOf(m)"`;

// ChatView helpers before openRedPacketSheet
const chatHelpersAnchor = `function openRedPacketSheet() {`;
const chatHelpers = `async function openListenTogether() {
  dockMode.value = 0;
  const conv = conversationId.value || 'default';
  const existing = listenTogether.state.room;
  if (existing && existing.conversationId === conv) {
    emit('open-view', { type: 'listen-together' });
    return;
  }
  if (existing) {
    showToast('请先退出当前一起听');
    return;
  }
  const cur = musicPlayer.state.current;
  const track = cur
    ? {
        id: cur.id,
        source: cur.source || 'qq',
        title: cur.title || cur.name || '未知歌曲',
        artist: cur.artist || '',
        cover: cur.cover || cur.picUrl || '',
        duration: cur.duration || 0,
        mid: cur.mid,
        mediaMid: cur.mediaMid,
        hash: cur.hash,
        albumId: cur.albumId,
        albumAudioId: cur.albumAudioId,
        mixSongId: cur.mixSongId,
      }
    : {
        id: 'demo-1',
        source: 'qq',
        title: '一起听',
        artist: '从听一听选歌',
        cover: '',
        duration: 0,
      };
  if (musicPlayer.state.current) showToast('将切换为房间歌曲');
  const res = await createRoom({ conversationId: conv, track });
  if (res?.ok && res.room) {
    // 发送邀请卡片
    const ext = {
      roomId: res.room.id,
      title: track.title,
      artist: track.artist,
      cover: track.cover,
      source: track.source,
      hostName: props.me?.nickname || '我',
      memberCount: 1,
      id: track.id,
    };
    socket?.emit('message:send', {
      conversationId: conv,
      content: '',
      mediaType: 'listentogether',
      ext,
    }, () => {});
    emit('open-view', { type: 'listen-together' });
  }
}

async function onJoinListenCard(m) {
  const ext = parseExt(m);
  if (ext?.ended) {
    showToast('本次一起听已结束');
    return;
  }
  if (!ext?.roomId) {
    showToast('房间已结束');
    return;
  }
  if (listenTogether.state.room && listenTogether.state.room.id !== ext.roomId) {
    showToast('请先退出当前一起听');
    return;
  }
  if (musicPlayer.state.current) showToast('将切换为房间歌曲');
  const res = await joinRoom(ext.roomId, { inviteMessageId: m.id });
  if (res?.ok) emit('open-view', { type: 'listen-together' });
}

function openRedPacketSheet() {`;

// Mini bar at top of chat template - find chat header end
const barAnchor = `    <footer v-if="!booting" class="composer">`;
const barNew = `    <ListenTogetherBar
      v-if="listenTogether.inRoom && listenTogether.state.room?.conversationId === (conversationId || 'default')"
      @open-room="emit('open-view', { type: 'listen-together' })"
    />

    <footer v-if="!booting" class="composer">`;

patch('client/src/components/ChatView.vue', [
  [chatImports, chatImportsNew],
  [chatPlus, chatPlusNew],
  [chatCard, chatCardNew],
  [chatHelpersAnchor, chatHelpers],
  [barAnchor, barNew],
]);

// PrivateChatView similar
const pImports = `import WxPayCard from './WxPayCard.vue';
import WxPayOverlay from './WxPayOverlay.vue';`;
const pImportsNew = `import WxPayCard from './WxPayCard.vue';
import WxPayOverlay from './WxPayOverlay.vue';
import ListenTogetherCard from './ListenTogetherCard.vue';
import ListenTogetherBar from './ListenTogetherBar.vue';
import {
  listenTogether,
  createRoom,
  joinRoom,
} from '../listen-together.js';
import { musicPlayer } from '../music-player.js';`;

// Private plus panel - find a good anchor
const pPlus = `          <button class="plus-item" type="button" @click="openFavPicker">`;
const pPlusNew = `          <button class="plus-item" type="button" @click="openListenTogether"><span class="plus-icon">🎧</span><span>一起听</span></button>
          <button class="plus-item" type="button" @click="openFavPicker">`;

const pCard = `            <WxPayCard
              v-else-if="payKindOf(m)"`;
const pCardNew = `            <ListenTogetherCard
              v-else-if="m.mediaType === 'listentogether'"
              class="bubble"
              :ext="parseExt(m)"
              :is-mine="isMine(m)"
              :member-count="parseExt(m).memberCount || 1"
              :status="parseExt(m).ended ? 'ended' : ''"
              @join="onJoinListenCard(m)"
            />
            <WxPayCard
              v-else-if="payKindOf(m)"`;

const pHelpersAnchor = `function openFileMsg(m) {`;
const pHelpers = `async function openListenTogether() {
  const conv = conversationId.value;
  const existing = listenTogether.state.room;
  if (existing && existing.conversationId === conv) {
    emit('open-view', { type: 'listen-together' });
    return;
  }
  if (existing) {
    showToast('请先退出当前一起听');
    return;
  }
  const cur = musicPlayer.state.current;
  const track = cur
    ? {
        id: cur.id,
        source: cur.source || 'qq',
        title: cur.title || cur.name || '未知歌曲',
        artist: cur.artist || '',
        cover: cur.cover || cur.picUrl || '',
        duration: cur.duration || 0,
      }
    : { id: 'demo-1', source: 'qq', title: '一起听', artist: '从听一听选歌', cover: '', duration: 0 };
  if (cur) showToast('将切换为房间歌曲');
  const res = await createRoom({ conversationId: conv, track });
  if (res?.ok && res.room) {
    const ext = {
      roomId: res.room.id,
      title: track.title,
      artist: track.artist,
      cover: track.cover,
      source: track.source,
      hostName: props.me?.nickname || '我',
      memberCount: 1,
      id: track.id,
    };
    socket?.emit('private:send', {
      conversationId: conv,
      content: '',
      mediaType: 'listentogether',
      ext,
    }, () => {});
    emit('open-view', { type: 'listen-together' });
  }
}

async function onJoinListenCard(m) {
  const ext = parseExt(m);
  if (ext?.ended) {
    showToast('本次一起听已结束');
    return;
  }
  if (!ext?.roomId) {
    showToast('房间已结束');
    return;
  }
  if (musicPlayer.state.current) showToast('将切换为房间歌曲');
  const res = await joinRoom(ext.roomId, { inviteMessageId: m.id });
  if (res?.ok) emit('open-view', { type: 'listen-together' });
}

function openFileMsg(m) {`;

const pBar = `    <footer class="composer">`;
const pBarNew = `    <ListenTogetherBar
      v-if="listenTogether.inRoom && listenTogether.state.room?.conversationId === conversationId"
      @open-room="emit('open-view', { type: 'listen-together' })"
    />

    <footer class="composer">`;

patch('client/src/components/PrivateChatView.vue', [
  [pImports, pImportsNew],
  [pPlus, pPlusNew],
  [pCard, pCardNew],
  [pHelpersAnchor, pHelpers],
  [pBar, pBarNew],
]);
