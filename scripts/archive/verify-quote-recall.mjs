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

const conv = 'grp_2';
sock.emit('group:join', conv);

// 发一条普通消息
const sent = await new Promise((resolve) => {
  sock.emit('message:send', { content: '原始消息A', conversationId: conv }, resolve);
});
console.log('send1', sent);

// 引用回复
const quoted = await new Promise((resolve) => {
  sock.emit(
    'message:send',
    {
      content: '这是引用回复',
      conversationId: conv,
      quote: { id: sent.id, name: '验证员205', content: '原始消息A' },
    },
    resolve
  );
});
console.log('quote send', quoted);

// 加载历史看 quote
const hist = await new Promise((resolve) => {
  sock.emit('history:load', { conversationId: conv }, resolve);
});
const last = hist[hist.length - 1];
console.log('last quote field', last?.quote, 'content', last?.content);

// 撤回自己的引用消息
const rec = await new Promise((resolve) => {
  sock.emit('message:recall', { id: quoted.id, conversationId: conv }, resolve);
});
console.log('recall', rec);

const hist2 = await new Promise((resolve) => {
  sock.emit('history:load', { conversationId: conv }, resolve);
});
const last2 = hist2[hist2.length - 1];
console.log('after recall', last2?.senderType, last2?.content, last2?.recalled);

// typing
let typingSeen = false;
sock.on('typing:start', () => { typingSeen = true; });
// 模拟另一连接很难, 至少确认事件可发
sock.emit('typing:start', { conversationId: conv });
await sleep(300);
console.log('typing emit ok');

const okQuote = Boolean(last?.quote?.content === '原始消息A');
const okRecall = last2?.senderType === 'system' && /撤回/.test(last2?.content || '');
console.log('RESULTS', { okQuote, okRecall });
sock.close();
process.exit(okQuote && okRecall ? 0 : 1);
