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
const sock = io(BASE, { auth: { token: login.token }, transports: ['websocket'] });
await new Promise((resolve, reject) => {
  sock.on('connect', resolve);
  sock.on('connect_error', reject);
  setTimeout(() => reject(new Error('timeout')), 8000);
});

const conv = 'grp_4';
const ai = [];
const all = [];
sock.on('group:message', (m) => {
  all.push(`${m.conversationId}|${m.senderType}|${m.senderName}:${(m.content || '').slice(0, 24)}`);
  if (m.conversationId === conv && m.senderType === 'ai') ai.push(m);
});
sock.emit('group:join', conv);

const sent = await new Promise((resolve) => {
  sock.emit('message:send', { content: '这周爬山还去吗', conversationId: conv }, resolve);
});
console.log('sent', sent);
for (let i = 0; i < 30; i++) {
  await sleep(2000);
  if (ai.length) break;
}
console.log('all msgs', all);
console.log('climb AI', ai.map((m) => `${m.senderName}:${m.content}`));
sock.close();
process.exit(ai.length ? 0 : 1);
