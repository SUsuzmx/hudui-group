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
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function connect(token) {
  return new Promise((resolve, reject) => {
    const s = io(BASE, { auth: { token }, transports: ['websocket'] });
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
    setTimeout(() => reject(new Error('socket timeout')), 8000);
  });
}

const nickA = '红包甲' + Date.now().toString(36).slice(-4);
const nickB = '红包乙' + Date.now().toString(36).slice(-4);
const a = await api('/api/register', { body: { nickname: nickA, password: 'test1234' } });
const b = await api('/api/register', { body: { nickname: nickB, password: 'test1234' } });
console.log('register', a.status, b.status);
const ta = a.data.token;
const tb = b.data.token;
const uidB = b.data.user.id;

const chats = await api('/api/chats', { method: 'GET', token: ta });
const group = (chats.data.chats || []).find((c) => c.type === 'group');
const conv = group?.conversationId || 'grp_1';
console.log('conv', conv);

const sa = await connect(ta);
const sb = await connect(tb);
sa.emit('group:join', conv);
sb.emit('group:join', conv);

// 拼手气红包
const send = await new Promise((resolve) => {
  sa.emit('message:send', {
    conversationId: conv,
    content: '[微信红包]拼手气恭喜发财',
    mediaType: 'redpacket',
    ext: { amount: 1.0, note: '拼手气', rpType: 'lucky', rpCount: 2, cover: 'gold' },
  }, resolve);
});
console.log('send lucky', JSON.stringify(send));
await sleep(300);

// B 领取
const claim1 = await new Promise((resolve) => {
  sb.emit('redpacket:claim', { messageId: send.id }, resolve);
});
console.log('claim1', JSON.stringify({
  ok: claim1?.ok,
  amount: claim1?.amount,
  isBest: claim1?.isBest,
  status: claim1?.status,
  claims: claim1?.payload?.claims,
  left: claim1?.payload?.leftCount,
  cover: claim1?.payload?.coverEmoji,
}));

// 重复领取
const claim2 = await new Promise((resolve) => {
  sb.emit('redpacket:claim', { messageId: send.id }, resolve);
});
console.log('claim2 duplicate', claim2?.ok, claim2?.status, claim2?.amount);

// 专属红包
const send2 = await new Promise((resolve) => {
  sa.emit('message:send', {
    conversationId: conv,
    content: '[微信红包]专属',
    mediaType: 'redpacket',
    ext: { amount: 0.88, note: '专属给你', rpType: 'exclusive', rpCount: 1, cover: 'love' },
  }, resolve);
});
const claim3 = await new Promise((resolve) => {
  sb.emit('redpacket:claim', { messageId: send2.id }, resolve);
});
console.log('exclusive claim', claim3?.ok, claim3?.amount, claim3?.payload?.coverEmoji);

const walletB = await api('/api/wallet', { method: 'GET', token: tb });
console.log('B balance', walletB.data.balance);
const covers = await api('/api/redpacket/covers', { method: 'GET', token: ta });
console.log('covers', covers.data.covers?.length);

sa.disconnect();
sb.disconnect();
console.log('DONE');
