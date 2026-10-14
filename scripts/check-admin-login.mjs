// 验证后台账号密码是否可用
const BASE = process.env.BASE || 'http://127.0.0.1:3010';

const candidates = [
  ['小苏', '1234'],
];

for (const [username, password] of candidates) {
  try {
    const res = await fetch(`${BASE}/api/admin/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 200 && data.token) {
      console.log(`✓ 登录成功  username="${username}"  password="${password}"`);
      console.log(`  显示名 : ${data.admin.displayName}`);
      console.log(`  角色   : ${data.admin.roleLabel} (${data.admin.role})`);
      console.log(`  权限数 : ${data.permissions?.length}`);
    } else {
      console.log(`✗ 登录失败  username="${username}"  password="${password}"  HTTP ${res.status}  ${data.error || ''}`);
    }
  } catch (e) {
    console.log(`! 请求异常: ${e.message}`);
  }
}
