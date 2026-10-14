// 用真实浏览器验证「后台独立域名根路径即登录页」的完整体验
// 通过 Chromium 的 host-resolver-rules 把 admin.supeiji.top 指向本地端口，
// 从而在 DNS 尚未配置前就能验证线上行为。
import { chromium } from 'playwright';

const ADMIN_HOST = process.env.ADMIN_HOST || 'admin.supeiji.top';
const PORT = process.env.PORT || '3010';
const PASSWORD = process.env.ADMIN_TEST_PASS || '';
const USERNAME = process.env.ADMIN_TEST_USER || '小苏';

const browser = await chromium.launch({
  channel: 'msedge',
  args: [`--host-resolver-rules=MAP ${ADMIN_HOST} 127.0.0.1:${PORT}`],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

const base = `http://${ADMIN_HOST}/`;
console.log(`访问 ${base}  (映射到 127.0.0.1:${PORT})\n`);

await page.goto(base, { waitUntil: 'networkidle' });
console.log('最终 URL      :', page.url());
console.log('标题          :', await page.title());
console.log('登录页可见    :', (await page.locator('text=请使用管理员账号登录').count()) > 0);
const pathname = new URL(page.url()).pathname;
console.log('路径          :', pathname, '(应为 /)');
console.log('根路径即登录页:', pathname === '/');
await page.screenshot({ path: 'admin-host-login.png' });

if (PASSWORD) {
  await page.fill('input[autocomplete="username"]', USERNAME);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForSelector('text=概览', { timeout: 15000 });
  await page.waitForTimeout(2500);
  console.log('登录后 URL    :', page.url());
  console.log('导航项        :', (await page.locator('.side-item').allTextContents()).join(' | '));
  console.log('统计卡片数    :', await page.locator('.stat').count());
  await page.screenshot({ path: 'admin-host-dashboard.png', fullPage: true });

  // 验证刷新后仍停留在后台（token 用的是 admin 独立存储键）
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  console.log('刷新后仍在后台:', (await page.locator('.side-item').count()) > 0);
} else {
  console.log('(未提供 ADMIN_TEST_PASS，跳过登录后检查)');
}

console.log('控制台错误    :', errors.length ? errors : 'none');
await browser.close();
process.exit(errors.length ? 1 : 0);
