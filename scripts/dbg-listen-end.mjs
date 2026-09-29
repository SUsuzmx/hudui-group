import { io } from 'socket.io-client';

const BASE = 'http://127.0.0.1:3012';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function req(path, body) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

function connect(token) {
  return new Promise((resolve, reject) => {
    const s = io(BASE, { auth: { token }, transports: ['websocket'], forceNew: true });
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
    setTimeout(() => reject(new Error('timeout')), 5000);
  });
}

function emitAck(s, event, payload) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({ error: 'ack timeout' }), 5000);
    s.emit(event, payload, (res) => {
      clearTimeout(t);
      resolve(res || {});
    });
  });
}

const suffix = Date.now().toString(36).slice(-4);
const r = await req('/api/register', { nickname: `dbg_${suffix}`, password: 'pass1234' });
console.log('register', r.token ? 'ok' : r);
const s = await connect(r.token);
const created = await emitAck(s, 'listen:create', {
  conversationId: 'default',
  track: { id: 'dbg-1', source: 'qq', title: 'dbg' },
});
console.log('create', created.ok, created.room?.sessionId);
const id = created.room?.sessionId;
const left = await emitAck(s, 'listen:leave', { sessionId: id, roomId: id });
console.log('leave', left);
for (let i = 0; i < 8; i++) {
  await sleep(2000);
  const sync = await emitAck(s, 'listen:sync', { sessionId: id, roomId: id });
  console.log(`t+${(i + 1) * 2}s`, sync.ok ? 'ACTIVE' : sync.error || sync.code || JSON.stringify(sync).slice(0, 80));
  if (sync.error) break;
}
s.disconnect();
process.exit(0);
