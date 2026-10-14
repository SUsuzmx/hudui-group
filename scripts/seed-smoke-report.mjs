// 为后台冒烟测试准备一条待处理举报（走用户端接口，模拟真实来源）。
// 测试结束后可安全删除：report.category='other' 且 detail 带固定标记。
const BASE = process.env.BASE || 'https://chat.supeiji.top';
const MARK = '[smoke-seed]';

const login = await fetch(`${BASE}/api/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ nickname: process.env.ADMIN_TEST_USER || '小苏', password: process.env.ADMIN_TEST_PASS || '1234' }),
});
const auth = await login.json();
if (!auth.token) {
  console.error('用户端登录失败:', auth);
  process.exit(1);
}

const res = await fetch(`${BASE}/api/reports`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
  body: JSON.stringify({
    targetType: 'user',
    targetId: String(auth.user.id),
    category: 'other',
    detail: `${MARK} 冒烟测试种子举报，可安全删除`,
  }),
});
const data = await res.json().catch(() => ({}));
console.log('创建举报:', res.status, JSON.stringify(data));
