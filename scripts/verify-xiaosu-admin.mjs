const BASE = 'http://127.0.0.1:3010';

async function req(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

const login = await req('/api/login', {
  method: 'POST',
  body: { nickname: '小苏', password: '1234' },
});
console.log('login', login.status, login.data?.user?.id, login.data?.user?.nickname, !!login.data?.token);

if (!login.data?.token) {
  console.error('login failed', login.data);
  process.exit(1);
}
const token = login.data.token;

const admin = await req('/api/admin/overview', { token });
console.log('admin overview', admin.status, {
  users: admin.data?.users,
  groups: admin.data?.groups,
  pendingReports: admin.data?.pendingReports,
  errors24h: admin.data?.errors24h,
});

// 其它用户应无权限
const other = await req('/api/register', {
  method: 'POST',
  body: { nickname: 'NoAdmin' + Date.now().toString(36), password: 'secret99' },
});
const denied = await req('/api/admin/overview', { token: other.data.token });
console.log('non-admin overview', denied.status, denied.data?.error || '');

const faq = await req('/api/faq', { token });
console.log('faq', faq.status, faq.data?.faq?.length);
const help = await req('/api/feedback/mine', { token });
console.log('feedback/mine', help.status, help.data?.feedbacks?.length ?? 0);
const reports = await req('/api/reports/mine', { token });
console.log('reports/mine', reports.status, reports.data?.reports?.length ?? 0);

if (admin.status === 200 && denied.status === 403 && faq.status === 200) {
  console.log('OK: 小苏 is sole admin, help/feedback reachable');
} else {
  console.log('CHECK FAILED');
  process.exit(1);
}
