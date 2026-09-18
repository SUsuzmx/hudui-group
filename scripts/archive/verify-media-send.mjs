const BASE = 'http://127.0.0.1:3000';
const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
// MediaRecorder 常见格式
const webm = 'data:audio/webm;codecs=opus;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAAAsxtZGF0AAACrgYF//+q3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE1NCByMjkwMSA3ZDBmZjIyIEFWQyBjb2RlYyAtIENvcHlsZWZ0IDIwMDMtMjAyMiAtIGh0dHA6Ly93d3cudmlkZW9sYW4ub3JnL3gyNjQuaHRtbCAtIG9wdGlvbnM6';

async function http(path, body, token) {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data };
}

const login = await http('/api/login', { nickname: '验证员205', password: 'test1234' });
const token = login.data.token;
console.log('login', login.status, !!token);

const ui = await http('/api/chat/upload', { data: png, kind: 'image' }, token);
console.log('image upload', ui.status, ui.data);

const uv = await http('/api/chat/upload', { data: webm, kind: 'voice' }, token);
console.log('voice upload (webm;codecs=opus)', uv.status, uv.data);

const { io } = await import('socket.io-client');
const sock = io(BASE, { auth: { token }, transports: ['websocket'] });
await new Promise((res, rej) => {
  sock.on('connect', res);
  sock.on('connect_error', rej);
  setTimeout(() => rej(new Error('socket timeout')), 8000);
});

const msgs = [];
sock.on('group:message', (m) => {
  if (m.senderType === 'user' && (m.mediaType === 'image' || m.mediaType === 'voice')) {
    msgs.push({ id: m.id, type: m.mediaType, url: m.mediaUrl, content: m.content });
  }
});
sock.emit('group:join', 'grp_2');

if (ui.data.url) {
  const s1 = await new Promise((r) =>
    sock.emit('message:send', { conversationId: 'grp_2', mediaType: 'image', mediaUrl: ui.data.url }, r)
  );
  console.log('send image', s1);
} else {
  console.log('send image SKIPPED (upload failed)');
}

if (uv.data.url) {
  const s2 = await new Promise((r) =>
    sock.emit(
      'message:send',
      { conversationId: 'grp_2', content: '[语音] 2"', mediaType: 'voice', mediaUrl: uv.data.url },
      r
    )
  );
  console.log('send voice', s2);
} else {
  console.log('send voice SKIPPED (upload failed)');
}

await new Promise((r) => setTimeout(r, 600));
const hist = await new Promise((r) => sock.emit('history:load', { conversationId: 'grp_2' }, r));
const last3 = hist.slice(-3).map((m) => ({ id: m.id, type: m.mediaType, url: m.mediaUrl, content: m.content }));
console.log('last history', last3);
console.log('socket received media', msgs);

sock.close();
const ok = ui.status === 200 && uv.status === 200 && last3.some((m) => m.type === 'image') && last3.some((m) => m.type === 'voice');
process.exit(ok ? 0 : 1);
