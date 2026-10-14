// 验证「群聊去掉 AI 群友」：GUI 层确认群聊页无 AI 成员、@列表无 AI、建群面板无 AI 选项。
// 用法: BASE=http://127.0.0.1:3010 node scripts/verify-no-ai-group.mjs
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://127.0.0.1:3010';
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

async function dismissConsent() {
  const ghost = page.locator('.consent-card .btn.ghost').first();
  if (await ghost.isVisible().catch(() => false)) {
    await ghost.click().catch(() => {});
    await page.waitForTimeout(300);
  }
  const mask = page.locator('.consent-mask').first();
  if (await mask.isVisible().catch(() => false)) {
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(300);
  }
}

const nick = '群验证' + Math.floor(Math.random() * 100000);
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForSelector('input', { timeout: 15000 });
await page.locator('button.switch').first().click();
await page.waitForTimeout(400);
await page.getByPlaceholder('手机号').fill('1' + String(Math.floor(Math.random() * 9e9)).padStart(9, '9'));
await page.getByPlaceholder('验证码').fill('123456');
await page.locator('.code-btn').click().catch(() => {});
await page.getByPlaceholder('昵称（登录用，可选）').fill(nick);
await page.locator('input[type="password"]').fill('test1234');
await page.locator('button.submit').click();
await page.waitForTimeout(1200);
const avatarStep = page.locator('.avatar-step');
for (let i = 0; i < 10; i++) {
  if (await page.locator('.tab-bar').isVisible().catch(() => false)) break;
  if (await avatarStep.isVisible().catch(() => false)) {
    await page.locator('.avatar-cell').first().click();
    await page.locator('button.submit').click();
  }
  await page.waitForTimeout(800);
}
await page.waitForTimeout(1200);
await dismissConsent();
check('注册后进入主界面', await page.locator('.tab-bar').isVisible().catch(() => false));

// ── 会话列表: 只应有 WeChat 主群，无 AI 演示群 ──
const chatText = await page.locator('.msg-item').allInnerTexts().catch(() => []);
check(
  '会话列表无 AI 演示群',
  !chatText.some((t) => /产品设计小分队|工作对接群/.test(t)),
  chatText.join(' | ').slice(0, 160)
);

// ── 打开主群（用 JS 点击，避免遮罩/滚动导致的可见性判定） ──
await page.evaluate(() => {
  const el = document.querySelector('.msg-item');
  if (el) el.click();
});
await page.waitForTimeout(1800);
await dismissConsent();
const navTitle = await page.locator('.nav-title').first().innerText().catch(() => '');
check('进入群聊', Boolean(navTitle), navTitle);

// ── @ 提及面板不应出现任何人设名 ──
const input = page.locator('textarea, input[type="text"]').first();
if (await input.isVisible().catch(() => false)) {
  await input.fill('@');
  await page.waitForTimeout(800);
  const mentionText = await page.locator('.mention-picker, .mention-list, .mention-item').allInnerTexts().catch(() => []);
  const joined = mentionText.join(' | ');
  check(
    '@列表无 AI 人设',
    !/思琪|Perry|像牛奶|小辣椒|王也|叶修|方圆|阿强/.test(joined),
    joined.slice(0, 160) || '(无 @ 面板或仅真人)'
  );
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(300);
}

// ── 群内消息的发送者不应出现任何人设名（AI 气泡） ──
const senderNames = await page.locator('.sender-name').allInnerTexts().catch(() => []);
const personaRe = /思琪|Perry|像牛奶不是牛奶|小辣椒|王也|叶修|方圆|阿强|妈妈|爸爸/;
check(
  '群内无 AI 发送者',
  !senderNames.some((n) => personaRe.test(n)),
  senderNames.join(' | ').slice(0, 160) || '(无发送者名)'
);

// ── 发起群聊面板: 不应出现 AI 标签与 AI 文案 ──
await page.locator('.nav-back').first().click({ force: true }).catch(() => {});
await page.waitForTimeout(700);
await page.locator('button[aria-label="更多"]').click({ force: true }).catch(() => {});
await page.waitForTimeout(400);
await page.locator('button').filter({ hasText: '发起群聊' }).first().click({ force: true }).catch(() => {});
await page.waitForTimeout(1000);
const onCreateGroup = await page.locator('.nav-title').first().innerText().catch(() => '');
const pickRows = await page.locator('.pick-row').allInnerTexts().catch(() => []);
const aiTags = await page.locator('.ai-tag').count().catch(() => 0);
check('发起群聊无 AI 选项', aiTags === 0, `ai-tag=${aiTags}; rows=${pickRows.length}`);
const hintText = onCreateGroup.includes('发起群聊')
  ? await page.locator('.hint').first().innerText().catch(() => '')
  : '';
check('发起群聊文案已更新', !/AI/.test(hintText), hintText || `(页面: ${onCreateGroup})`);

console.log('\n===== 结果 =====');
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} 通过`);
if (pageErrors.length) {
  console.log(`\n页面 JS 错误 (${pageErrors.length}):`);
  for (const e of pageErrors.slice(0, 8)) console.log('  ' + e);
}
await browser.close();
process.exit(failed.length ? 1 : 0);
