// 用 Playwright 无头 Chromium 对应用截图: 登录页 → 注册 → 群聊(含AI欢迎) → 发消息 → 点名AI。
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:3000';
const OUT = 'shots';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 414, height: 800 } });
const nick = '截图员' + Math.floor(Math.random() * 100);

// 1. 登录页
await page.goto(BASE);
await page.waitForSelector('input[placeholder="昵称"]', { timeout: 10000 });
await page.screenshot({ path: `${OUT}/1-login.png` });

// 2. 切注册并提交
await page.getByText('没有账号？注册一个').click();
await page.fill('input[placeholder="昵称"]', nick);
await page.fill('input[placeholder="密码"]', 'shot1234');
await page.getByText('注册并进群').click();

// 3. 等待进群 + AI 欢迎(语录模式带打字延迟, 最长~6s)
await page.waitForSelector('.msg-row', { timeout: 15000 });
await sleep(9000);
await page.screenshot({ path: `${OUT}/2-chat-welcome.png`, fullPage: false });

// 4. 发消息
await page.fill('.input-bar textarea', '大家好，我是新人，多多关照！');
await page.keyboard.press('Enter');
await sleep(9000);
await page.screenshot({ path: `${OUT}/3-after-send.png` });

// 5. 点名 AI
await page.fill('.input-bar textarea', '小辣椒 你觉得我这个人怎么样');
await page.keyboard.press('Enter');
await sleep(10000);
await page.screenshot({ path: `${OUT}/4-mention-ai.png` });

// 6. 成员面板
await page.locator('.nav-right').click();
await sleep(500);
await page.screenshot({ path: `${OUT}/5-members.png` });

// 桌面宽度
await page.setViewportSize({ width: 1280, height: 800 });
await sleep(800);
await page.screenshot({ path: `${OUT}/6-desktop.png` });

await browser.close();
console.log('done, nick=' + nick);
