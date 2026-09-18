import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));

  await page.goto('https://chat.supeiji.top/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(800);

  // 用已注册测试号登录
  await page.fill('input[placeholder="昵称"]', '验证员205');
  await page.fill('input[placeholder="密码"]', 'test1234');
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/login') || r.url().includes('/api/me'), { timeout: 15000 }).catch(() => null),
    page.click('button.submit'),
  ]);
  await page.waitForTimeout(1000);

  console.log('tab count', await page.locator('.tab-item').count());
  console.log('login form still?', await page.locator('input[placeholder="昵称"]').count());
  console.log('error text', await page.locator('.error').innerText().catch(() => ''));
  await page.screenshot({ path: 'data/ui3-chats.png' });

  for (let i = 1; i <= 3; i++) {
    const tab = page.locator('.tab-item').nth(i);
    if (!(await tab.count())) break;
    await tab.click();
    await page.waitForTimeout(300);
    const layout = await page.evaluate(() => {
      const content = document.querySelector('.content');
      const visible = [...document.querySelectorAll('.tab-pane')].filter(
        (el) => getComputedStyle(el).display !== 'none'
      );
      const cr = content?.getBoundingClientRect();
      const vr = visible[0]?.getBoundingClientRect();
      const tab = document.querySelector('.tab-bar')?.getBoundingClientRect();
      return {
        paneH: Math.round(vr?.height || 0),
        paneTop: Math.round(vr?.top || 0),
        paneBottom: Math.round(vr?.bottom || 0),
        tabTop: Math.round(tab?.top || 0),
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
        buttons: visible[0]?.querySelectorAll('button').length ?? 0,
      };
    });
    console.log('tab', i, layout);
    await page.screenshot({ path: `data/ui3-tab${i}.png` });
  }

  await page.locator('.tab-item').nth(0).click();
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'data/ui3-back.png' });
  console.log('done');
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
