/**
 * 功能逐项验收：找回密码 / 设备记录 / 账号注销 / 群权限 / 朋友圈可见 / 备份恢复 / 反馈闭环
 * 用法: BASE=http://127.0.0.1:3010 node scripts/accept-features.mjs
 * 注意: 注册接口有频率限制，本脚本尽量复用少量账号。
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

function rand(prefix) {
  return prefix + Math.random().toString(36).slice(2, 7);
}

const accountCache = new Map();

/** 注册；若撞限流则尝试登录已有缓存 */
async function ensureAccount(key, nick, password) {
  if (accountCache.has(key)) return accountCache.get(key);
  let r = await req('/api/register', {
    method: 'POST',
    body: { nickname: nick, password },
  });
  if (r.status === 429) {
    // 尝试用固定后缀账号登录
    const alt = await req('/api/login', {
      method: 'POST',
      body: { nickname: nick, password },
    });
    if (alt.status === 200) r = alt;
  }
  if (r.status !== 200 || !r.data.token) {
    throw new Error(`无法创建账号 ${nick}: ${JSON.stringify(r.data)}`);
  }
  const acc = {
    token: r.data.token,
    id: r.data.user.id,
    nickname: r.data.user.nickname,
    password,
  };
  accountCache.set(key, acc);
  return acc;
}

async function addFriend(from, to) {
  // 互加，保证 areFriends 任一方向即可
  await req('/api/friends', {
    method: 'POST',
    token: from.token,
    body: { friendId: to.id },
  });
  await req('/api/friends', {
    method: 'POST',
    token: to.token,
    body: { friendId: from.id },
  });
}

// ---------- 1. 找回密码 ----------
async function testForgotPassword() {
  section('1. 找回密码完整流程');
  const nick = rand('找回');
  const oldPwd = 'oldpass99';
  const reg = await req('/api/register', {
    method: 'POST',
    body: { nickname: nick, password: oldPwd },
  });
  ok(reg.status === 200 && reg.data.token, '注册测试账号', JSON.stringify(reg.data));
  if (reg.status !== 200) return;
  const token = reg.data.token;

  const codeRes = await req('/api/auth/recovery-code', {
    method: 'POST',
    token,
    body: {},
  });
  ok(codeRes.status === 200 && codeRes.data.recoveryCode, '生成找回码');

  const forgot = await req('/api/auth/forgot-password', {
    method: 'POST',
    body: { nickname: nick },
  });
  ok(forgot.status === 200 && forgot.data.ok, '忘记密码接口可用');

  const newPwd = 'newpass88';
  const reset = await req('/api/auth/reset-password', {
    method: 'POST',
    body: { nickname: nick, code: codeRes.data.recoveryCode, newPassword: newPwd },
  });
  ok(reset.status === 200, '用找回码重置密码');

  const oldLogin = await req('/api/login', {
    method: 'POST',
    body: { nickname: nick, password: oldPwd },
  });
  ok(oldLogin.status === 400, '旧密码已失效', `status=${oldLogin.status}`);

  const newLogin = await req('/api/login', {
    method: 'POST',
    body: { nickname: nick, password: newPwd },
  });
  ok(newLogin.status === 200 && newLogin.data.token, '新密码可登录');

  const reuse = await req('/api/auth/reset-password', {
    method: 'POST',
    body: { nickname: nick, code: codeRes.data.recoveryCode, newPassword: 'xxx66666' },
  });
  ok(reuse.status === 400, '找回码不可重复使用');
}

// ---------- 2. 登录设备管理 ----------
async function testLoginDevices() {
  section('2. 登录设备记录与异地提醒');
  const nick = rand('设备');
  const pwd = 'device99';
  const r1 = await req('/api/register', {
    method: 'POST',
    body: { nickname: nick, password: pwd },
  });
  if (r1.status !== 200) {
    ok(false, '注册设备测试账号', JSON.stringify(r1.data));
    return;
  }
  const t1 = r1.data.token;

  const hist1 = await req('/api/auth/login-history', { token: t1 });
  ok(hist1.status === 200 && hist1.data.items.length >= 1, '登录记录已写入');

  await new Promise((r) => setTimeout(r, 30));
  const r2 = await req('/api/login', {
    method: 'POST',
    body: { nickname: nick, password: pwd },
  });
  ok(r2.status === 200, '第二设备登录成功');
  const t2 = r2.data.token;

  const hist2 = await req('/api/auth/login-history', { token: t2 });
  ok(hist2.data.items.length >= 2, '两台设备均有记录', `count=${hist2.data.items.length}`);
  ok(
    hist2.data.items.every((x) => typeof x.anomaly === 'boolean'),
    '含异常标记字段'
  );

  const me1 = await req('/api/me', { token: t1 });
  ok(me1.status === 401, '旧设备 token 被挤下线', `status=${me1.status}`);

  const kick = await req('/api/auth/kick-others', {
    method: 'POST',
    token: t2,
    body: {},
  });
  ok(kick.status === 200, '可下线其它设备');
}

// ---------- 3. 账号注销 ----------
async function testAccountDeletion() {
  section('3. 账号注销');
  const nick = rand('注销');
  const pwd = 'delete99';
  const reg = await req('/api/register', {
    method: 'POST',
    body: { nickname: nick, password: pwd },
  });
  if (reg.status !== 200) {
    ok(false, '注册注销测试账号', JSON.stringify(reg.data));
    return;
  }
  const token = reg.data.token;
  const uid = reg.data.user.id;

  const otherNick = rand('注销友');
  const other = await req('/api/register', {
    method: 'POST',
    body: { nickname: otherNick, password: 'other99' },
  });
  if (other.status === 200) {
    await req('/api/friends', {
      method: 'POST',
      token,
      body: { friendId: other.data.user.id },
    });
  }

  const del = await req('/api/account/delete', {
    method: 'POST',
    token,
    body: { reason: '验收测试' },
  });
  ok(del.status === 200 && del.data.ok, '注销接口成功');

  const relogin = await req('/api/login', {
    method: 'POST',
    body: { nickname: nick, password: pwd },
  });
  ok(relogin.status === 400, '注销后无法登录', `status=${relogin.status}`);

  const me = await req('/api/me', { token });
  ok(me.status === 401, '原 token 失效');

  if (other.status === 200) {
    const friends = await req('/api/friends', { token: other.data.token });
    const stillFriend = (friends.data.friends || []).some((f) => f.id === uid);
    ok(!stillFriend, '好友关系已解除');
  }
}

// ---------- 4. 群管理员权限 ----------
async function testGroupAdmin() {
  section('4. 群管理员权限交叉');
  const owner = await ensureAccount('gowner', rand('群主'), 'owner99');
  const member = await ensureAccount('gmember', rand('群员'), 'member99');
  const outsider = await ensureAccount('gout', rand('非群'), 'out9999');

  const g = await req('/api/groups', {
    method: 'POST',
    token: owner.token,
    body: {
      name: '验收群' + Date.now().toString(36),
      memberIds: [member.id],
      aiMembers: ['思琪', 'Perry'],
    },
  });
  ok(g.status === 200 && g.data.group?.id, '创建群聊', JSON.stringify(g.data));
  if (!g.data.group?.id) return;
  const gid = g.data.group.id;

  const renameOwner = await req(`/api/groups/${gid}/rename`, {
    method: 'POST',
    token: owner.token,
    body: { name: '群主改名' },
  });
  ok(renameOwner.status === 200, '群主可改群名');

  const renameMember = await req(`/api/groups/${gid}/rename`, {
    method: 'POST',
    token: member.token,
    body: { name: '成员乱改' },
  });
  ok(renameMember.status === 403, '普通成员改群名被拒', `status=${renameMember.status}`);

  const kickMember = await req(`/api/groups/${gid}/members/remove`, {
    method: 'POST',
    token: member.token,
    body: { key: 'u' + owner.id },
  });
  ok(kickMember.status === 403, '普通成员踢人被拒', `status=${kickMember.status}`);

  const renameOut = await req(`/api/groups/${gid}/rename`, {
    method: 'POST',
    token: outsider.token,
    body: { name: '外人乱改' },
  });
  ok(renameOut.status === 403, '非成员改群名被拒');

  const setRole = await req(`/api/groups/${gid}/members/role`, {
    method: 'POST',
    token: owner.token,
    body: { userId: member.id, role: 'admin' },
  });
  ok(setRole.status === 200 && setRole.data.role === 'admin', '群主设置管理员');

  const renameAdmin = await req(`/api/groups/${gid}/rename`, {
    method: 'POST',
    token: member.token,
    body: { name: '管理员改名' },
  });
  ok(renameAdmin.status === 200, '管理员可改群名');

  const promoteOut = await req(`/api/groups/${gid}/members/role`, {
    method: 'POST',
    token: outsider.token,
    body: { userId: outsider.id, role: 'admin' },
  });
  ok(promoteOut.status === 403, '非群主不能设置管理员');

  const approval = await req(`/api/groups/${gid}/join-approval`, {
    method: 'POST',
    token: owner.token,
    body: { requireApproval: true },
  });
  ok(approval.status === 200 && approval.data.requireApproval, '开启入群验证');

  const joinReq = await req(`/api/groups/${gid}/join`, {
    method: 'POST',
    token: outsider.token,
    body: { reason: '想进群' },
  });
  ok(joinReq.status === 200 && joinReq.data.pending, '入群需审批');

  const readsAsMember = await req(`/api/groups/${gid}/announcement/reads`, {
    token: member.token,
  });
  ok(readsAsMember.status === 200, '管理员可看公告已读');

  const markRead = await req(`/api/groups/${gid}/announcement/read`, {
    method: 'POST',
    token: member.token,
    body: {},
  });
  ok(markRead.status === 200, '可标记公告已读');

  const album = await req(`/api/groups/${gid}/album`, { token: member.token });
  ok(album.status === 200, '群成员可看群相册');

  const albumOut = await req(`/api/groups/${gid}/album`, { token: outsider.token });
  ok(albumOut.status === 403, '非成员不可看群相册');
}

// ---------- 5. 朋友圈可见范围 ----------
async function testMomentsVisibility() {
  section('5. 朋友圈可见范围真实生效');
  const author = await ensureAccount('mauthor', rand('作者'), 'author99');
  const friendA = await ensureAccount('mfA', rand('好友A'), 'friend99');
  const friendB = await ensureAccount('mfB', rand('好友B'), 'friend99');
  const stranger = await ensureAccount('mstr', rand('路人'), 'str9999');

  await addFriend(author, friendA);
  await addFriend(author, friendB);

  await req('/api/settings', {
    method: 'PUT',
    token: author.token,
    body: {
      settings: {
        momentsPublic: false,
        strangerSee10: false,
        momentsHideFrom: [friendB.id],
        momentsHideThem: [],
      },
    },
  });

  const post = await req('/api/moments', {
    method: 'POST',
    token: author.token,
    body: {
      content: '仅特定好友可见的验收动态',
      visibility: 'except',
      visibleTo: [friendB.id],
    },
  });
  ok(post.status === 200 && post.data.moment?.id, '发布「不给谁看」动态', JSON.stringify(post.data));
  const momentId = post.data.moment?.id;
  if (!momentId) return;

  const feedB = await req('/api/moments', { token: friendB.token });
  ok(!(feedB.data.moments || []).some((m) => m.id === momentId), '被排除好友看不到该动态');

  const feedA = await req('/api/moments', { token: friendA.token });
  ok((feedA.data.moments || []).some((m) => m.id === momentId), '未被排除好友能看到该动态');

  const feedS = await req('/api/moments', { token: stranger.token });
  ok(!(feedS.data.moments || []).some((m) => m.id === momentId), '陌生人看不到（已关陌生人可见）');

  const partial = await req('/api/moments', {
    method: 'POST',
    token: author.token,
    body: {
      content: '部分可见验收',
      visibility: 'partial',
      visibleTo: [friendA.id],
    },
  });
  const pId = partial.data.moment?.id;
  const feedB2 = await req('/api/moments', { token: friendB.token });
  ok(!(feedB2.data.moments || []).some((m) => m.id === pId), '部分可见：未选中好友看不到');
  const feedA2 = await req('/api/moments', { token: friendA.token });
  ok((feedA2.data.moments || []).some((m) => m.id === pId), '部分可见：选中好友能看到');

  await req(`/api/moments/${momentId}/visit`, {
    method: 'POST',
    token: friendA.token,
    body: {},
  });
  const visitors = await req(`/api/moments/${momentId}/visitors`, {
    token: author.token,
  });
  ok(visitors.status === 200, '作者可看访客');
  const asB = await req(`/api/moments/${momentId}/visitors`, {
    token: friendB.token,
  });
  ok(asB.status === 403, '他人不可看访客');
}

// ---------- 6. 备份与恢复 ----------
async function testBackupRestore() {
  section('6. 备份导出与恢复');
  const acc = await ensureAccount('backup', rand('备份'), 'backup99');

  const exp = await req('/api/backup/export?limit=100', { token: acc.token });
  ok(exp.status === 200 && exp.data.payload, '导出聊天记录');
  ok(Array.isArray(exp.data.payload?.messages), '导出包含消息数组');
  const exportJson = JSON.stringify(exp.data.payload || {});
  ok(
    !exportJson.includes('password_hash') && !/"password"\s*:/.test(exportJson),
    '导出不含密码字段'
  );

  const cloud = await req('/api/backup/cloud', {
    method: 'POST',
    token: acc.token,
    body: { limit: 100 },
  });
  ok(cloud.status === 200 && cloud.data.ok, '云端备份成功');

  const list = await req('/api/backup/cloud', { token: acc.token });
  ok(list.status === 200 && list.data.backups.length >= 1, '云端备份列表');

  const bid = list.data.backups[0]?.id;
  const restore = await req(`/api/backup/cloud/${bid}`, { token: acc.token });
  ok(restore.status === 200 && restore.data.payload, '可恢复云端备份');
  ok(Array.isArray(restore.data.payload?.messages), '恢复数据含消息');

  const other = await ensureAccount('backup2', rand('备份偷'), 'other99');
  const steal = await req(`/api/backup/cloud/${bid}`, { token: other.token });
  ok(steal.status === 404, '他人无法读取我的备份');
}

// ---------- 7. 反馈闭环 ----------
async function testFeedbackLoop() {
  section('7. 反馈提交 → 后台可见 → 可处理');
  const adminLogin = await req('/api/login', {
    method: 'POST',
    body: { nickname: '小苏', password: '1234' },
  });
  ok(adminLogin.status === 200 && adminLogin.data.user?.isAdmin, '管理员登录');
  const at = adminLogin.data.token;

  const user = await ensureAccount('fbuser', rand('反馈人'), 'feed99');
  const fb = await req('/api/feedback', {
    method: 'POST',
    token: user.token,
    body: { category: 'bug', content: '验收：设置页某个按钮点了没反应' },
  });
  ok(fb.status === 200 && fb.data.id, '用户提交反馈', JSON.stringify(fb.data));
  const fbId = fb.data.id;

  const mine = await req('/api/feedback/mine', { token: user.token });
  ok((mine.data.feedbacks || []).some((x) => x.id === fbId), '用户能看到自己的反馈');

  const adminList = await req('/api/admin/feedback', { token: at });
  ok((adminList.data.feedbacks || []).some((x) => x.id === fbId), '管理员后台能看到该反馈');

  const reply = await req(`/api/admin/feedback/${fbId}/reply`, {
    method: 'POST',
    token: at,
    body: { reply: '已确认并修复，感谢反馈' },
  });
  ok(reply.status === 200, '管理员可回复');

  const mine2 = await req('/api/feedback/mine', { token: user.token });
  const item = (mine2.data.feedbacks || []).find((x) => x.id === fbId);
  ok(item?.reply?.includes('已确认') && item?.status === 'replied', '用户能看到处理结果');

  const rep = await req('/api/reports', {
    method: 'POST',
    token: user.token,
    body: { targetType: 'user', targetId: '999', category: 'spam', detail: '验收举报' },
  });
  ok(rep.status === 200, '提交举报');
  const repId = rep.data.id;

  const handle = await req(`/api/admin/reports/${repId}`, {
    method: 'POST',
    token: at,
    body: { status: 'done', handlerNote: '已处理' },
  });
  ok(handle.status === 200 && handle.data.report?.status === 'done', '管理员处理举报');

  const myRep = await req('/api/reports/mine', { token: user.token });
  const rItem = (myRep.data.reports || []).find((x) => x.id === repId);
  ok(rItem?.status === 'done', '举报人能看到处理结果');

  const denied = await req('/api/admin/overview', { token: user.token });
  ok(denied.status === 403 || denied.status === 401, '普通用户无后台权限');
}

// ---------- 8. 敏感内容 ----------
async function testContentFilter() {
  section('8. 敏感内容过滤');
  const u = await ensureAccount('filter', rand('内容'), 'filter99');
  const bad = await req('/api/moments', {
    method: 'POST',
    token: u.token,
    body: { content: '这里有赌博广告欢迎联系', visibility: 'public' },
  });
  ok(bad.status === 400, '朋友圈敏感词被拦截', `status=${bad.status} ${JSON.stringify(bad.data)}`);

  const good = await req('/api/moments', {
    method: 'POST',
    token: u.token,
    body: { content: '今天天气不错', visibility: 'public' },
  });
  ok(good.status === 200, '正常内容可发布', JSON.stringify(good.data));
}

async function main() {
  console.log('BASE =', BASE);
  await testForgotPassword();
  await testLoginDevices();
  await testAccountDeletion();
  await testGroupAdmin();
  await testMomentsVisibility();
  await testBackupRestore();
  await testFeedbackLoop();
  await testContentFilter();

  console.log('\n======== 结果 ========');
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
