import { io } from 'socket.io-client';

const BASE = 'http://127.0.0.1:3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, body) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

const login = await api('/api/login', { nickname: '验证员205', password: 'test1234' });
const token = login.token;
const meId = login.user.id;

const sock = io(BASE, { auth: { token }, transports: ['websocket'] });
await new Promise((resolve, reject) => {
  sock.on('connect', resolve);
  sock.on('connect_error', reject);
  setTimeout(() => reject(new Error('timeout')), 8000);
});

async function testPrivate(personaId, content) {
  const convId = `pv_${meId}_ai_${personaId}`;
  const msgs = [];
  const onMsg = (m) => {
    if (m.conversationId === convId && m.senderType === 'ai') msgs.push(m);
  };
  sock.on('private:message', onMsg);
  sock.emit('private:join', convId);
  await sleep(150);
  await new Promise((resolve) => {
    sock.emit('private:send', { conversationId: convId, content }, resolve);
  });
  for (let i = 0; i < 20; i++) {
    await sleep(1500);
    if (msgs.length) break;
  }
  sock.off('private:message', onMsg);
  console.log(personaId, msgs.map((m) => `${m.senderName}:${(m.content || '').slice(0, 30)}`));
  return msgs.length > 0;
}

const r1 = await testPrivate('linxiao', '需求评审什么时候开?');
const r2 = await testPrivate('sulaoshi', '老师作业截止到周五吗?');
const r3 = await testPrivate('azhe', '晚上撸串不?');
const r4 = await testPrivate('ad-xiaoge', '最近有什么优惠?');

console.log('RESULTS', { linxiao: r1, sulaoshi: r2, azhe: r3, ad: r4 });
sock.close();
process.exit(r1 && r2 && r3 && r4 ? 0 : 1);
