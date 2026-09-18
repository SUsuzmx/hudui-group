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
const token = login.token || login.data?.token;
console.log('login ok', Boolean(token));

const sock = io(BASE, { auth: { token }, transports: ['websocket'] });
await new Promise((resolve, reject) => {
  sock.on('connect', resolve);
  sock.on('connect_error', reject);
  setTimeout(() => reject(new Error('conn timeout')), 8000);
});

// 进产品群并@思琪
const conv = 'grp_2';
sock.emit('group:join', conv);
const aiMsgs = [];
sock.on('group:message', (m) => {
  if (m.conversationId === conv && m.senderType === 'ai') aiMsgs.push(m);
});

await new Promise((resolve) => {
  sock.emit('message:send', { content: '@思琪 这版设计你看下, 顺便发张参考图', conversationId: conv }, resolve);
});
console.log('sent to product group');

// 等 AI 回复 (LLM + 可能生图)
for (let i = 0; i < 24; i++) {
  await sleep(2500);
  if (aiMsgs.length) {
    console.log('AI replies', aiMsgs.map((m) => `${m.senderName}:${(m.content||'').slice(0,40)}${m.mediaType?'['+m.mediaType+']':''}`));
    if (aiMsgs.some((m) => m.mediaType === 'image') || i > 12) break;
  }
}
if (!aiMsgs.length) console.log('no AI reply yet');
sock.close();
process.exit(0);
