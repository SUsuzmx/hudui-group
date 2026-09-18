// 端到端功能测试: 注册 → 进群 → 发消息 → AI 插嘴/点名 → 二次登录看历史。
// 限流阈值与 server/auth.js、server/chat.js 导出的常量保持一致。
import { io } from 'socket.io-client';

const BASE = process.env.BASE || 'http://127.0.0.1:3000';

// 与服务端对齐（chat.js MSG_RATE / auth.js LOGIN_RATE / REGISTER_RATE）
const MSG_RATE_LIMIT = 20;          // 60s 内群/私聊消息上限
const LOGIN_RATE_LIMIT = 10;        // 15min 内同账号登录失败上限
const REGISTER_RATE_LIMIT = 20;     // 1h 内同 IP 注册上限

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
};

async function api(path, body) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

function connect(token, announce = false) {
  return new Promise((resolve, reject) => {
    const s = io(BASE, { auth: { token, announce }, transports: ['websocket'] });
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
    setTimeout(() => reject(new Error('连接超时')), 8000);
  });
}

function collect(s) {
  const msgs = [];
  s.on('message:new', (m) => msgs.push(m));
  return msgs;
}

// ── 1. 注册（含限流边界说明） ──
const nick = '测试员甲' + Math.floor(Math.random() * 100);
const reg = await api('/api/register', { nickname: nick, password: 'test1234' });
check(
  '注册',
  reg.status === 200 && reg.data.token,
  reg.status === 429
    ? `触发注册限流(${REGISTER_RATE_LIMIT}/h), 请稍后再跑`
    : JSON.stringify(reg.data).slice(0, 80)
);

const dup = await api('/api/register', { nickname: nick, password: 'test1234' });
check('重复昵称被拒', dup.status === 400 || dup.status === 429, dup.data.error ?? `status=${dup.status}`);

const badLogin = await api('/api/login', { nickname: nick, password: 'wrong' });
check(
  '错误密码被拒',
  badLogin.status === 400 || badLogin.status === 429,
  badLogin.data.error ?? `status=${badLogin.status}`
);

// ── 2. 进群 + 欢迎消息 ──
const s1 = await connect(reg.data.token, true);
const msgs1 = collect(s1);
await sleep(1500);
const hasWelcome = msgs1.some((m) => m.senderType === 'system' && m.content.includes(nick));
check('进群系统欢迎消息', hasWelcome, msgs1.map((m) => m.content).join(' | ').slice(0, 120));

// ── 3. 历史加载 ──
const history = await new Promise((resolve) => {
  s1.emit('history:load', {}, (rows) => resolve(rows));
});
check('历史消息加载', history.length > 0, `${history.length} 条`);

// ── 4. 发消息 + AI 插嘴 ──
const sent = await new Promise((resolve) => {
  s1.emit('message:send', '大家好，我是新人，多多关照！', (res) => resolve(res));
});
check('发送消息', sent?.ok === true, JSON.stringify(sent));

// ── 5. 点名 AI ──
const sent2 = await new Promise((resolve) => {
  s1.emit('message:send', '小辣椒 你觉得我这个人怎么样', (res) => resolve(res));
});
check('点名消息发送', sent2?.ok === true);

// AI 语录模式有打字延迟(最长~6s) + 冷却, 等 12 秒收消息
await sleep(12000);
const aiMsgs = msgs1.filter((m) => m.senderType === 'ai');
check('AI 发言(欢迎/插嘴/回应)', aiMsgs.length > 0, aiMsgs.map((m) => `${m.senderName}:${m.content}`).join(' | ').slice(0, 200));

// ── 6. 刷屏限流 ──
// 服务端: MSG_RATE.limit = 20 / 60s，且「已发送成功」也计数。
// 本用例前面已成功发出至少 2 条，这里继续发满 limit+5，保证必然越过阈值。
let floodRejected = false;
let floodOkCount = 0;
let floodErr = '';
const floodBudget = MSG_RATE_LIMIT + 5;
for (let i = 0; i < floodBudget; i++) {
  const r = await new Promise((resolve) => {
    s1.emit('message:send', `刷屏测试${i}`, (res) => resolve(res));
  });
  if (r?.ok) floodOkCount += 1;
  if (r?.error) {
    floodRejected = true;
    floodErr = r.error;
    break;
  }
}
check(
  '刷屏限流生效',
  floodRejected,
  floodRejected
    ? `第${floodOkCount + 1}次被拒: ${floodErr} (limit=${MSG_RATE_LIMIT}/60s)`
    : `连续${floodOkCount}条均成功, 未触发 limit=${MSG_RATE_LIMIT}`
);

// ── 7. 未登录连接被拒 ──
const rejected = await connect('bad-token').then(() => false).catch(() => true);
check('无效 token 被拒', rejected);

s1.disconnect();

// ── 8. 二次登录 + 看历史 ──
const relogin = await api('/api/login', { nickname: nick, password: 'test1234' });
check('重新登录', relogin.status === 200 && relogin.data.token, relogin.data.error || '');
if (relogin.status === 200 && relogin.data.token) {
  const s2 = await connect(relogin.data.token);
  const history2 = await new Promise((resolve) => {
    s2.emit('history:load', {}, (rows) => resolve(rows));
  });
  const hasSentMsg = history2.some((m) => m.content.includes('多多关照'));
  check('二次登录可见历史', hasSentMsg, `${history2.length} 条`);
  s2.disconnect();
} else {
  check('二次登录可见历史', false, '登录失败, 跳过');
}

const failed = results.filter((r) => !r.ok);
console.log(`\n===== 结果: ${results.length - failed.length}/${results.length} 通过 =====`);
console.log(`阈值对齐: 消息 ${MSG_RATE_LIMIT}/60s · 登录失败 ${LOGIN_RATE_LIMIT}/15min · 注册 ${REGISTER_RATE_LIMIT}/h`);
process.exit(failed.length ? 1 : 0);
