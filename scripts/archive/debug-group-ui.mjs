import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  page.on('console', (m) => {
    if (['error', 'warning'].includes(m.type())) console.log('CONSOLE', m.type(), m.text());
  });

  await page.goto('https://chat.supeiji.top/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  await page.fill('input[placeholder="昵称"]', '验证员205');
  await page.fill('input[placeholder="密码"]', 'test1234');
  await page.click('button.submit');
  await page.waitForSelector('.main-page', { timeout: 10000 });
  await page.waitForTimeout(600);

  await page.locator('.msg-item', { hasText: '产品设计小分队' }).first().click();
  await page.waitForTimeout(1500);

  const info = await page.evaluate(() => {
    const rows = document.querySelectorAll('.msg-row');
    const bubbles = document.querySelectorAll('.bubble');
    const list = document.querySelector('.chat-body');
    return {
      title: document.querySelector('.title-text')?.textContent,
      rows: rows.length,
      bubbles: bubbles.length,
      listText: list?.innerText?.slice(0, 300),
      chatPage: !!document.querySelector('.chat-page'),
    };
  });
  console.log('detail', info);

  // 发送
  await page.fill('textarea.chat-input', '这版我改完了');
  await page.click('.send-btn');
  await page.waitForTimeout(1000);

  const after = await page.evaluate(() => ({
    bubbles: document.querySelectorAll('.bubble').length,
    listText: document.querySelector('.chat-body')?.innerText?.slice(0, 400),
  }));
  console.log('after send', after);

  await page.screenshot({ path: 'data/ui7-group.png' });
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
