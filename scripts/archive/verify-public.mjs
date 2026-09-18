// 公网链路 AI 验证: 连 chat.supeiji.top, 注册-进群-发消息-等 AI 回复。
import { io } from 'socket.io-client';

const BASE = 'https://chat.supeiji.top';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const reg = await (await fetch(BASE + '/api/register', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ nickname: '外网验证' + Math.floor(Math.random() * 100), password: 'web1234' }),
})).json();

const s = io(BASE, { auth: { token: reg.token, announce: false }, transports: ['websocket'] });
const msgs = [];
s.on('message:new', (m) => msgs.push(m));
await new Promise((r) => s.on('connect', r));

s.emit('message:send', '牛奶 在吗？听说你会怼人，来试试');
await sleep(20000);
s.disconnect();

const mine = msgs.filter((m) => m.senderName?.includes('外网验证')).length;
const ai = msgs.filter((m) => m.senderType === 'ai');
console.log(`收到消息 ${msgs.length} 条 (自己 ${mine}, AI ${ai.length})`);
for (const m of ai) console.log(`  [AI] ${m.senderName}: ${m.content}`);
process.exit(ai.length ? 0 : 1);
