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

const conv = 'grp_1'; // 默认群
const ai = [];
sock.on('group:message', (m) => {
  if (m.senderType === 'ai') ai.push(m);
});

for (let round = 0; round < 3; round++) {
  ai.length = 0;
  await new Promise((resolve) => {
    sock.emit('message:send', { content: '在干什么', conversationId: conv }, resolve);
  });
  for (let i = 0; i < 20; i++) {
    await sleep(1500);
    if (ai.length) break;
  }
  const replies = ai.map((m) => `${m.senderName}: ${m.content}`);
  console.log('round', round + 1, replies);
  const bad = replies.some((t) => /:?\s*(有一说一|确实|对的|对啊|嗯|行吧)\s*$/.test(t));
  console.log(bad ? 'BAD_FILLER' : 'OK');
  await sleep(3000);
}

sock.close();
