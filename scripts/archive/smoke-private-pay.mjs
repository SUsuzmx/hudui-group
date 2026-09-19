// 私聊红包/转账冒烟
import { io } from 'socket.io-client';

const BASE = process.env.BASE || 'http://127.0.0.1:3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, { method = 'POST', body, token } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

function connect(token) {
  return new Promise((resolve, reject) => {
    const s = io(BASE, { auth: { token }, transports: ['websocket'] });
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
    setTimeout(() => reject(new Error('timeout')), 8000);
  });
}

const nickA = '私聊甲' + Date.now().toString(36).slice(-4);
const nickB = '私聊乙' + Date.now().toString(36).slice(-4);
const a = await api('/api/register', { body: { nickname: nickA, password: 'test1234' } });
const b = await api('/api/register', { body: { nickname: nickB, password: 'test1234' } });
console.log('register', a.status, b.status);
const ta = a.data.token;
const tb = b.data.token;
const idA = a.data.user.id;
const idB = b.data.user.id;

// 加好友
const add = await api('/api/friends', { token: ta, body: { friendId: idB } });
console.log('add friend', add.status, add.data);

const sa = await connect(ta);
const sb = await connect(tb);
const conv = `pv_u_${Math.min(idA, idB)}_${Math.max(idA, idB)}`;
sa.emit('private:join', conv);
sb.emit('private:join', conv);
await sleep(200);

function emit(sock, ev, payload) {
  return new Promise((resolve) => sock.emit(ev, payload, resolve));
}

const rp = await emit(sa, 'private:send', {
  conversationId: conv,
  content: '[微信红包]测试红包',
  mediaType: 'redpacket',
  ext: { amount: 1.23, note: '测试红包', rpType: 'exclusive', rpCount: 1, cover: 'classic' },
});
console.log('redpacket send', JSON.stringify(rp));

const tf = await emit(sa, 'private:send', {
  conversationId: conv,
  content: '[转账]¥2.5',
  mediaType: 'transfer',
  ext: { amount: 2.5, note: '测试转账' },
});
console.log('transfer send', JSON.stringify(tf));

await sleep(400);
const hist = await emit(sb, 'private:history', { conversationId: conv });
const rpMsg = (hist || []).find((m) => m.mediaType === 'redpacket');
const tfMsg = (hist || []).find((m) => m.mediaType === 'transfer');
console.log('history rp', rpMsg ? { id: rpMsg.id, ext: rpMsg.ext && { packetId: rpMsg.ext.packetId, amount: rpMsg.ext.amount, status: rpMsg.ext.status } } : null);
console.log('history tf', tfMsg ? { id: tfMsg.id, ext: tfMsg.ext && { transferId: tfMsg.ext.transferId, amount: tfMsg.ext.amount, status: tfMsg.ext.status } } : null);

// B 领红包
let claim = null;
if (rpMsg?.ext?.packetId || rpMsg?.id) {
  claim = await emit(sb, 'redpacket:claim', { messageId: rpMsg.id, packetId: rpMsg.ext?.packetId });
  console.log('claim rp', JSON.stringify({ ok: claim?.ok, amount: claim?.amount, error: claim?.error }));
}

// B 确认转账
let claimTf = null;
if (tfMsg?.ext?.transferId || tfMsg?.id) {
  claimTf = await emit(sb, 'transfer:claim', { messageId: tfMsg.id, transferId: tfMsg.ext?.transferId });
  console.log('claim tf', JSON.stringify({ ok: claimTf?.ok, amount: claimTf?.amount, error: claimTf?.error }));
}

sa.disconnect();
sb.disconnect();
const ok = rp?.ok && tf?.ok && rpMsg && tfMsg && claim?.ok && claimTf?.ok;
console.log(ok ? 'PRIVATE PAY OK' : 'PRIVATE PAY FAIL');
process.exit(ok ? 0 : 1);
