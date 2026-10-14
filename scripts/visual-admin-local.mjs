// 验证 http://localhost:<port>/admin 在真实浏览器里可用，并能用后台账号登录
import { chromium } from 'playwright';

const PORT = process.env.PORT || '3010';
const USERNAME = process.env.ADMIN_TEST_USER || '小苏';
const PASSWORD = process.env.ADMIN_TEST_PASS || '1234';

const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

const url = `http://localhost:${PORT}/admin`;
console.log(`访问 ${url}\n`);
await page.goto(url, { waitUntil: 'networkidle' });
console.log('标题        :', await page.title());
console.log('登录页可见  :', (await page.locator('text=请使用管理员账号登录').count()) > 0);

await page.screenshot({ path: 'admin-local-login.png' });

console.log(`\n用 ${USERNAME} / ${PASSWORD} 登录…`);
await page.fill('input[autocomplete="username"]', USERNAME);
await page.fill('input[type="password"]', PASSWORD);
await page.click('button[type="submit"]');

try {
  await page.waitForSelector('.side-item', { timeout: 15000 });
  await page.waitForTimeout(2000);
  console.log('登录结果    : 成功 ✓');
  console.log('导航项      :', (await page.locator('.side-item').allTextContents()).join(' | '));
  console.log('统计卡片数  :', await page.locator('.stat').count());
  await page.screenshot({ path: 'admin-local-dashboard.png', fullPage: true });

  // 走一遍用户管理，确认 API 在同域下可达
  await page.click('.side-item:has-text("用户管理")');
  await page.waitForTimeout(1800);
  console.log('用户表行数  :', await page.locator('table.tbl tbody tr').count());
  await page.screenshot({ path: 'admin-local-users.png', fullPage: true });
} catch {
  const err = await page.locator('.hint').first().textContent().catch(() => '');
  console.log('登录结果    : 失败 ✗', err || '');
  await page.screenshot({ path: 'admin-local-failed.png' });
}

console.log('\n控制台错误  :', errors.length ? errors : 'none');
await browser.close();
process.exit(errors.length ? 1 : 0);
