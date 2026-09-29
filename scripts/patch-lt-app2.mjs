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
    } else {
      console.log('MISS', JSON.stringify(a.slice(0, 70)));
    }
  }
  if (crlf) c = c.replace(/\n/g, '\r\n');
  fs.writeFileSync(p, c, 'utf8');
  console.log(p, n + '/' + pairs.length);
}

patch('client/src/App.vue', [
  [
    `        @open-video-call="openVideoCall"
      />
      <PrivateChatView`,
    `        @open-video-call="openVideoCall"
        @open-view="openSub"
      />
      <PrivateChatView`,
  ],
  [
    `        @open-video-call="openVideoCall"
      />
      <GroupSettingsView`,
    `        @open-video-call="openVideoCall"
        @open-view="openSub"
      />
      <GroupSettingsView`,
  ],
]);

// ListenView: 邀请好友一起听入口（当前歌曲菜单）
// 在页面 script 增加 handler，模板尽量找「更多/菜单」按钮附近插入
const listenPath = 'client/src/components/ListenView.vue';
let lv = fs.readFileSync(listenPath, 'utf8');
const crlf = lv.includes('\r\n');
if (crlf) lv = lv.replace(/\r\n/g, '\n');

if (!lv.includes('邀请好友一起听')) {
  // script 注入
  if (lv.includes("import { musicPlayer")) {
    lv = lv.replace(
      /import \{ musicPlayer/,
      `import { listenTogether, createRoom } from '../listen-together.js';\nimport { musicPlayer`
    );
  } else {
    lv = lv.replace(
      '<script setup>',
      `<script setup>
import { listenTogether, createRoom } from '../listen-together.js';`
    );
  }
  const handler = `
const emitListenInvite = defineEmits ? null : null;
async function inviteListenTogether() {
  const cur = musicPlayer.state.current;
  if (!cur) {
    toast?.('请先播放一首歌');
    return;
  }
  if (listenTogether.state.room) {
    toast?.('已有进行中的一起听');
    return;
  }
  const track = {
    id: cur.id,
    source: cur.source || 'qq',
    title: cur.title || cur.name || '未知歌曲',
    artist: cur.artist || '',
    cover: cur.cover || cur.picUrl || '',
    duration: cur.duration || 0,
  };
  // 默认关联当前会话（由聊天页创建更准确）；听一听入口创建到默认群
  const res = await createRoom({ conversationId: 'default', track });
  if (res?.ok) toast?.('已创建一起听，请到聊天中邀请');
}
`;
  lv = lv.replace('<script setup>', '<script setup>\n' + handler);
  // 在现有导出/模板按钮旁加一个入口：找 class 含 more/menu 的按钮或页面底部
  if (lv.includes('class="more-btn"') || lv.includes('class="player-more"')) {
    lv = lv.replace(
      /class="(more-btn|player-more)"/,
      'class="$1" @click="inviteListenTogether"'
    );
  } else {
    // 插入一个悬浮入口
    lv = lv.replace(
      '</template>',
      `  <button class="lt-invite-fab" type="button" @click="inviteListenTogether">邀请好友一起听</button>\n</template>`
    );
    lv = lv.replace(
      '</style>',
      `.lt-invite-fab{position:fixed;right:12px;bottom:calc(88px + env(safe-area-inset-bottom,0px));z-index:20;border:0;border-radius:999px;padding:10px 14px;background:#07c160;color:#fff;font-size:12px;box-shadow:0 4px 12px rgba(7,193,96,.35)}\n</style>`
    );
    if (!lv.includes('</style>')) {
      lv += '\n<style scoped>\n.lt-invite-fab{position:fixed;right:12px;bottom:calc(88px + env(safe-area-inset-bottom,0px));z-index:20;border:0;border-radius:999px;padding:10px 14px;background:#07c160;color:#fff;font-size:12px}\n</style>\n';
    }
  }
}
if (crlf) lv = lv.replace(/\n/g, '\r\n');
fs.writeFileSync(listenPath, lv, 'utf8');
console.log('ListenView invite hooked:', lv.includes('邀请好友一起听'));
