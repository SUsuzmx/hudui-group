// 运营后台端到端冒烟测试：覆盖登录、鉴权隔离、九大模块读写、封禁生效、审计留痕。
// 用法: node scripts/smoke-admin.mjs   （需先启动服务，默认 3010，可用 ADMIN_TEST_BASE 覆盖）
const BASE = process.env.ADMIN_TEST_BASE || 'http://127.0.0.1:3010';
const BOOTSTRAP = process.env.ADMIN_TEST_USER || 'admin';
const BOOTSTRAP_PWD = process.env.ADMIN_TEST_PASS || '';

let pass = 0;
let fail = 0;

function ok(name, cond, extra = '') {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${name}${extra ? ` — ${extra}` : ''}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`);
  }
}

async function req(path, { method = 'GET', body, token, raw = false } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  if (raw) return { status: res.status, text: await res.text(), type: res.headers.get('content-type') };
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

console.log(`\n运营后台冒烟测试 → ${BASE}\n`);

// ---------- 1. 静态入口 ----------
console.log('[1] 独立前端入口 /admin');
{
  const r = await req('/admin', { raw: true });
  ok('GET /admin 返回 HTML', r.status === 200 && /text\/html/.test(r.type || ''), `HTTP ${r.status}`);
  ok('HTML 为后台页面', /运营后台/.test(r.text));
  const deep = await req('/admin/anything', { raw: true });
  ok('SPA 深链回退到 index.html', deep.status === 200 && /运营后台/.test(deep.text));
}

// ---------- 2. 登录 ----------
console.log('\n[2] 后台登录');
let token = null;
{
  const bad = await req('/api/admin/auth/login', {
    method: 'POST', body: { username: BOOTSTRAP, password: 'definitely-wrong' },
  });
  ok('错误密码被拒绝', bad.status === 401, `HTTP ${bad.status}`);

  if (!BOOTSTRAP_PWD) {
    console.log('  ! 未提供 ADMIN_TEST_PASS，跳过登录后的用例');
    console.log(`\n结果: ${pass} 通过 / ${fail} 失败（部分跳过）\n`);
    process.exit(fail ? 1 : 0);
  }

  const login = await req('/api/admin/auth/login', {
    method: 'POST', body: { username: BOOTSTRAP, password: BOOTSTRAP_PWD },
  });
  ok('正确凭据登录成功', login.status === 200 && Boolean(login.data.token), `HTTP ${login.status}`);
  token = login.data.token;
  ok('返回管理员信息与权限', Array.isArray(login.data.permissions) && login.data.admin?.username === BOOTSTRAP);
  ok('管理员密码字段不外泄', login.data.admin && !('password_hash' in login.data.admin));
}

if (!token) {
  console.log(`\n结果: ${pass} 通过 / ${fail} 失败\n`);
  process.exit(1);
}

// ---------- 3. 鉴权隔离 ----------
console.log('\n[3] 鉴权与隔离');
{
  const noAuth = await req('/api/admin/dashboard');
  ok('无 token 访问被拒', noAuth.status === 401, `HTTP ${noAuth.status}`);

  const badToken = await req('/api/admin/dashboard', { token: 'not-a-real-token' });
  ok('伪造 token 被拒', badToken.status === 401, `HTTP ${badToken.status}`);

  // 用户端 token 不能访问后台
  const userLogin = await req('/api/login', {
    method: 'POST', body: { nickname: '小苏', password: '1234' },
  });
  if (userLogin.status === 200 && userLogin.data.token) {
    const crossed = await req('/api/admin/dashboard', { token: userLogin.data.token });
    ok('用户端 token 无法访问后台', crossed.status === 401, `HTTP ${crossed.status}`);
  } else {
    console.log('  - 用户端登录不可用，跳过跨端隔离用例');
  }

  const me = await req('/api/admin/auth/me', { token });
  ok('GET /auth/me 返回当前管理员', me.status === 200 && me.data.admin?.username === BOOTSTRAP);
}

// ---------- 4. 概览 ----------
console.log('\n[4] 概览仪表盘');
{
  const d = await req('/api/admin/dashboard?days=7', { token });
  ok('dashboard 返回 200', d.status === 200, `HTTP ${d.status}`);
  ok('包含 totals', d.data.totals && typeof d.data.totals.users === 'number');
  ok('包含 todos', d.data.todos && typeof d.data.todos.pendingReports === 'number');
  ok('包含 realtime', d.data.realtime && typeof d.data.realtime.newUsersToday === 'number');
  ok('趋势为 7 个桶', d.data.trends?.users?.length === 7, `实际 ${d.data.trends?.users?.length}`);
  ok('包含分类统计与最近审计', Array.isArray(d.data.reportByCategory) && Array.isArray(d.data.recentAudit));
}

// ---------- 5. 用户管理 ----------
console.log('\n[5] 用户管理');
let victim = null;
{
  const list = await req('/api/admin/users?limit=5', { token });
  ok('用户列表返回 200', list.status === 200, `HTTP ${list.status}`);
  ok('返回分页总数', typeof list.data.total === 'number', `total=${list.data.total}`);
  ok('用户字段含封禁状态', list.data.users?.[0] && 'banned' in list.data.users[0]);

  const search = await req('/api/admin/users?q=小苏', { token });
  ok('按昵称检索命中', (search.data.users || []).some((u) => u.nickname === '小苏'));

  const all = await req('/api/admin/users?limit=100', { token });
  victim = (all.data.users || []).find((u) => !u.isPlatformAdmin && !u.banned) || null;

  if (victim) {
    const detail = await req(`/api/admin/users/${victim.id}`, { token });
    ok('用户详情返回 200', detail.status === 200, `HTTP ${detail.status}`);
    ok('详情含 stats / logins / groups', detail.data.stats && Array.isArray(detail.data.logins) && Array.isArray(detail.data.groups));

    const ban = await req(`/api/admin/users/${victim.id}/ban`, {
      method: 'POST', token, body: { reason: '冒烟测试自动封禁' },
    });
    ok('封禁用户成功', ban.status === 200, `HTTP ${ban.status}`);

    const after = await req(`/api/admin/users/${victim.id}`, { token });
    ok('封禁状态已落库', after.data.user?.banned === true);
    ok('封禁原因已记录', after.data.user?.banReason === '冒烟测试自动封禁');

    // 被封禁用户无法登录
    const blocked = await req('/api/login', {
      method: 'POST', body: { nickname: victim.nickname, password: 'anything' },
    });
    ok('被封禁账号登录被拒', blocked.status === 403 || blocked.status === 400, `HTTP ${blocked.status}`);

    const unban = await req(`/api/admin/users/${victim.id}/unban`, { method: 'POST', token });
    ok('解除封禁成功', unban.status === 200, `HTTP ${unban.status}`);
    const restored = await req(`/api/admin/users/${victim.id}`, { token });
    ok('封禁状态已清除', restored.data.user?.banned === false);
  } else {
    console.log('  - 无可用于封禁测试的用户，跳过');
  }

  const notFound = await req('/api/admin/users/99999999', { token });
  ok('不存在的用户返回 404', notFound.status === 404, `HTTP ${notFound.status}`);
}

// ---------- 6. 举报管理 ----------
console.log('\n[6] 举报管理');
{
  const list = await req('/api/admin/reports?limit=5', { token });
  ok('举报列表返回 200', list.status === 200, `HTTP ${list.status}`);
  ok('返回状态统计', list.data.stats && typeof list.data.stats === 'object');
  ok('分类已本地化', !list.data.reports?.length || Boolean(list.data.reports[0].categoryLabel));

  const first = list.data.reports?.[0];
  if (first) {
    const detail = await req(`/api/admin/reports/${first.id}`, { token });
    ok('举报详情返回 200', detail.status === 200, `HTTP ${detail.status}`);
    ok('详情含被举报对象上下文', 'target' in detail.data);

    const handle = await req(`/api/admin/reports/${first.id}`, {
      method: 'POST', token, body: { status: 'processing', handlerNote: '冒烟测试' },
    });
    ok('处置举报成功', handle.status === 200, `HTTP ${handle.status}`);
    ok('处置后状态为 processing', handle.data.report?.status === 'processing');
    ok('处置留痕 handledAt', Boolean(handle.data.report?.handledAt));

    const restore = await req(`/api/admin/reports/${first.id}`, {
      method: 'POST', token, body: { status: first.status, handlerNote: first.handlerNote || '' },
    });
    ok('还原举报状态成功', restore.status === 200);

    const bulk = await req('/api/admin/reports/bulk', {
      method: 'POST', token, body: { ids: [first.id], status: 'pending', handlerNote: '批量冒烟' },
    });
    ok('批量处置成功', bulk.status === 200 && bulk.data.count === 1, `HTTP ${bulk.status}`);
  } else {
    console.log('  - 无举报数据，跳过处置用例');
  }

  const emptyBulk = await req('/api/admin/reports/bulk', { method: 'POST', token, body: { ids: [] } });
  ok('空批量被拒绝', emptyBulk.status === 400, `HTTP ${emptyBulk.status}`);
}

// ---------- 7. 反馈管理 ----------
console.log('\n[7] 反馈管理');
{
  const list = await req('/api/admin/feedback?limit=5', { token });
  ok('反馈列表返回 200', list.status === 200, `HTTP ${list.status}`);
  ok('返回按状态/分类统计', list.data.stats?.byStatus && list.data.stats?.byCategory);

  const first = list.data.feedbacks?.[0];
  if (first) {
    const reply = await req(`/api/admin/feedback/${first.id}/reply`, {
      method: 'POST', token, body: { reply: '冒烟测试回复内容' },
    });
    ok('回复反馈成功', reply.status === 200, `HTTP ${reply.status}`);

    const after = await req('/api/admin/feedback?limit=100', { token });
    const updated = (after.data.feedbacks || []).find((f) => f.id === first.id);
    ok('回复已落库', updated?.reply === '冒烟测试回复内容');
    ok('回复后状态为 replied', updated?.status === 'replied');

    const close = await req(`/api/admin/feedback/${first.id}/close`, { method: 'POST', token });
    ok('关闭反馈成功', close.status === 200);

    const reopen = await req(`/api/admin/feedback/${first.id}/reopen`, { method: 'POST', token });
    ok('重开反馈成功', reopen.status === 200);

    const emptyReply = await req(`/api/admin/feedback/${first.id}/reply`, {
      method: 'POST', token, body: { reply: '   ' },
    });
    ok('空回复被拒绝', emptyReply.status === 400, `HTTP ${emptyReply.status}`);
  } else {
    console.log('  - 无反馈数据，跳过处置用例');
  }
}

// ---------- 8. 错误监控 ----------
console.log('\n[8] 错误监控');
{
  // 先造一条错误（走用户端接口需要用户 token）
  const userLogin = await req('/api/login', {
    method: 'POST', body: { nickname: '小苏', password: '1234' },
  });
  if (userLogin.status === 200 && userLogin.data.token) {
    await req('/api/client-error', {
      method: 'POST',
      token: userLogin.data.token,
      body: { feature: 'smoke-admin', message: '冒烟测试错误', stack: 'at smoke()' },
    });
  }

  const list = await req('/api/admin/errors?feature=smoke-admin', { token });
  ok('错误列表返回 200', list.status === 200, `HTTP ${list.status}`);
  ok('按模块筛选命中测试错误', (list.data.errors || []).length > 0, `命中 ${list.data.errors?.length}`);

  const stats = await req('/api/admin/errors/stats?days=7', { token });
  ok('错误统计返回 200', stats.status === 200, `HTTP ${stats.status}`);
  ok('统计含趋势与模块分布', Array.isArray(stats.data.trend) && Array.isArray(stats.data.byFeature));
  ok('统计含高频信息聚合', Array.isArray(stats.data.topMessages));

  const target = (list.data.errors || [])[0];
  if (target) {
    const del = await req(`/api/admin/errors/${target.id}`, { method: 'DELETE', token });
    ok('删除单条错误成功', del.status === 200, `HTTP ${del.status}`);
  }

  const badPurge = await req('/api/admin/errors/purge', { method: 'POST', token, body: {} });
  ok('无范围清理被拒绝（防误删）', badPurge.status === 400, `HTTP ${badPurge.status}`);

  const purge = await req('/api/admin/errors/purge', {
    method: 'POST', token, body: { feature: 'smoke-admin' },
  });
  ok('按模块清理成功', purge.status === 200, `HTTP ${purge.status}`);
  ok('清理后该模块无记录', (await req('/api/admin/errors?feature=smoke-admin', { token })).data.total === 0);
}

// ---------- 9. 功能开关 ----------
console.log('\n[9] 功能开关');
{
  const r = await req('/api/admin/flags', { token });
  ok('读取开关返回 200', r.status === 200, `HTTP ${r.status}`);
  ok('含默认值与中文元数据', r.data.defaults && r.data.meta?.adminPanel?.group);
  ok('adminPanel 开关存在', 'adminPanel' in (r.data.flags || {}));

  const before = r.data.flags.adminPanel;
  const toggle = await req('/api/admin/flags', {
    method: 'POST', token, body: { flags: { adminPanel: !before } },
  });
  ok('切换开关成功', toggle.status === 200, `HTTP ${toggle.status}`);
  ok('开关值已变化', toggle.data.flags.adminPanel === !before);

  const restore = await req('/api/admin/flags', {
    method: 'POST', token, body: { flags: { adminPanel: before } },
  });
  ok('开关已还原', restore.data.flags.adminPanel === before);

  // 未知开关应被忽略，不应报错
  const unknown = await req('/api/admin/flags', {
    method: 'POST', token, body: { flags: { notARealFlag: true } },
  });
  ok('未知开关被安全忽略', unknown.status === 200 && !('notARealFlag' in unknown.data.flags));
}

// ---------- 10. 内容治理 ----------
console.log('\n[10] 内容治理');
{
  const msgs = await req('/api/admin/content/messages?limit=5', { token });
  ok('消息列表返回 200', msgs.status === 200, `HTTP ${msgs.status}`);
  ok('返回分页总数', typeof msgs.data.total === 'number');

  const moments = await req('/api/admin/content/moments?limit=5', { token });
  ok('动态列表返回 200', moments.status === 200, `HTTP ${moments.status}`);

  const groups = await req('/api/admin/content/groups?limit=5', { token });
  ok('群组列表返回 200', groups.status === 200, `HTTP ${groups.status}`);
  ok('群组含成员/消息计数', groups.data.groups?.[0] && 'memberCount' in groups.data.groups[0]);

  // 危险操作必须二次确认
  const target = groups.data.groups?.[0];
  if (target) {
    const noConfirm = await req(`/api/admin/content/groups/${target.id}`, {
      method: 'DELETE', token, body: { confirm: 'wrong-name' },
    });
    ok('删除群组需群名确认', noConfirm.status === 400, `HTTP ${noConfirm.status}`);
  }

  const msgTarget = msgs.data.messages?.[0];
  if (msgTarget) {
    const noConfirm = await req(`/api/admin/content/messages/99999999`, { method: 'DELETE', token });
    ok('删除不存在的消息返回 404', noConfirm.status === 404, `HTTP ${noConfirm.status}`);
  }
}

// ---------- 11. 系统设置 ----------
console.log('\n[11] 系统设置');
{
  const r = await req('/api/admin/settings', { token });
  ok('读取设置返回 200', r.status === 200, `HTTP ${r.status}`);
  ok('含站点名称默认值', r.data.settings?.['site.name'] !== undefined);
  ok('含中文元数据', r.data.meta?.['site.maintenance']?.label);

  const before = r.data.settings['site.notice'];
  const save = await req('/api/admin/settings', {
    method: 'POST', token, body: { settings: { 'site.notice': '冒烟测试公告' } },
  });
  ok('保存设置成功', save.status === 200, `HTTP ${save.status}`);
  ok('设置已生效', save.data.settings['site.notice'] === '冒烟测试公告');

  const restore = await req('/api/admin/settings', {
    method: 'POST', token, body: { settings: { 'site.notice': before } },
  });
  ok('设置已还原', restore.data.settings['site.notice'] === before);

  const unknown = await req('/api/admin/settings', {
    method: 'POST', token, body: { settings: { 'evil.key': 'x' } },
  });
  ok('未知设置键被忽略', unknown.status === 200 && !('evil.key' in unknown.data.settings));
}

// ---------- 12. 审计日志 ----------
console.log('\n[12] 审计日志');
{
  const r = await req('/api/admin/audit?limit=10', { token });
  ok('审计列表返回 200', r.status === 200, `HTTP ${r.status}`);
  ok('返回总数', typeof r.data.total === 'number', `total=${r.data.total}`);
  ok('包含本次操作留痕', (r.data.logs || []).some((l) => l.module === 'users' || l.module === 'flags' || l.module === 'settings'));

  const modules = await req('/api/admin/audit/modules', { token });
  ok('模块聚合返回 200', modules.status === 200 && Array.isArray(modules.data.modules));

  const filtered = await req('/api/admin/audit?module=auth&limit=5', { token });
  ok('按模块筛选生效', (filtered.data.logs || []).every((l) => l.module === 'auth'));
}

// ---------- 13. 管理员账号 ----------
console.log('\n[13] 管理员账号管理');
{
  const r = await req('/api/admin/admins', { token });
  ok('管理员列表返回 200', r.status === 200, `HTTP ${r.status}`);
  ok('含角色与权限元数据', Array.isArray(r.data.roles) && Array.isArray(r.data.permissions));
  ok('当前账号在列表中', (r.data.admins || []).some((a) => a.username === BOOTSTRAP));

  const uname = `smoke_${Date.now().toString(36)}`;
  const created = await req('/api/admin/admins', {
    method: 'POST', token,
    body: { username: uname, password: 'Smoke12345', displayName: '冒烟测试员', role: 'viewer' },
  });
  ok('创建管理员成功', created.status === 200, `HTTP ${created.status} ${created.data.error || ''}`);
  const newId = created.data.admin?.id;

  if (newId) {
    ok('新账号权限为只读集合', (created.data.admin.permissions || []).includes('users.view')
      && !(created.data.admin.permissions || []).includes('users.manage'));

    // 弱密码应被拒绝
    const weak = await req('/api/admin/admins', {
      method: 'POST', token,
      body: { username: `weak_${Date.now().toString(36)}`, password: 'abc', role: 'viewer' },
    });
    ok('弱密码被拒绝', weak.status === 400, `HTTP ${weak.status}`);

    // 重复用户名应被拒绝
    const dup = await req('/api/admin/admins', {
      method: 'POST', token,
      body: { username: uname, password: 'Smoke12345', role: 'viewer' },
    });
    ok('重复用户名被拒绝', dup.status === 400, `HTTP ${dup.status}`);

    // 只读账号不能写
    const roLogin = await req('/api/admin/auth/login', {
      method: 'POST', body: { username: uname, password: 'Smoke12345' },
    });
    ok('新建账号可登录', roLogin.status === 200 && Boolean(roLogin.data.token));
    if (roLogin.data.token) {
      const write = await req('/api/admin/users/1/ban', {
        method: 'POST', token: roLogin.data.token, body: { reason: 'x' },
      });
      ok('只读账号写操作被拒（403）', write.status === 403, `HTTP ${write.status}`);
      const read = await req('/api/admin/users?limit=1', { token: roLogin.data.token });
      ok('只读账号可读', read.status === 200, `HTTP ${read.status}`);
      const noSettings = await req('/api/admin/settings', { token: roLogin.data.token });
      ok('只读账号无系统设置权限', noSettings.status === 403, `HTTP ${noSettings.status}`);
    }

    const upd = await req(`/api/admin/admins/${newId}`, {
      method: 'PATCH', token, body: { status: 'disabled' },
    });
    ok('停用管理员成功', upd.status === 200 && upd.data.admin.status === 'disabled');

    if (roLogin.data.token) {
      const afterDisable = await req('/api/admin/users?limit=1', { token: roLogin.data.token });
      ok('停用后会话立即失效', afterDisable.status === 401, `HTTP ${afterDisable.status}`);
    }

    const del = await req(`/api/admin/admins/${newId}`, { method: 'DELETE', token });
    ok('删除管理员成功', del.status === 200, `HTTP ${del.status}`);
  }

  // 不能删除自己
  const me = await req('/api/admin/auth/me', { token });
  const selfDel = await req(`/api/admin/admins/${me.data.admin.id}`, { method: 'DELETE', token });
  ok('不能删除当前登录账号', selfDel.status === 400, `HTTP ${selfDel.status}`);

  // 不能停用最后一个超管
  const supers = (r.data.admins || []).filter((a) => a.role === 'super' && a.status === 'active');
  if (supers.length === 1) {
    const demote = await req(`/api/admin/admins/${supers[0].id}`, {
      method: 'PATCH', token, body: { role: 'viewer' },
    });
    ok('不能降级最后一个超管', demote.status === 400, `HTTP ${demote.status}`);
  } else {
    console.log(`  - 超管数量为 ${supers.length}，跳过最后一个超管保护用例`);
  }
}

// ---------- 14. 退出 ----------
console.log('\n[14] 退出登录');
{
  const out = await req('/api/admin/auth/logout', { method: 'POST', token });
  ok('退出成功', out.status === 200, `HTTP ${out.status}`);
  const after = await req('/api/admin/dashboard', { token });
  ok('退出后 token 失效', after.status === 401, `HTTP ${after.status}`);
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
