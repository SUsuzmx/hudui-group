// 临时验证脚本：设备封禁后台 UI 端到端（真实浏览器）
// 用法: node scripts/test-device-ban-ui.mjs
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'perry-device-ui-'));
process.env.PERRY_DATA_DIR = tmp;
const PORT = 3988;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_PWD = 'AdmTest12345';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`  ✓ ${name}${extra ? ` — ${extra}` : ''}`); }
  else { fail += 1; console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
};

// 预置后台账号（避免写真实 data/admin-bootstrap.txt）
{
  const { db } = await import('../server/db.js');
  const { createAdmin } = await import('../server/admin-store.js');
  const r = createAdmin({ username: 'admin', password: ADMIN_PWD, displayName: '测试超管', role: 'super' });
  if (r.error) { console.error('预置管理员失败:', r.error); process.exit(1); }
  try { db.close(); } catch { /* ignore */ }
}

const server = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'ignore', 'pipe'],
});
server.stderr.on('data', (d) => {
  const s = String(d).trim();
  if (s && !/ExperimentalWarning|--trace-warnings/.test(s)) console.error('[srv]', s.slice(0, 200));
});

async function waitReady() {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${BASE}/api/site/notice`)).ok) return true; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

let browser = null;
try {
  if (!(await waitReady())) throw new Error('server not ready');
  console.log('server ready\n');

  // 造设备数据：两台设备各注册一个用户（带持久 ID + 特征指纹）
  const DEV_A = 'ui-test-device-A';
  const SIG_A = 'ui-sig-Win-edge-1920';
  for (const [nick, dev, sig] of [['alice', DEV_A, SIG_A], ['bob', 'ui-test-device-B', 'ui-sig-B']]) {
    const r = await fetch(`${BASE}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Device-Id': dev, 'X-Device-Sig': sig },
      body: JSON.stringify({ nickname: nick, password: 'secret123' }),
    });
    if (!r.ok) throw new Error(`register ${nick} failed: ${await r.text()}`);
  }
  console.log('seeded 2 devices\n');

  // 启动浏览器
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
  } catch {
    browser = await chromium.launch({ headless: true });
  }
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('PAGEERROR: ' + e.message));

  console.log('[1] 后台登录');
  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[autocomplete="username"]', { timeout: 20000 });
  await page.fill('input[autocomplete="username"]', 'admin');
  await page.fill('input[type="password"]', ADMIN_PWD);
  await page.click('button[type="submit"]');
  await page.waitForSelector('.side-item', { timeout: 20000 });
  ok('登录成功进入后台', (await page.locator('.side-item').count()) > 0);

  console.log('\n[2] 侧栏存在「设备封禁」入口');
  const navItem = page.locator('.side-item', { hasText: '设备封禁' });
  ok('侧栏有设备封禁菜单', (await navItem.count()) === 1);

  await navItem.click();
  await page.waitForTimeout(1200);
  const rowCount = await page.locator('table.tbl tbody tr').count();
  ok('设备页渲染出设备行', rowCount >= 2, `${rowCount} 行`);
  const bodyText = await page.locator('table.tbl').innerText();
  ok('列表显示 alice 的设备', bodyText.includes('alice'), bodyText.replace(/\s+/g, ' ').slice(0, 120));
  ok('未封禁的设备标为正常', bodyText.includes('正常'));

  console.log('\n[3] 通过后台封禁 alice 的设备');
  const aliceRow = page.locator('table.tbl tbody tr', { hasText: 'alice' }).first();
  await aliceRow.locator('button', { hasText: '封禁' }).click();
  await page.waitForSelector('.dialog', { timeout: 10000 });
  await page.fill('.dialog textarea', 'UI 测试封禁');
  await page.click('.dialog button:has-text("确认封禁")');
  await page.waitForTimeout(1500);
  const afterText = await page.locator('table.tbl').innerText();
  ok('列表出现已封禁标记', afterText.includes('已封禁'), afterText.replace(/\s+/g, ' ').slice(0, 160));
  await page.screenshot({ path: path.join(process.cwd(), 'data', 'device-ban-admin.png'), fullPage: true });
  ok('控制台无 JS 报错', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

  console.log('\n[4] 被封设备无法登录/注册');
  let r = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': DEV_A, 'X-Device-Sig': SIG_A },
    body: JSON.stringify({ nickname: 'alice', password: 'secret123' }),
  });
  const blocked = await r.json();
  ok('该设备登录被拒 (403 device_banned)', r.status === 403 && blocked.reason === 'device_banned', `HTTP ${r.status} ${JSON.stringify(blocked)}`);

  r = await fetch(`${BASE}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': DEV_A, 'X-Device-Sig': SIG_A },
    body: JSON.stringify({ nickname: 'mallory', password: 'secret123' }),
  });
  ok('该设备注册被拒', r.status === 403, `HTTP ${r.status}`);

  // 核心场景：清缓存（换持久 ID）但特征指纹不变 → 仍被拦
  r = await fetch(`${BASE}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': 'ui-test-device-A-fresh', 'X-Device-Sig': SIG_A },
    body: JSON.stringify({ nickname: 'mallory2', password: 'secret123' }),
  });
  ok('清缓存后同特征指纹注册仍被拦', r.status === 403, `HTTP ${r.status}`);

  console.log('\n[5] 后台解封');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.side-item', { timeout: 20000 });
  await page.locator('.side-item', { hasText: '设备封禁' }).click();
  await page.waitForTimeout(1200);
  const bannedRow = page.locator('table.tbl tbody tr', { hasText: '已封禁' }).first();
  await bannedRow.locator('button', { hasText: '解封' }).click();
  await page.waitForSelector('.dialog', { timeout: 10000 });
  await page.click('.dialog button:has-text("确认解封")');
  await page.waitForTimeout(1500);
  const finalText = await page.locator('table.tbl').innerText();
  ok('解封后恢复正常', !finalText.includes('已封禁'));

  r = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': DEV_A, 'X-Device-Sig': SIG_A },
    body: JSON.stringify({ nickname: 'alice', password: 'secret123' }),
  });
  ok('解封后该设备可登录', r.ok, `HTTP ${r.status}`);

  console.log(`\n${pass} passed, ${fail} failed`);
} catch (e) {
  console.error('TEST ERROR:', e.message);
  fail += 1;
} finally {
  try { await browser?.close(); } catch { /* ignore */ }
  server.kill();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  process.exit(fail ? 1 : 0);
}
