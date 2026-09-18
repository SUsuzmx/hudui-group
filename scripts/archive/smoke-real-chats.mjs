import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto('https://chat.supeiji.top/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(700);

  await page.fill('input[placeholder="昵称"]', '验证员205');
  await page.fill('input[placeholder="密码"]', 'test1234');
  await page.click('button.submit');
  await page.waitForSelector('.main-page', { timeout: 10000 });
  await page.waitForTimeout(1200);

  const names = await page.evaluate(() =>
    [...document.querySelectorAll('.msg-name')].map((el) => el.textContent)
  );
  console.log('real chats', names);

  const fake = names.filter((n) =>
    ['阿哲', '韩梅梅', '李雷', '陈默', '白小纯', '高圆圆'].some((x) => n.includes(x))
  );
  console.log('fake remaining', fake);
  console.log(fake.length === 0 ? 'PASS only real chats' : 'FAIL still has fake');
  await browser.close();
  process.exit(fake.length === 0 ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
