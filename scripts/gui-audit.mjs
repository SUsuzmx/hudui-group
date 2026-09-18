// GUI 审查: 用 Edge 无头浏览器模拟真实用户, 遍历所有 Tab/入口/子页面,
// 记录: 占位页(StubView), 死按钮, JS 报错, 关键流程是否走通
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:3000';
const results = [];
const pageErrors = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
}

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  args: ['--no-proxy-server', '--no-sandbox', '--disable-dev-shm-usage'],
});
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  locale: 'zh-CN',
});
const page = await ctx.newPage();
page.on('pageerror', (e) => pageErrors.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') pageErrors.push('console: ' + m.text());
});
page.setDefaultTimeout(8000);

const nick = '验收用户' + Math.floor(Math.random() * 100000);

// ── 1. 登录页 → 注册 ──
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForSelector('input', { timeout: 15000 });
check('登录页渲染', true);
// 切到注册模式
await page.locator('button.switch').first().click();
await page.waitForTimeout(400);
const phone = '1' + String(Math.floor(Math.random() * 9e9)).padStart(9, '9');
await page.getByPlaceholder('手机号').fill(phone);
await page.getByPlaceholder('验证码').fill('123456');
// 发送验证码按钮(可点)
await page.locator('.code-btn').click().catch(() => {});
await page.getByPlaceholder('昵称（登录用，可选）').fill(nick);
await page.locator('input[type="password"]').fill('test1234');
await page.locator('button.submit').click();
await page.waitForTimeout(1200);
// 第二步: 选头像
const avatarStep = page.locator('.avatar-step');
for (let i = 0; i < 10; i++) {
  if (await page.locator('.tab-bar').isVisible().catch(() => false)) break;
  if (await avatarStep.isVisible().catch(() => false)) {
    await page.locator('.avatar-cell').first().click();
    await page.locator('button.submit').click();
  }
  await page.waitForTimeout(800);
}
await page.waitForTimeout(1500);
const onMain = await page.locator('.tab-bar').isVisible().catch(() => false);
check('注册后进入主界面', onMain);

// ── 2. 消息 Tab: 会话列表 ──
const chatItems = await page.locator('.msg-item').count();
check('会话列表有内容', chatItems > 0, `${chatItems} 个会话`);

// 更多菜单里的每个入口
const menuItems = ['发起群聊', '添加朋友', '扫一扫', '收付款'];
const stubMarker = '该入口已接入导航';

async function enterAndRecord(name, okName) {
  await page.locator('button').filter({ hasText: name }).first().click();
  await page.waitForTimeout(900);
  const isStub = await page.locator(`text=${stubMarker}`).isVisible().catch(() => false);
  const hasBack = await page.locator('.nav-back').first().isVisible().catch(() => false);
  check(okName || name + ' 页面可用', hasBack && !isStub, isStub ? '是占位页' : '');
  return isStub;
}

const stubReport = {};
for (const m of menuItems) {
  await page.locator('button[aria-label="更多"]').click();
  await page.waitForTimeout(300);
  const isStub = await enterAndRecord(m);
  if (isStub) stubReport['更多菜单>' + m] = true;
  await page.locator('.nav-back').first().click().catch(async () => {
    await page.keyboard.press('Escape');
  });
  await page.waitForTimeout(600);
}
if (!Object.keys(stubReport).length) check('更多菜单全部可用', true);
else check('更多菜单存在占位入口', false, Object.keys(stubReport).join(', '));

// ── 3. 群聊: 打开默认群, 发消息 ──
await page.locator('.msg-item').first().click();
await page.waitForTimeout(1200);
const chatVisible = await page.locator('input[type="text"], .chat-input input, textarea').first().isVisible().catch(() => false)
  || await page.locator('.dock, .chat-dock, input').first().isVisible().catch(() => false);
check('进入群聊', chatVisible);
// 发一条消息
const msgInput = page.locator('.dock input[type="text"], input[placeholder*="说"], .chat-input input').first();
if (!(await msgInput.isVisible().catch(() => false))) {
  // 兜底: 找可见的 text input
  const all = page.locator('input[type="text"]');
  for (let i = 0; i < await all.count(); i++) {
    if (await all.nth(i).isVisible()) { await msgInput.waitFor({ state: 'visible' }).catch(() => {}); break; }
  }
}
await msgInput.fill('GUI 审查测试消息');
await page.locator('button').filter({ hasText: /发送/ }).first().click().catch(() => {});
await page.keyboard.press('Enter');
await page.waitForTimeout(800);
check('群聊消息发出并显示', await page.locator('.bubble, .msg-bubble').filter({ hasText: 'GUI 审查测试消息' }).first().isVisible().catch(() => false));

// 加号面板逐个按钮
await page.locator('button[aria-label="更多功能"], .dock-plus, button:has-text("＋")').first().click().catch(() => {});
const plusBtn = page.locator('.plus-item');
if (!(await plusBtn.first().isVisible().catch(() => false))) {
  // 重新找加号
  await page.locator('.icon-btn:has(svg)').last().click().catch(() => {});
  await page.waitForTimeout(400);
}
const plusCount = await plusBtn.count();
check('加号面板渲染', plusCount > 0, `${plusCount} 项`);
await page.keyboard.press('Escape');
// 返回
await page.locator('.nav-back').first().click();
await page.waitForTimeout(600);

// ── 4. 通讯录 Tab: 每个入口 ──
await page.locator('.tab-item').filter({ hasText: '通讯录' }).click();
await page.waitForTimeout(500);
for (const label of ['新的朋友', '标签', '公众号']) {
  const isStub = await enterAndRecord(label);
  if (isStub) stubReport['通讯录>' + label] = true;
}
// 打开一个联系人资料页
const contact = page.locator('.contact-row').first();
if (await contact.isVisible().catch(() => false)) {
  await contact.click();
  await page.waitForTimeout(800);
  const isStub = await page.locator(`text=${stubMarker}`).isVisible().catch(() => false);
  check('联系人资料页可用', !isStub && await page.locator('.nav-back').isVisible().catch(() => false));
  await page.locator('.nav-back').first().click();
  await page.waitForTimeout(500);
}

// ── 5. 发现 Tab ──
await page.locator('.tab-item').filter({ hasText: '发现' }).click();
await page.waitForTimeout(500);
// 朋友圈
await page.locator('.cell-row').filter({ hasText: '朋友圈' }).click();
await page.waitForTimeout(1000);
check('朋友圈打开', await page.locator('.nav-back').isVisible().catch(() => false));
await page.locator('.nav-back').first().click();
await page.waitForTimeout(500);
for (const label of ['扫一扫', '搜一搜']) {
  const isStub = await enterAndRecord(label);
  if (isStub) stubReport['发现>' + label] = true;
}

// ── 6. 我 Tab ──
await page.locator('.tab-item').filter({ hasText: '我' }).last().click();
await page.waitForTimeout(500);
// 资料卡
await page.locator('.profile-card').click();
await page.waitForTimeout(800);
check('编辑资料页可用', await page.locator('.nav-back').isVisible().catch(() => false));
await page.locator('.nav-back').first().click();
await page.waitForTimeout(500);
for (const label of ['收藏', '钱包', '标签', '设置']) {
  const isStub = await enterAndRecord(label);
  if (isStub) stubReport['我>' + label] = true;
}

// 设置子页面
await page.locator('.tab-item').filter({ hasText: '我' }).last().click();
await page.waitForTimeout(300);
await page.locator('.cell-row').filter({ hasText: '设置' }).click();
await page.waitForTimeout(600);
for (const label of ['账号与安全', '新消息通知', '聊天', '通用 / 显示', '关于']) {
  const row = page.locator('button.row').filter({ hasText: label }).first();
  if (await row.isVisible().catch(() => false)) {
    await row.click();
    await page.waitForTimeout(500);
    const hasContent = (await page.locator('.content .card, .content .row').count()) > 0;
    check('设置>' + label + ' 有内容', hasContent);
    await page.locator('.nav-back').first().click();
    await page.waitForTimeout(400);
  } else {
    check('设置>' + label + ' 存在', false, '入口未找到');
  }
}
await page.locator('.nav-back').first().click();
await page.waitForTimeout(500);

// ── 7. 私聊: 打开 AI 联系人 ──
await page.locator('.tab-item').filter({ hasText: '通讯录' }).click();
await page.waitForTimeout(400);
const aiContact = page.locator('.contact-row').filter({ hasText: 'AI 联系人' }).first();
if (await aiContact.isVisible().catch(() => false)) {
  await aiContact.click();
  await page.waitForTimeout(600);
  const sendBtn = page.locator('button').filter({ hasText: '发消息' }).first();
  if (await sendBtn.isVisible().catch(() => false)) {
    await sendBtn.click();
    await page.waitForTimeout(1000);
  }
  const pi = page.locator('input[type="text"]').last();
  if (await pi.isVisible().catch(() => false)) {
    await pi.fill('你好呀, 私聊测试');
    await pi.press('Enter');
    await page.waitForTimeout(2500);
    check('私聊消息发出', await page.locator('.bubble').filter({ hasText: '私聊测试' }).first().isVisible().catch(() => false));
  } else {
    check('私聊输入框', false, '未找到输入框');
  }
  await page.locator('.nav-back').first().click();
  await page.waitForTimeout(500);
} else {
  check('AI 联系人入口', false, '通讯录无 AI 联系人');
}

// ── 汇总 ──
console.log('\n===== GUI 审查结果 =====');
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} 通过`);
if (Object.keys(stubReport).length) {
  console.log('占位入口: ' + Object.keys(stubReport).join(', '));
}
if (pageErrors.length) {
  console.log('\n页面 JS 错误 (' + pageErrors.length + '):');
  for (const e of pageErrors.slice(0, 10)) console.log('  ' + e);
}
await browser.close();
process.exit(failed.length ? 1 : 0);
