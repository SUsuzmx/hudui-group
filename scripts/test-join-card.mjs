// 邀请卡片 → 好友加入房间
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
const a = await req('/api/register', { nickname: `join_a_${suffix}`, password: 'pass1234' });
const b = await req('/api/register', { nickname: `join_b_${suffix}`, password: 'pass1234' });
const s1 = await connect(a.token);
const s2 = await connect(b.token);

const track = { id: 'join-1', source: 'qq', title: '加入测试曲', artist: 'T' };
const created = await emitAck(s1, 'listen:create', { conversationId: 'default', track });
ok('create', created.ok, created.error || '');
const roomId = created.room?.id || created.room?.sessionId;

const sent = await emitAck(s1, 'message:send', {
  conversationId: 'default',
  content: `[一起听] ${track.title}`,
  mediaType: 'listentogether',
  ext: {
    kind: 'listen',
    roomId,
    sessionId: roomId,
    title: track.title,
    artist: track.artist,
    status: 'active',
    hostName: 'A',
    id: track.id,
  },
});
ok('send card', sent.ok && sent.id, JSON.stringify(sent).slice(0, 80));

const hist = await emitAck(s2, 'history:load', { conversationId: 'default' });
const list = Array.isArray(hist) ? hist : [];
const card = [...list].reverse().find((m) => m.mediaType === 'listentogether');
ok('friend sees card', Boolean(card), card?.id);
const ext = card?.ext || {};
const joinId = ext.roomId || ext.sessionId;
ok('card has roomId', Boolean(joinId), JSON.stringify(ext).slice(0, 60));

const joined = await emitAck(s2, 'listen:join', {
  sessionId: joinId,
  roomId: joinId,
  inviteMessageId: card?.id,
});
ok('friend join', joined.ok && joined.room, joined.error || '');
ok('member in room', joined.room?.members?.some((m) => m.userId === b.user.id), '');

s1.disconnect();
s2.disconnect();
console.log(failed ? `FAILED ${failed}` : 'JOIN-FROM-CARD PASSED');
process.exit(failed ? 1 : 0);
