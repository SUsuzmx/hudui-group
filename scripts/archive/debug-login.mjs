import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') console.log('CONSOLE', m.text());
  });

  await page.goto('https://chat.supeiji.top/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(700);

  await page.fill('input[placeholder="昵称"]', '验证员205');
  await page.fill('input[placeholder="密码"]', 'test1234');
  const respPromise = page
    .waitForResponse((r) => r.url().includes('/api/login'), { timeout: 10000 })
    .catch(() => null);
  await page.click('button.submit');
  const resp = await respPromise;
  console.log('login status', resp && resp.status(), resp && (await resp.text()).slice(0, 120));
  await page.waitForTimeout(1500);

  console.log('main-page', await page.locator('.main-page').count());
  console.log('login form', await page.locator('input[placeholder="昵称"]').count());
  console.log('error', await page.locator('.error').innerText().catch(() => ''));
  console.log('msg items', await page.locator('.msg-item').count());
  console.log('tab items', await page.locator('.tab-item').count());

  const text = (await page.locator('#app').innerText()).slice(0, 250);
  console.log('app text', text);

  await page.screenshot({ path: 'data/ui5-debug.png' });
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
