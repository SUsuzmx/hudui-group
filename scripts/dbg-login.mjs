import { chromium } from 'playwright';
const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  args: ['--no-proxy-server', '--no-sandbox'],
});
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })).newPage();
page.on('pageerror', e => console.log('PAGEERR:', e.message));
page.on('response', r => { if (r.url().includes('/api/')) console.log('API', r.status(), r.request().method(), r.url()); });
await page.goto('http://127.0.0.1:3000', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForSelector('input', { timeout: 15000 });
console.log('--- step0 text:', (await page.locator('body').innerText()).replace(/\n+/g, ' | ').slice(0, 400));
await page.locator('button.switch').first().click();
await page.waitForTimeout(500);
console.log('--- step1 text:', (await page.locator('body').innerText()).replace(/\n+/g, ' | ').slice(0, 400));
await page.getByPlaceholder('手机号').fill('139' + String(Date.now()).slice(-8));
await page.locator('.code-btn').click().catch(e => console.log('codebtn err', e.message));
await page.getByPlaceholder('验证码').fill('123456');
await page.getByPlaceholder('昵称（登录用，可选）').fill('调试用户' + Math.floor(Math.random() * 9999));
await page.locator('input[type="password"]').fill('test1234');
await page.screenshot({ path: 'data/dbg-step1.png' });
await page.locator('button.submit').click();
await page.waitForTimeout(1500);
console.log('--- step2 text:', (await page.locator('body').innerText()).replace(/\n+/g, ' | ').slice(0, 400));
await page.screenshot({ path: 'data/dbg-step2.png' });
const avatarStep = await page.locator('.avatar-step').isVisible().catch(() => false);
console.log('avatarStep visible:', avatarStep);
if (avatarStep) {
  await page.locator('.avatar-cell').first().click();
  await page.locator('button.submit').click();
  await page.waitForTimeout(2500);
  console.log('--- step3 text:', (await page.locator('body').innerText()).replace(/\n+/g, ' | ').slice(0, 300));
  console.log('tabbar:', await page.locator('.tab-bar').isVisible().catch(() => false));
}
await browser.close();
