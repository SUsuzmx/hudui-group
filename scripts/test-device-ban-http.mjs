// 临时验证脚本：HTTP 层设备封禁拦截（register/login + admin devices API）
// 覆盖双轨指纹：清缓存（换 X-Device-Id）后同特征指纹（X-Device-Sig）仍被拦。
// 用法: node scripts/test-device-ban-http.mjs
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'perry-device-http-'));
process.env.PERRY_DATA_DIR = tmp;
process.env.PORT = '3987';

const { spawn } = await import('node:child_process');
const BASE = 'http://127.0.0.1:3987';

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass += 1; console.log('  OK', name); }
  else { fail += 1; console.log('FAIL', name, extra); }
}

const server = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', () => {});
server.stderr.on('data', (d) => console.error('[srv]', String(d).trim().slice(0, 200)));

async function waitReady() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/api/site/notice`);
      if (r.ok) return true;
    } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

const DEV_A = 'http-test-device-A';
const DEV_B = 'http-test-device-B';
const SIG_A = 'UA-Win|screen-1920|canvas-http-test'; // 设备 A 的稳定特征
const DEV_A_FRESH = 'http-test-device-A-fresh'; // 设备 A 清缓存后的新持久 ID

const post = (path, body, headers = {}) => fetch(`${BASE}${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

try {
  if (!(await waitReady())) throw new Error('server not ready');
  console.log('server ready');

  // 1) 设备 A（ID + sig）注册 alice
  let r = await post('/api/register', { nickname: 'alice', password: 'secret123' }, { 'X-Device-Id': DEV_A, 'X-Device-Sig': SIG_A });
  const regA = await r.json();
  check('device A register alice', r.ok && regA?.token, JSON.stringify(regA));

  // 2) 设备 B 注册 bob
  r = await post('/api/register', { nickname: 'bob', password: 'secret123' }, { 'X-Device-Id': DEV_B, 'X-Device-Sig': 'sig-B' });
  check('device B register bob', r.ok, JSON.stringify(await r.json()));

  // 3) 无设备头注册也正常（向后兼容）
  r = await post('/api/register', { nickname: 'carol', password: 'secret123' });
  check('no-header register carol', r.ok, JSON.stringify(await r.json()));

  // 4) 拿 admin token（bootstrap 密码写在隔离数据目录）
  let adminToken = '';
  let bootPwd = '';
  try {
    bootPwd = (fs.readFileSync(path.join(tmp, 'admin-bootstrap.txt'), 'utf8').match(/密码: (\S+)/) || [])[1] || '';
  } catch { /* ignore */ }
  r = await post('/api/admin/auth/login', { username: 'admin', password: bootPwd });
  const adminLogin = await r.json();
  adminToken = adminLogin?.token || '';
  check('admin login', Boolean(adminToken), JSON.stringify(adminLogin));
  const adminHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` };

  // 5) 设备列表（carol 无设备头，不登记）
  r = await fetch(`${BASE}/api/admin/devices?limit=50`, { headers: adminHeaders });
  const devList = await r.json();
  check('devices list has 2 rows', (devList.devices?.length || 0) === 2, JSON.stringify(devList.devices?.map((d) => ({ u: d.lastUserNickname, b: d.banned }))));
  check('no-device user not listed', !(devList.devices || []).some((d) => d.lastUserNickname === 'carol'));
  const devA = devList.devices?.find((d) => d.lastUserNickname === 'alice');
  check('alice device recorded with sig', Boolean(devA?.deviceId) && Boolean(devA?.sigHash) && !devA.banned);

  // 6) 封禁设备 A（含 sig 传播）
  r = await post('/api/admin/devices/ban', { deviceId: devA.deviceId, reason: '测试封禁' }, adminHeaders);
  const banRes = await r.json();
  check('ban device A', r.ok && banRes.ok, JSON.stringify(banRes));

  // 7) 设备 A 无法再登录（密码正确）
  r = await post('/api/login', { nickname: 'alice', password: 'secret123' }, { 'X-Device-Id': DEV_A, 'X-Device-Sig': SIG_A });
  const loginBlocked = await r.json();
  check('device A login blocked', r.status === 403 && loginBlocked.reason === 'device_banned', `status=${r.status} ${JSON.stringify(loginBlocked)}`);

  // 8) 设备 A 无法注册新号
  r = await post('/api/register', { nickname: 'mallory', password: 'secret123' }, { 'X-Device-Id': DEV_A, 'X-Device-Sig': SIG_A });
  check('device A register blocked', r.status === 403, `status=${r.status}`);

  // 9) 核心场景：清缓存（换持久 ID）但特征指纹不变 → 注册/登录仍被拦
  r = await post('/api/register', { nickname: 'mallory2', password: 'secret123' }, { 'X-Device-Id': DEV_A_FRESH, 'X-Device-Sig': SIG_A });
  const freshBlocked = await r.json();
  check('cache-clear register blocked by sig', r.status === 403 && freshBlocked.reason === 'device_banned', `status=${r.status} ${JSON.stringify(freshBlocked)}`);
  r = await post('/api/login', { nickname: 'bob', password: 'secret123' }, { 'X-Device-Id': DEV_A_FRESH, 'X-Device-Sig': SIG_A });
  check('cache-clear login blocked by sig', r.status === 403, `status=${r.status}`);

  // 10) 封禁后 alice 的会话已被清掉
  r = await fetch(`${BASE}/api/me`, { headers: { Authorization: `Bearer ${regA.token}` } });
  check('alice old session killed', r.status === 401, `status=${r.status}`);

  // 11) 设备 B 不受影响
  r = await post('/api/login', { nickname: 'bob', password: 'secret123' }, { 'X-Device-Id': DEV_B, 'X-Device-Sig': 'sig-B' });
  check('device B login ok', r.ok, JSON.stringify(await r.json()));

  // 12) 解封后设备 A 可登录
  r = await post('/api/admin/devices/unban', { deviceId: devA.deviceId }, adminHeaders);
  check('unban device A', r.ok, JSON.stringify(await r.json()));
  r = await post('/api/login', { nickname: 'alice', password: 'secret123' }, { 'X-Device-Id': DEV_A, 'X-Device-Sig': SIG_A });
  check('device A login after unban', r.ok, `status=${r.status}`);

  // 13) 用户详情返回双指纹信息
  const uid = devA.lastUserId;
  r = await fetch(`${BASE}/api/admin/users/${uid}`, { headers: adminHeaders });
  const detail = await r.json();
  check('user detail has deviceId+sig', Boolean(detail.user?.deviceId) && Boolean(detail.user?.deviceSig));
  check('user detail deviceBanned false after unban', detail.user?.deviceBanned === false);
  check('user detail deviceUsers', (detail.user?.deviceUsers?.length || 0) >= 1);

  // 14) sig 注册限额：同 sig 24h 内最多 3 个账号（limit1/limit2/limit3 后达到 3，limit4 被限）
  r = await post('/api/register', { nickname: 'limit1', password: 'secret123' }, { 'X-Device-Id': `${DEV_A}-l1`, 'X-Device-Sig': 'sig-limit' });
  check('sig-limit reg 1 ok', r.ok);
  r = await post('/api/register', { nickname: 'limit2', password: 'secret123' }, { 'X-Device-Id': `${DEV_A}-l2`, 'X-Device-Sig': 'sig-limit' });
  check('sig-limit reg 2 ok', r.ok);
  r = await post('/api/register', { nickname: 'limit3', password: 'secret123' }, { 'X-Device-Id': `${DEV_A}-l3`, 'X-Device-Sig': 'sig-limit' });
  check('sig-limit reg 3 ok (reaches limit)', r.ok);
  r = await post('/api/register', { nickname: 'limit4', password: 'secret123' }, { 'X-Device-Id': `${DEV_A}-l4`, 'X-Device-Sig': 'sig-limit' });
  const limitRes = await r.json();
  check('sig-limit reg 4 blocked (over 24h cap)', r.status === 429 && limitRes.reason === 'device_register_limited', `status=${r.status} ${JSON.stringify(limitRes)}`);

  console.log(`\n${pass} passed, ${fail} failed`);
} catch (e) {
  console.error('TEST ERROR:', e.message);
  fail += 1;
} finally {
  server.kill();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  process.exit(fail ? 1 : 0);
}
