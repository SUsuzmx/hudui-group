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
  const resp = await respPromise;
  console.log('login', resp && resp.status());
  await page.waitForSelector('.main-page', { timeout: 10000 });
  await page.waitForTimeout(800);

  const msgCount = await page.locator('.msg-item').count();
  const states = await page.evaluate(() => {
    const items = [...document.querySelectorAll('.msg-item')];
    return {
      total: items.length,
      pinned: items.filter((el) => el.classList.contains('pinned')).length,
      badges: document.querySelectorAll('.msg-badge').length,
      mutes: document.querySelectorAll('.mute-bell').length,
      drafts: document.querySelectorAll('.draft-tag').length,
    };
  });
  console.log('msg list', msgCount, states);
  await page.screenshot({ path: 'data/ui4-msglist.png' });

  // 通讯录
  await page.locator('.tab-item').nth(1).click();
  await page.waitForTimeout(400);
  const rows = page.locator('.contact-row');
  console.log('contact rows', await rows.count());
  if (await rows.count()) {
    await rows.nth(1).click();
    await page.waitForTimeout(800);
    const profile = await page.locator('.profile-card').count();
    const chat = await page.locator('.chat-dock').count();
    console.log('click contact → profile', profile, 'chat', chat);
    await page.screenshot({ path: 'data/ui4-profile.png' });

    const sendBtn = page.locator('.cell-btn').filter({ hasText: '发消息' });
    if (await sendBtn.count()) {
      await sendBtn.click();
      await page.waitForTimeout(800);
      console.log('after send-msg, chat-dock', await page.locator('.chat-dock').count());
      const more = page.locator('button[aria-label="更多"]').first();
      console.log('more btn', await more.count());
      if (await more.count()) {
        await more.click();
        await page.waitForTimeout(300);
        console.log('menu items', await page.locator('.pop-item').count());
        await page.screenshot({ path: 'data/ui4-more.png' });
        const first = await page.locator('.pop-item').first().innerText();
        console.log('first menu', first);
      }
    }
  }

  console.log('done');
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
