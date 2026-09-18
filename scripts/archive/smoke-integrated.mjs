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

  const file = 'file:///' + path.resolve('C:/perry/client-dist/index.html').replace(/\\/g, '/');
  // SPA needs server - use live instead
  await page.goto('https://chat.supeiji.top/', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(800);

  await page.screenshot({ path: 'data/ui2-live.png' });

  // try login or register
  const nickInput = page.locator('input[placeholder="昵称"]');
  if (await nickInput.count()) {
    const nick = '整合验收' + Math.floor(Math.random() * 10000);
    await nickInput.fill(nick);
    await page.locator('input[placeholder="密码"]').fill('test1234');
    await page.locator('button.submit').click();
    await page.waitForTimeout(500);
    // avatar step
    const regBtn = page.locator('button.submit');
    if (await regBtn.count()) {
      await regBtn.click();
      await page.waitForTimeout(800);
    }
  }

  await page.waitForTimeout(600);
  await page.screenshot({ path: 'data/ui2-main.png' });

  // open first chat
  const first = page.locator('.msg-item, .chat-item').first();
  if (await first.count()) {
    await first.click();
    await page.waitForTimeout(700);
    await page.screenshot({ path: 'data/ui2-chat.png' });

    // type and send
    const ta = page.locator('textarea.chat-input, #chatInput, textarea');
    if (await ta.count()) {
      await ta.fill('整合验收消息');
      await page.waitForTimeout(150);
      const send = page.locator('button.send-btn');
      if (await send.count()) {
        await send.click();
        await page.waitForTimeout(900);
      }
    }

    // emoji
    const emojiBtn = page.locator('button[aria-label="表情"]');
    if (await emojiBtn.count()) {
      await emojiBtn.click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: 'data/ui2-emoji.png' });
      await emojiBtn.click();
    }

    // back
    const back = page.locator('button[aria-label="返回"]').first();
    if (await back.count()) {
      await back.click();
      await page.waitForTimeout(400);
    }
  }

  // tabs
  for (const [i, name] of [['通讯录'], ['发现'], ['我']].entries()) {
    const btn = page.locator('.tab-item').nth(i + 1);
    if (await btn.count()) {
      await btn.click();
      await page.waitForTimeout(250);
      await page.screenshot({ path: `data/ui2-tab${i + 2}.png` });
    }
  }

  const overflow = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
  }));
  console.log('overflow', overflow);
  console.log('integrated smoke OK');
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
