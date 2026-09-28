// 验证：创建一起听后邀请卡片进入会话
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
const a = await req('/api/register', { nickname: `inv_a_${suffix}`, password: 'pass1234' });
const b = await req('/api/register', { nickname: `inv_b_${suffix}`, password: 'pass1234' });
ok('register', a.token && b.token);

const s1 = await connect(a.token);
const s2 = await connect(b.token);

// 用 createRoom 同款路径：listen:create + message:send
const track = { id: 'inv-1', source: 'qq', title: '测试邀请曲', artist: '测试' };
const created = await emitAck(s1, 'listen:create', { conversationId: 'default', track });
ok('create room', created.ok, created.error || '');
const roomId = created.room?.id || created.room?.sessionId;

const ext = {
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
};
const sent = await emitAck(s1, 'message:send', {
  conversationId: 'default',
  content: `[一起听] ${track.title}`,
  mediaType: 'listentogether',
  ext,
});
ok('message:send card', sent.ok && sent.id, JSON.stringify(sent).slice(0, 120));

const history = await emitAck(s2, 'history:load', { conversationId: 'default' });
const list = Array.isArray(history) ? history : history?.messages || [];
const card = [...list].reverse().find((m) => m.mediaType === 'listentogether' && String(m.content || '').includes(track.title))
  || [...list].reverse().find((m) => m.mediaType === 'listentogether');
ok('card in history', Boolean(card), card ? `id=${card.id} content=${card.content}` : `rows=${list.length}`);
ok('card ext roomId', card?.ext?.roomId === roomId || card?.ext?.sessionId === roomId, `want=${roomId} got=${card?.ext?.roomId || card?.ext?.sessionId}`);

// 私聊
const pv = `pv_u_${Math.min(a.user.id, b.user.id)}_${Math.max(a.user.id, b.user.id)}`;
const pvCreate = await emitAck(s1, 'listen:create', { conversationId: pv, track: { id: 'inv-pv', source: 'qq', title: '私聊邀请曲' } });
ok('pv create', pvCreate.ok, pvCreate.error || '');
const pvSent = await emitAck(s1, 'private:send', {
  conversationId: pv,
  content: '[一起听] 私聊邀请曲',
  mediaType: 'listentogether',
  ext: { kind: 'listen', roomId: pvCreate.room?.id, title: '私聊邀请曲', status: 'active' },
});
ok('pv message send', pvSent.ok && (pvSent.id || pvSent.ok), JSON.stringify(pvSent).slice(0, 100));

const pvHist = await emitAck(s2, 'private:history', { conversationId: pv });
const pvList = Array.isArray(pvHist) ? pvHist : pvHist?.messages || [];
const pvCard = pvList.find((m) => m.mediaType === 'listentogether' || String(m.content || '').includes('一起听'));
ok('pv card in history', Boolean(pvCard), pvCard ? `id=${pvCard.id}` : `rows=${pvList.length}`);

s1.disconnect();
s2.disconnect();
console.log(failed ? `FAILED ${failed}` : 'INVITE CARD CHECKS PASSED');
process.exit(failed ? 1 : 0);
