// 线上独立域名端到端验证（真实 HTTPS + 真实 Cloudflare 边缘）
import { chromium } from 'playwright';

const ADMIN = process.env.ADMIN_URL || 'https://admin.supeiji.top';
const SITE = process.env.SITE_URL || 'https://chat.supeiji.top';
const USERNAME = process.env.ADMIN_TEST_USER || '小苏';
const PASSWORD = process.env.ADMIN_TEST_PASS || '1234';

const browser = await chromium.launch({ channel: 'msedge' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

let fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) console.log(`  ✓ ${name}${extra ? ` — ${extra}` : ''}`);
  else { fail += 1; console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
};

console.log(`\n[1] 后台独立域名 ${ADMIN}/`);
await page.goto(`${ADMIN}/`, { waitUntil: 'networkidle' });
const path0 = new URL(page.url()).pathname;
ok('根路径返回后台', await page.title() === '运营后台', `title=${await page.title()}`);
ok('路径为 /', path0 === '/', path0);
ok('登录页可见', (await page.locator('text=请使用管理员账号登录').count()) > 0);
ok('HTTPS 无证书告警', page.url().startsWith('https://'));
await page.screenshot({ path: 'public-admin-login.png' });

console.log('\n[2] 登录');
await page.fill('input[autocomplete="username"]', USERNAME);
await page.fill('input[type="password"]', PASSWORD);
await page.click('button[type="submit"]');
await page.waitForSelector('.side-item', { timeout: 20000 });
await page.waitForTimeout(2500);
ok('登录成功进入后台', (await page.locator('.side-item').count()) > 0);
ok('概览有统计数据', (await page.locator('.stat').count()) >= 4, `${await page.locator('.stat').count()} 张卡片`);
await page.screenshot({ path: 'public-admin-dashboard.png', fullPage: true });

console.log('\n[3] 登录态持久化');
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
ok('刷新后仍保持登录', (await page.locator('.side-item').count()) > 0);
ok('刷新后路径仍为 /', new URL(page.url()).pathname === '/');

console.log('\n[4] 各模块可加载');
for (const [label, sel] of [
  ['用户管理', '.side-item:has-text("用户管理")'],
  ['举报管理', '.side-item:has-text("举报管理")'],
  ['错误监控', '.side-item:has-text("错误监控")'],
  ['功能开关', '.side-item:has-text("功能开关")'],
  ['审计日志', '.side-item:has-text("审计日志")'],
]) {
  await page.click(sel);
  await page.waitForTimeout(1400);
  const rows = await page.locator('table.tbl tbody tr').count();
  const stats = await page.locator('.stat, .card').count();
  ok(`${label} 渲染正常`, rows > 0 || stats > 0, `行=${rows} 区块=${stats}`);
}

console.log('\n[5] 主站不受影响');
const p2 = await ctx.newPage();
const siteErrors = [];
p2.on('pageerror', (e) => siteErrors.push(e.message));
await p2.goto(`${SITE}/`, { waitUntil: 'domcontentloaded' });
await p2.waitForTimeout(2500);
ok('主站仍为用户端', !(await p2.title()).includes('运营后台'), `title=${await p2.title()}`);
await p2.goto(`${SITE}/admin`, { waitUntil: 'networkidle' });
ok('主站 /admin 备用入口仍可用', (await p2.title()) === '运营后台', `title=${await p2.title()}`);

console.log('\n[6] 安全隔离');
const p3 = await ctx.newPage();
await p3.goto(`${ADMIN}/`, { waitUntil: 'domcontentloaded' });
const crossed = await p3.evaluate(async () => {
  const r = await fetch('/api/admin/dashboard');
  return r.status;
});
ok('无 token 调用后台接口返回 401', crossed === 401, `HTTP ${crossed}`);

console.log(`\n结果: ${fail === 0 ? '全部通过' : fail + ' 项失败'}`);
console.log('后台页控制台错误:', errors.length ? errors : 'none');
console.log('主站控制台错误  :', siteErrors.length ? siteErrors : 'none');

await browser.close();
process.exit(fail || errors.length ? 1 : 0);
