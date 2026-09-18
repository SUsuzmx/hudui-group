// 音视频通话信令冒烟（不含真实 WebRTC 媒体）
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

const nickA = '通话甲' + Date.now().toString(36).slice(-4);
const nickB = '通话乙' + Date.now().toString(36).slice(-4);
const a = await api('/api/register', { body: { nickname: nickA, password: 'test1234' } });
const b = await api('/api/register', { body: { nickname: nickB, password: 'test1234' } });
console.log('register', a.status, b.status);
const ta = a.data.token;
const tb = b.data.token;
const idA = a.data.user.id;
const idB = b.data.user.id;

const sa = await connect(ta);
const sb = await connect(tb);
await sleep(300);

const events = [];
sb.on('call:incoming', (p) => events.push({ ev: 'incoming', p }));
sa.on('call:accepted', (p) => events.push({ ev: 'accepted', p }));
sa.on('call:rejected', (p) => events.push({ ev: 'rejected', p }));
sb.on('call:offer', (p) => events.push({ ev: 'offer', p }));
sa.on('call:answer', (p) => events.push({ ev: 'answer', p }));
sb.on('call:ice', (p) => events.push({ ev: 'ice', p }));
// 挂断事件发给对端
sb.on('call:ended', (p) => events.push({ ev: 'ended-b', p }));
sa.on('call:ended', (p) => events.push({ ev: 'ended-a', p }));

// 离线呼叫应失败
const offline = await new Promise((r) => {
  sa.emit('call:invite', { toUserId: 999999, mode: 'video' }, r);
});
console.log('invite offline', offline);

// 正常呼叫
const invite = await new Promise((r) => {
  sa.emit('call:invite', { toUserId: idB, mode: 'voice' }, r);
});
console.log('invite', invite);
await sleep(400);
const incoming = events.find((e) => e.ev === 'incoming');
console.log('B incoming?', !!incoming, incoming?.p?.from?.nickname, incoming?.p?.mode);

if (!invite?.ok || !incoming) {
  console.log('FAIL invite/incoming');
  process.exit(1);
}

const accept = await new Promise((r) => {
  sb.emit('call:accept', { callId: invite.callId }, r);
});
console.log('accept', accept);
await sleep(200);
console.log('A got accepted?', events.some((e) => e.ev === 'accepted'));

// 模拟 WebRTC 信令中继
const offer = await new Promise((r) => {
  sa.emit('call:offer', { callId: invite.callId, sdp: { type: 'offer', sdp: 'v=0 fake' } }, r);
});
const answer = await new Promise((r) => {
  sb.emit('call:answer', { callId: invite.callId, sdp: { type: 'answer', sdp: 'v=0 fake' } }, r);
});
const ice = await new Promise((r) => {
  sa.emit('call:ice', { callId: invite.callId, candidate: { candidate: 'fake' } }, r);
});
console.log('relay', offer, answer, ice);
await sleep(300);
console.log('events', events.map((e) => e.ev).join(','));

const end = await new Promise((r) => {
  sa.emit('call:end', { callId: invite.callId, duration: 3 }, r);
});
console.log('end', end);
await sleep(200);

// 通话记录是否写入私聊
const pv = `pv_u_${Math.min(idA, idB)}_${Math.max(idA, idB)}`;
const hist = await new Promise((r) => {
  sb.emit('private:history', { conversationId: pv }, (rows) => r(rows));
});
const callLogs = (hist || []).filter((m) => m.senderType === 'system' && /通话/.test(String(m.content || '')));
console.log('call logs', callLogs.map((m) => m.content));

sa.disconnect();
sb.disconnect();
const ok =
  invite.ok &&
  Boolean(incoming) &&
  accept.ok &&
  offer.ok &&
  answer.ok &&
  ice.ok &&
  events.some((e) => e.ev === 'accepted') &&
  events.some((e) => e.ev === 'offer') &&
  events.some((e) => e.ev === 'answer') &&
  events.some((e) => e.ev === 'ice') &&
  events.some((e) => e.ev === 'ended-b') &&
  callLogs.length > 0;
console.log(ok ? 'SIGNALING OK' : 'SIGNALING FAIL');
process.exit(ok ? 0 : 1);
