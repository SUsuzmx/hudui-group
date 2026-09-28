// 私聊一起听：开房 → 邀请卡片 → 对方加入 → AI 私聊拒绝
import { io } from 'socket.io-client';

const BASE = process.env.BASE || 'http://127.0.0.1:3012';
let failed = 0;
const ok = (n, c, x = '') => {
  if (c) console.log('PASS', n, x);
  else {
    console.error('FAIL', n, x);
    failed++;
  }
};

async function req(path, body) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

function connect(token) {
  return new Promise((resolve, reject) => {
    const s = io(BASE, { auth: { token }, transports: ['websocket'], forceNew: true });
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
    setTimeout(() => reject(new Error('timeout')), 5000);
  });
}

function emitAck(s, event, payload) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({ error: 'ack timeout' }), 6000);
    s.emit(event, payload, (res) => {
      clearTimeout(t);
      resolve(res || {});
    });
  });
}

const suffix = Date.now().toString(36).slice(-5);
const a = await req('/api/register', { nickname: `pv_a_${suffix}`, password: 'pass1234' });
const b = await req('/api/register', { nickname: `pv_b_${suffix}`, password: 'pass1234' });
const c = await req('/api/register', { nickname: `pv_c_${suffix}`, password: 'pass1234' });
ok('register', a.token && b.token && c.token);

const s1 = await connect(a.token);
const s2 = await connect(b.token);
const s3 = await connect(c.token);

const uid = (x) => Number(x.user.id);
const pv = `pv_u_${Math.min(uid(a), uid(b))}_${Math.max(uid(a), uid(b))}`;
const track = { id: 'pv-song-1', source: 'qq', title: '私聊一起听', artist: 'Test' };

// 1. 私聊开房
const created = await emitAck(s1, 'listen:create', { conversationId: pv, track });
ok('私聊创建房间', created.ok, created.error || '');
const roomId = created.room?.id || created.room?.sessionId;

// 2. 发邀请卡片（private:send）
const sent = await emitAck(s1, 'private:send', {
  conversationId: pv,
  content: `[一起听] ${track.title}`,
  mediaType: 'listentogether',
  ext: {
    kind: 'listen',
    roomId,
    sessionId: roomId,
    title: track.title,
    artist: track.artist,
    cover: '',
    source: 'qq',
    hostName: 'A',
    memberCount: 1,
    id: track.id,
    status: 'active',
  },
});
ok('私聊发送邀请卡片', sent.ok && sent.id, JSON.stringify(sent).slice(0, 100));

// 3. 对方历史能读到卡片
const hist = await emitAck(s2, 'private:history', { conversationId: pv });
const list = Array.isArray(hist) ? hist : hist?.messages || [];
const card = [...list].reverse().find((m) => m.mediaType === 'listentogether');
ok('对方看到卡片', Boolean(card), card ? `id=${card.id} content=${card.content}` : `rows=${list.length}`);
const ext = card?.ext || {};
const joinId = ext.roomId || ext.sessionId;
ok('卡片含 roomId', Boolean(joinId), JSON.stringify(ext).slice(0, 80));
ok('卡片文案', String(card?.content || '').includes('一起听'), card?.content);

// 4. 对方点「进去听听」加入
const joined = await emitAck(s2, 'listen:join', {
  sessionId: joinId,
  roomId: joinId,
  inviteMessageId: card?.id,
});
ok('对方加入私聊房间', joined.ok && joined.room, joined.error || '');
ok('成员列表含对方', joined.room?.members?.some((m) => Number(m.userId) === uid(b)), '');

// 5. 第三方无权加入
const outsider = await emitAck(s3, 'listen:join', {
  sessionId: roomId,
  roomId,
  inviteMessageId: card?.id,
});
ok('第三方被拒绝', Boolean(outsider.error), outsider.error || 'joined!');

// 6. AI 私聊拒绝开房
const aiConv = `pv_${uid(a)}_ai_siqi`;
const aiCreate = await emitAck(s1, 'listen:create', {
  conversationId: aiConv,
  track: { id: 'x', source: 'qq', title: 'x' },
});
ok('AI 私聊拒绝开房', Boolean(aiCreate.error), aiCreate.error || 'created!');

// 7. 同一会话只能一个房间
const dup = await emitAck(s1, 'listen:create', { conversationId: pv, track });
ok('私聊一房限制', dup.error || dup.roomId === roomId || dup.room?.id === roomId, JSON.stringify(dup).slice(0, 80));

s1.disconnect();
s2.disconnect();
s3.disconnect();
console.log(failed ? `FAILED ${failed}` : 'PRIVATE-CHAT LISTEN-TOGETHER PASSED');
process.exit(failed ? 1 : 0);
