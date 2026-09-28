import fs from 'node:fs';

function has(f, re) {
  if (!fs.existsSync(f)) return false;
  return re.test(fs.readFileSync(f, 'utf8'));
}

const server = 'server/listen-together.js';
const store = 'client/src/listen-together.js';
const player = 'client/src/music-player.js';
const chat = 'server/chat.js';
const view = 'client/src/components/ListenTogetherView.vue';
const card = 'client/src/components/ListenTogetherCard.vue';
const listen = 'client/src/components/ListenView.vue';
const song = 'client/src/components/SongDetailView.vue';
const float = 'client/src/components/MusicFloatBar.vue';
const settings = 'client/src/components/SettingsView.vue';
const visual = 'client/src/visual-stage.js';

const rows = [
  ['SQLite 房间表', has(server, /listen_rooms|CREATE TABLE IF NOT EXISTS listen/i)],
  ['commandId 防重', has(server, /commandId/) || has(store, /commandId/)],
  ['baseRevision', has(server, /baseRevision/) || has(store, /baseRevision/)],
  ['listen:command', has(server, /listen:command/) || has(store, /listen:command/)],
  ['revision 版本号', has(server, /revision/)],
  ['AI 私聊拒绝', has(server, /isAiConversation|_ai_/)],
  ['断线宽限再结束', has(server, /GRACE|RECONNECT_GRACE|宽限/)],
  ['player 显式 play/pause', has(player, /function playPlayback|play:\s*playPlayback|function pausePlayback/)],
  ['播放失败回报', has(player, /playFail|onListenPlayFail|reportPlayFail/)],
  ['曲目 privilege/hqHash', has(server, /hqHash/)],
  ['邀请文案[一起听]歌名', has(chat, /\[一起听\]/)],
  ['ListenView 会话选择', has(listen, /api\.chats|\/api\/chats|会话选择/)],
  ['SongDetail 邀请入口', has(song, /一起听|inviteListen|listenTogether/)],
  ['FloatBar 一起听', has(float, /listenTogether|一起听/)],
  ['点歌文案规范', has(view, /挑首歌|进去听听/)],
  ['设置页 Perry 署名', has(settings, /由 Perry 制作/)],
  ['歌词竞态 lastSongKey', has(visual, /lastSongKey/)],
  ['私聊 listentogether ext', has(chat, /listentogether/) && has(chat, /private:send|private_send/)],
];

let gaps = 0;
for (const [n, ok] of rows) {
  console.log(ok ? 'OK  ' : 'GAP ', n);
  if (!ok) gaps++;
}
console.log('\nGAPS', gaps, '/', rows.length);
