import { io } from 'socket.io-client';

const BASE = 'http://127.0.0.1:3000';

async function login() {
  const res = await fetch(BASE + '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nickname: '验证员205', password: 'test1234' }),
  });
  const data = await res.json();
  return data.token;
}

const token = await login();
console.log('token ok', Boolean(token));

const res = await fetch(BASE + '/api/chats', {
  headers: { Authorization: `Bearer ${token}` },
});
const { chats } = await res.json();
console.log('groups', chats.filter((c) => c.type === 'group').map((c) => ({ id: c.id, name: c.name, last: c.lastMessage })));

const target = chats.find((c) => c.name.includes('产品设计'));
console.log('target', target?.id);

const socket = io(BASE, { auth: { token }, transports: ['websocket'] });
await new Promise((resolve, reject) => {
  socket.on('connect', resolve);
  socket.on('connect_error', reject);
  setTimeout(() => reject(new Error('timeout')), 5000);
});
console.log('socket connected');

socket.emit('group:join', target.id);
const rows = await new Promise((resolve) => {
  socket.emit('history:load', { conversationId: target.id }, (r) => resolve(r));
});
console.log('history', rows?.length, rows?.slice(0, 3));

const sent = await new Promise((resolve) => {
  socket.emit('message:send', { content: '测试多群消息', conversationId: target.id }, resolve);
});
console.log('send', sent);

await new Promise((r) => setTimeout(r, 500));
socket.close();
process.exit(0);
