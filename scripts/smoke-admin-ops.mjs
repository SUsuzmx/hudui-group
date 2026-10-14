// 验证运维安全行为：维护模式、注册开关、adminPanel 开关与后台自身解耦、封禁兜底。
// 用法: node scripts/smoke-admin-ops.mjs   （ADMIN_TEST_* 环境变量同 smoke-admin.mjs）
const BASE = process.env.ADMIN_TEST_BASE || 'http://127.0.0.1:3010';
const USER = process.env.ADMIN_TEST_USER || 'admin';
const PASS = process.env.ADMIN_TEST_PASS || '';

let pass = 0;
let fail = 0;
function ok(name, cond, extra = '') {
  if (cond) { pass += 1; console.log(`  ✓ ${name}${extra ? ` — ${extra}` : ''}`); }
  else { fail += 1; console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
}

async function req(path, { method = 'GET', body, token, raw = false } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (raw) return { status: res.status, text: await res.text(), type: res.headers.get('content-type') };
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

if (!PASS) {
  console.log('需要 ADMIN_TEST_PASS 才能运行运维行为验证');
  process.exit(1);
}

const login = await req('/api/admin/auth/login', {
  method: 'POST', body: { username: USER, password: PASS },
});
if (login.status !== 200) {
  console.log('后台登录失败，无法继续:', login.data.error);
  process.exit(1);
}
const token = login.data.token;
const setSettings = (patch) => req('/api/admin/settings', { method: 'POST', token, body: { settings: patch } });
const setFlags = (patch) => req('/api/admin/flags', { method: 'POST', token, body: { flags: patch } });
const getSettings = () => req('/api/admin/settings', { token });

console.log(`\n运维安全行为验证 → ${BASE}\n`);

// ---------- 维护模式 ----------
console.log('[1] 维护模式');
{
  const before = (await getSettings()).data.settings;

  await setSettings({ 'site.maintenance': '1', 'site.maintenanceMessage': '冒烟维护中' });

  const blocked = await req('/api/moments', {});
  ok('维护模式拦截用户端接口（503）', blocked.status === 503, `HTTP ${blocked.status}`);
  ok('返回维护提示文案', blocked.data.error === '冒烟维护中' || blocked.data.reason === 'maintenance',
    JSON.stringify(blocked.data));

  const adminStillOk = await req('/api/admin/dashboard', { token });
  ok('维护模式下后台仍可用（不自锁）', adminStillOk.status === 200, `HTTP ${adminStillOk.status}`);

  const adminPage = await req('/admin', { raw: true });
  ok('维护模式下后台页面仍可访问', adminPage.status === 200, `HTTP ${adminPage.status}`);

  await setSettings({ 'site.maintenance': before['site.maintenance'], 'site.maintenanceMessage': before['site.maintenanceMessage'] });
  const restored = await req('/api/moments', {});
  ok('关闭维护后用户端恢复', restored.status !== 503, `HTTP ${restored.status}`);
}

// ---------- 注册开关 ----------
console.log('\n[2] 注册开关');
{
  const before = (await getSettings()).data.settings['site.registrationOpen'];
  await setSettings({ 'site.registrationOpen': '0', 'site.registrationNotice': '冒烟关闭注册' });

  const blocked = await req('/api/register', {
    method: 'POST', body: { nickname: `smoke_${Date.now().toString(36)}`, password: 'secret99' },
  });
  ok('关闭注册后注册被拒（403）', blocked.status === 403, `HTTP ${blocked.status}`);
  ok('返回自定义提示', blocked.data.error === '冒烟关闭注册' || blocked.data.reason === 'registration_closed');

  await setSettings({ 'site.registrationOpen': before, 'site.registrationNotice': '' });
  const reopened = await req('/api/register', {
    method: 'POST', body: { nickname: `smoke_${Date.now().toString(36)}`, password: 'secret99' },
  });
  ok('恢复注册后注册可用', reopened.status === 200, `HTTP ${reopened.status}`);
}

// ---------- adminPanel 开关解耦 ----------
console.log('\n[3] adminPanel 开关与后台解耦');
{
  const before = (await req('/api/admin/flags', { token })).data.flags.adminPanel;

  await setFlags({ adminPanel: !before });
  const page = await req('/admin', { raw: true });
  ok('关闭 adminPanel 后 /admin 仍可访问', page.status === 200, `HTTP ${page.status}`);
  const api = await req('/api/admin/dashboard', { token });
  ok('关闭 adminPanel 后后台接口仍可用', api.status === 200, `HTTP ${api.status}`);

  await setFlags({ adminPanel: before });
  ok('adminPanel 开关已还原', (await req('/api/admin/flags', { token })).data.flags.adminPanel === before);
}

// ---------- 审计覆盖 ----------
console.log('\n[4] 审计留痕完整性');
{
  const r = await req('/api/admin/audit?limit=40', { token });
  const logs = r.data.logs || [];
  ok('维护模式变更已留痕', logs.some((l) => l.module === 'settings' && /maintenance/.test(l.detail)));
  ok('注册开关变更已留痕', logs.some((l) => l.module === 'settings' && /registrationOpen/.test(l.detail)));
  ok('功能开关变更已留痕', logs.some((l) => l.module === 'flags'));
  ok('每条日志含管理员与 IP', logs.every((l) => l.adminName && typeof l.ip === 'string'));
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
