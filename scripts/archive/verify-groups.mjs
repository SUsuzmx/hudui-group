import { io } from 'socket.io-client';

const BASE = 'http://127.0.0.1:3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, body, token) {
  const res = await fetch(BASE + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() };
}

const login = await api('/api/login', { nickname: '验证员205', password: 'test1234' });
console.log('login', login.status);
const token = login.data.token;

const chats = await api('/api/chats', null, token);
const groups = chats.data.chats.filter((c) => c.type === 'group');
console.log('groups', groups.map((g) => `${g.name} ${g.conversationId || g.id} default=${g.isDefault}`));

function connect() {
  return new Promise((resolve, reject) => {
    const s = io(BASE, { auth: { token }, transports: ['websocket'] });
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
    setTimeout(() => reject(new Error('timeout')), 8000);
  });
}

const sock = await connect();

async function loadHistory(conversationId) {
  return new Promise((resolve) => {
    sock.emit('history:load', { conversationId }, (rows) => resolve(rows || []));
  });
}

async function send(content, conversationId) {
  return new Promise((resolve) => {
    sock.emit('message:send', { content, conversationId }, (res) => resolve(res));
  });
}

const product = groups.find((g) => g.name.includes('产品'));
const family = groups.find((g) => g.name.includes('家庭'));
const main = groups.find((g) => g.isDefault);

if (product) {
  sock.emit('group:join', product.conversationId || product.id);
  const hist = await loadHistory(product.conversationId || product.id);
  console.log('product history', hist.length, hist.slice(-2).map((m) => `${m.senderName}:${m.content}`));
  const r = await send('多群独立测试-产品群', product.conversationId || product.id);
  console.log('send product', r);
  await sleep(400);
  const hist2 = await loadHistory(product.conversationId || product.id);
  const last = hist2[hist2.length - 1];
  console.log('product last', last?.senderName, last?.content);
}

if (family) {
  const hist = await loadHistory(family.conversationId || family.id);
  console.log('family history', hist.length, hist.slice(-2).map((m) => `${m.senderName}:${m.content}`));
  const hasProductMsg = hist.some((m) => m.content?.includes('多群独立测试-产品群'));
  console.log('family leaked product msg?', hasProductMsg);
}

if (main) {
  const hist = await loadHistory(main.conversationId || main.id);
  console.log('main history', hist.length);
  const hasProductMsg = hist.some((m) => m.content?.includes('多群独立测试-产品群'));
  console.log('main leaked product msg?', hasProductMsg);
}

sock.close();
process.exit(0);
