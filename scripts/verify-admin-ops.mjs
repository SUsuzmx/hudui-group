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
const token = login.data.token;
console.log('login', login.status, 'isAdmin=', login.data.user?.isAdmin);

const me = await req('/api/me', { token });
console.log('me isAdmin=', me.data.user?.isAdmin);

const ov = await req('/api/admin/overview', { token });
console.log('overview', ov.status, 'pendingReports=', ov.data.pendingReports);

const reports = await req('/api/admin/reports?status=pending', { token });
console.log('pending reports', reports.status, reports.data?.reports?.length);
const first = reports.data?.reports?.[0];
if (first) {
  const handle = await req(`/api/admin/reports/${first.id}`, {
    method: 'POST',
    token,
    body: { status: 'done', handlerNote: '已核实处理' },
  });
  console.log('handle report', handle.status, handle.data?.report?.status);
}

const fbs = await req('/api/admin/feedback?status=open', { token });
console.log('open feedback', fbs.status, fbs.data?.feedbacks?.length);
const fb = fbs.data?.feedbacks?.[0];
if (fb) {
  const reply = await req(`/api/admin/feedback/${fb.id}/reply`, {
    method: 'POST',
    token,
    body: { reply: '收到，我们会尽快改进' },
  });
  console.log('reply feedback', reply.status);
}

const errs = await req('/api/admin/errors', { token });
console.log('errors', errs.status, errs.data?.errors?.length);

// 普通用户
const reg = await req('/api/register', {
  method: 'POST',
  body: { nickname: 'UserCheck' + Date.now().toString(36), password: 'secret99' },
});
console.log('normal user isAdmin=', reg.data.user?.isAdmin, 'admin api', (await req('/api/admin/overview', { token: reg.data.token })).status);
