import { chromium } from 'playwright';
import path from 'node:path';

(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') console.log('CONSOLE', m.text());
  });

  const file = 'file:///' + path.resolve('index.html').replace(/\\/g, '/');
  await page.goto(file, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);

  // 消息列表截图
  await page.screenshot({ path: 'data/ui-msglist.png', fullPage: false });

  // 进入第一条会话
  await page.locator('.msg-item').first().click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'data/ui-chat.png' });

  // 输入并发送
  await page.fill('#chatInput', '今晚一起吃饭吗？');
  await page.waitForTimeout(100);
  const sendVisible = await page.locator('#btnSend').isVisible();
  console.log('send btn visible', sendVisible);
  await page.click('#btnSend');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'data/ui-chat-sent.png' });

  // 打开表情面板
  await page.click('#btnEmoji');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'data/ui-emoji.png' });
  await page.click('#btnEmoji');
  await page.waitForTimeout(200);

  // 加号面板
  await page.click('#btnPlus');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'data/ui-plus.png' });

  // 返回列表
  await page.click('#btnChatBack');
  await page.waitForTimeout(400);

  // 通讯录
  await page.click('.tab-item[data-tab="contacts"]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'data/ui-contacts.png' });

  // 发现
  await page.click('.tab-item[data-tab="discover"]');
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'data/ui-discover.png' });

  // 我的
  await page.click('.tab-item[data-tab="me"]');
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'data/ui-me.png' });

  // 横向滚动检查
  await page.click('.tab-item[data-tab="messages"]');
  await page.waitForTimeout(200);
  const overflow = await page.evaluate(() => {
    const el = document.querySelector('#app');
    return {
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
      appScrollW: el.scrollWidth,
      appClientW: el.clientWidth,
    };
  });
  console.log('overflow check', overflow);

  console.log('UI smoke OK');
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
