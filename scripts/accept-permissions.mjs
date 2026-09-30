/**
 * 权限交叉验收：越权、拉黑、未登录媒体、被限制朋友圈
 * 用法: BASE=http://127.0.0.1:3010 node scripts/accept-permissions.mjs
 */
const BASE = process.env.BASE || 'http://127.0.0.1:3010';

let passed = 0;
let failed = 0;
const failures = [];

function ok(cond, msg, detail = '') {
  if (cond) {
    passed += 1;
    console.log('  ✓', msg);
  } else {
    failed += 1;
    failures.push(msg + (detail ? ` — ${detail}` : ''));
    console.log('  ✗', msg, detail || '');
  }
}

function section(title) {
  console.log('\n==', title, '==');
}

async function req(path, { method = 'GET', body, token, headers } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers || {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function rand(p) {
  return p + Math.random().toString(36).slice(2, 7);
}

async function register(nick, password) {
  const r = await req('/api/register', {
    method: 'POST',
    body: { nickname: nick, password },
  });
  if (r.status !== 200) throw new Error(`register ${nick} failed: ${JSON.stringify(r.data)}`);
  return { token: r.data.token, id: r.data.user.id, nickname: r.data.user.nickname };
}

async function main() {
  console.log('BASE =', BASE);

  // 复用管理员
  const admin = await req('/api/login', {
    method: 'POST',
    body: { nickname: '小苏', password: '1234' },
  });
  ok(admin.status === 200, '管理员可登录');

  const A = await register(rand('权A'), 'aaa99999');
  const B = await register(rand('权B'), 'bbb99999');
  const C = await register(rand('权C'), 'ccc99999');

  section('1. 普通成员不能绕过群管理员限制');
  const g = await req('/api/groups', {
    method: 'POST',
    token: A.token,
    body: { name: '越权群', memberIds: [B.id], aiMembers: ['思琪', '小辣椒'] },
  });
  ok(g.status === 200, '建群', JSON.stringify(g.data));
  const gid = g.data.group?.id;
  if (gid) {
    const r1 = await req(`/api/groups/${gid}/rename`, {
      method: 'POST',
      token: B.token,
      body: { name: 'B乱改' },
    });
    ok(r1.status === 403, '成员改群名被拒');
    const r2 = await req(`/api/groups/${gid}/members/remove`, {
      method: 'POST',
      token: B.token,
      body: { key: 'u' + A.id },
    });
    ok(r2.status === 403, '成员踢群主被拒');
    const r3 = await req(`/api/groups/${gid}/notice`, {
      method: 'POST',
      token: B.token,
      body: { notice: '假公告' },
    });
    ok(r3.status === 403, '成员发公告被拒');
    const r4 = await req(`/api/groups/${gid}/join-approval`, {
      method: 'POST',
      token: B.token,
      body: { requireApproval: false },
    });
    ok(r4.status === 403, '成员改入群设置被拒');
  }

  section('2. 被限制朋友圈的人不能从其它入口看到');
  await req('/api/friends', {
    method: 'POST',
    token: A.token,
    body: { friendId: B.id },
  });
  await req('/api/friends', {
    method: 'POST',
    token: B.token,
    body: { friendId: A.id },
  });
  await req('/api/friends', {
    method: 'POST',
    token: A.token,
    body: { friendId: C.id },
  });
  await req('/api/friends', {
    method: 'POST',
    token: C.token,
    body: { friendId: A.id },
  });

  await req('/api/settings', {
    method: 'PUT',
    token: A.token,
    body: {
      settings: {
        momentsPublic: false,
        strangerSee10: false,
        momentsHideFrom: [B.id],
      },
    },
  });

  const post = await req('/api/moments', {
    method: 'POST',
    token: A.token,
    body: { content: '权限交叉验收动态', visibility: 'public' },
  });
  ok(post.status === 200, '作者发动态');
  const mid = post.data.moment?.id;

  // 时间线
  const feedB = await req('/api/moments', { token: B.token });
  ok(!(feedB.data.moments || []).some((m) => m.id === mid), '时间线：被限制者看不到');

  // 个人主页
  const userFeedB = await req(`/api/moments/user/${A.id}`, { token: B.token });
  ok(
    !(userFeedB.data.moments || []).some((m) => m.id === mid),
    '个人主页：被限制者看不到'
  );

  // 直接访问单条接口（若无单条接口则看 user feed）
  const feedC = await req('/api/moments', { token: C.token });
  ok((feedC.data.moments || []).some((m) => m.id === mid), '未被限制好友能看到');

  section('3. 拉黑后不能私聊/加好友');
  await req('/api/friends/blacklist', {
    method: 'POST',
    token: A.token,
    body: { friendId: B.id, blacklisted: true },
  });
  const reAdd = await req('/api/friends', {
    method: 'POST',
    token: B.token,
    body: { friendId: A.id },
  });
  ok(reAdd.status === 403 || reAdd.status === 400, '被拉黑方不能再加好友', `status=${reAdd.status}`);

  // 拉黑后朋友圈对对方也不可见
  const feedB2 = await req('/api/moments', { token: B.token });
  ok(!(feedB2.data.moments || []).some((m) => m.id === mid), '拉黑后时间线仍不可见');

  section('4. 未登录不能访问受保护接口');
  const anonMedia = await fetch(BASE + '/api/chat/upload', { method: 'POST' });
  ok(anonMedia.status === 401 || anonMedia.status === 400, '未登录不能上传媒体', `status=${anonMedia.status}`);

  const anonBackup = await fetch(BASE + '/api/backup/export');
  ok(anonBackup.status === 401, '未登录不能导出备份', `status=${anonBackup.status}`);

  const anonAdmin = await fetch(BASE + '/api/admin/overview');
  ok(anonAdmin.status === 401, '未登录不能进后台', `status=${anonAdmin.status}`);

  const anonMe = await fetch(BASE + '/api/me');
  ok(anonMe.status === 401, '未登录不能取资料', `status=${anonMe.status}`);

  // 媒体直链：带 cookie/token 的中间件
  const anonHistory = await fetch(BASE + '/api/auth/login-history');
  ok(anonHistory.status === 401, '未登录不能看登录记录', `status=${anonHistory.status}`);

  section('5. 管理后台仅管理员');
  const userAdmin = await req('/api/admin/overview', { token: A.token });
  ok(userAdmin.status === 403 || userAdmin.status === 401, '普通用户不能进后台');
  const adminOk = await req('/api/admin/overview', { token: admin.data.token });
  ok(adminOk.status === 200, '管理员可进后台');

  section('6. 他人数据隔离');
  const backupList = await req('/api/backup/cloud', { token: A.token });
  if (backupList.data.backups?.length) {
    const id = backupList.data.backups[0].id;
    const steal = await req(`/api/backup/cloud/${id}`, { token: B.token });
    ok(steal.status === 404, '不能读他人云备份');
  } else {
    // A 自己备份一份再测
    await req('/api/backup/cloud', { method: 'POST', token: A.token, body: { limit: 10 } });
    const list2 = await req('/api/backup/cloud', { token: A.token });
    const id = list2.data.backups?.[0]?.id;
    if (id) {
      const steal = await req(`/api/backup/cloud/${id}`, { token: B.token });
      ok(steal.status === 404, '不能读他人云备份');
    }
  }

  const loginHist = await req('/api/auth/login-history', { token: B.token });
  ok(
    !(loginHist.data.items || []).some((x) => x.userId && x.userId !== B.id),
    '登录记录仅本人'
  );

  console.log('\n======== 权限交叉结果 ========');
  console.log(`通过 ${passed} · 失败 ${failed}`);
  if (failures.length) {
    console.log('失败项:');
    for (const f of failures) console.log(' -', f);
    process.exit(1);
  }
  console.log('全部通过');
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
