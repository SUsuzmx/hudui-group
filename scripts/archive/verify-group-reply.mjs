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
const me = login.user;
console.log('login', me.id, me.nickname);

function connect() {
  return new Promise((resolve, reject) => {
    const s = io(BASE, { auth: { token }, transports: ['websocket'] });
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
    setTimeout(() => reject(new Error('timeout')), 8000);
  });
}

async function testGroup(sock, convId, label, content) {
  const ai = [];
  const onMsg = (m) => {
    if (m.conversationId === convId && m.senderType === 'ai') ai.push(m);
  };
  sock.on('group:message', onMsg);
  sock.emit('group:join', convId);
  await sleep(200);
  await new Promise((resolve) => {
    sock.emit('message:send', { content, conversationId: convId }, resolve);
  });
  console.log(label, 'sent');
  for (let i = 0; i < 16; i++) {
    await sleep(2000);
    if (ai.length) break;
  }
  sock.off('group:message', onMsg);
  console.log(label, 'AI', ai.map((m) => `${m.senderName}:${(m.content || '').slice(0, 36)}`));
  return ai.length > 0;
}

const sock = await connect();

// 家庭群 grp_3
const okFamily = await testGroup(sock, 'grp_3', 'family', '这周末我回家吃饭');
await sleep(1500);
// 工作群 grp_5
const okWork = await testGroup(sock, 'grp_5', 'work', '方案我改完了发群里');
await sleep(1500);
// 开黑群 grp_6 @阿强
const okGame = await testGroup(sock, 'grp_6', 'game', '@阿强 晚上开一把?');
await sleep(1500);
// 产品群 @妈妈 不应有(妈妈不在产品群)
const okProduct = await testGroup(sock, 'grp_2', 'product', '@思琪 这版可以吗');

console.log('RESULTS', { okFamily, okWork, okGame, okProduct });
sock.close();
process.exit(okFamily || okWork || okGame || okProduct ? 0 : 1);
