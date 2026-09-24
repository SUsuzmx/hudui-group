import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const logs = [];
page.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') logs.push('CONSOLE ' + m.text());
});

await page.goto('http://127.0.0.1:3010/', { waitUntil: 'networkidle', timeout: 20000 });
await page.waitForTimeout(800);
console.log('TITLE', await page.title());
const body0 = await page.locator('body').innerText();
console.log('BODY0', body0.slice(0, 180).replace(/\n/g, ' | '));

const hasLogin = await page.locator('input[type=password]').count();
console.log('hasLogin', hasLogin);

if (hasLogin) {
  const nick = 'UI验' + Date.now().toString(36).slice(-4);
  await page.locator('input').first().fill(nick);
  await page.locator('input[type=password]').first().fill('test1234');
  const regBtn = page.getByRole('button', { name: /注册/ }).first();
  const loginBtn = page.getByRole('button', { name: /^登录$/ }).first();
  if (await regBtn.count()) await regBtn.click();
  else if (await loginBtn.count()) await loginBtn.click();
  await page.waitForTimeout(1800);
  const after = await page.locator('body').innerText();
  console.log('AFTER', after.slice(0, 220).replace(/\n/g, ' | '));

  // 服务通知
  console.log('HAS_SERVICE', after.includes('服务通知'));

  // 打开第一会话
  const msgItem = page.locator('.msg-item').filter({ hasNotText: '服务通知' }).first();
  if (await msgItem.count()) {
    await msgItem.click();
    await page.waitForTimeout(1200);
    const more = page.locator('button[aria-label="更多功能"]');
    if (await more.count()) {
      await more.first().click();
      await page.waitForTimeout(500);
      const plusText = (await page.locator('.plus-grid').first().innerText().catch(() => '')).replace(/\n/g, '|');
      console.log('PLUS', plusText);
      for (const k of ['相册', '拍摄', '位置', '红包', '转账', '个人名片', '收藏', '文件', '群工具', '视频通话']) {
        console.log('PLUS_HAS', k, plusText.includes(k));
      }
      // 打开群工具
      const tools = page.locator('.plus-item', { hasText: '群工具' });
      if (await tools.count()) {
        await tools.first().click();
        await page.waitForTimeout(400);
        const toolsText = (await page.locator('.plus-grid').last().innerText().catch(() => '')).replace(/\n/g, '|');
        console.log('TOOLS', toolsText);
        for (const k of ['群接龙', '群收款', '群待办', '@成员']) {
          console.log('TOOL_HAS', k, toolsText.includes(k));
        }
      }
    }
  }

  // 发现页状态墙
  const discoverTab = page.locator('.tab-item, .tab-btn, [class*="tab"]').filter({ hasText: '发现' }).first();
  // fallback: click text 发现 in bottom bar
  const dbtn = page.getByText('发现', { exact: true }).first();
  if (await dbtn.count()) {
    await dbtn.click();
    await page.waitForTimeout(500);
    const dtext = (await page.locator('body').innerText()).replace(/\n/g, ' | ');
    console.log('HAS_STATUS_WALL', dtext.includes('状态墙'));
    console.log('DISCOVER_SNIP', dtext.slice(dtext.indexOf('朋友圈'), dtext.indexOf('朋友圈') + 180));
  }

  await page.screenshot({ path: 'C:/perry/data/verify-ui.png', fullPage: false });
}

console.log('LOGS', logs.slice(0, 12));
await browser.close();
