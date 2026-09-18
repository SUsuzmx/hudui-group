import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));

  await page.goto('https://chat.supeiji.top/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(800);

  await page.fill('input[placeholder="昵称"]', '验证员205');
  await page.fill('input[placeholder="密码"]', 'test1234');
  const respPromise = page
    .waitForResponse((r) => r.url().includes('/api/login'), { timeout: 10000 })
    .catch(() => null);
  await page.click('button.submit');
  await respPromise;
  await page.waitForSelector('.main-page', { timeout: 10000 });
  await page.waitForTimeout(1000);

  // 会话列表: 找真实群
  const names = await page.evaluate(() =>
    [...document.querySelectorAll('.msg-name')].map((el) => el.textContent)
  );
  console.log('chats', names);

  // 打开「产品设计小分队」或第二个群
  const target = page.locator('.msg-item').filter({ hasText: '产品设计' });
  const count = await target.count();
  console.log('product group count', count);
  if (count) {
    await target.first().click();
    await page.waitForTimeout(900);
    console.log('chat title', await page.locator('.title-text').innerText());

    // 三点位置
    const more = page.locator('button[aria-label="更多"]').first();
    const box = await more.boundingBox();
    console.log('more btn box', box);

    await more.click();
    await page.waitForTimeout(500);
    const infoTitle = await page.locator('.nav-title').innerText().catch(() => '');
    const items = await page.locator('.cell-label').allInnerTexts();
    console.log('chat info title', infoTitle);
    console.log('info items', items);
    await page.screenshot({ path: 'data/ui6-chatinfo.png' });
  }

  // 回消息列表再开默认群, 发一条看是否独立
  await page.locator('button[aria-label="返回"]').first().click();
  await page.waitForTimeout(500);
  const main = page.locator('.msg-item').filter({ hasText: 'WeChat' });
  if (await main.count()) {
    await main.first().click();
    await page.waitForTimeout(800);
    const ta = page.locator('textarea.chat-input');
    if (await ta.count()) {
      await ta.fill('多群验证消息 ' + Date.now());
      await page.locator('.send-btn').click();
      await page.waitForTimeout(1200);
      const last = await page.locator('.bubble').last().innerText();
      console.log('default group last bubble', last.slice(0, 40));
    }
  }

  console.log('done');
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
