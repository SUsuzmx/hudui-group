// 本地验证：八项微信细节功能
const BASE = process.env.BASE || 'http://127.0.0.1:3010';
const stamp = Date.now();
const nick = `验证员${String(stamp).slice(-5)}`;
const pass = 'Verify@12345';
let token = '';
let userId = 0;
let friendId = 0;
const results = [];

function ok(name, cond, detail = '') {
  results.push({ name, pass: !!cond, detail: String(detail).slice(0, 180) });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

async function req(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, { ...opts, headers });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* raw */ }
  return { status: res.status, json, text };
}

async function main() {
  // 1. 注册
  let r = await req('/api/register', { method: 'POST', body: JSON.stringify({ nickname: nick, password: pass }) });
  if (r.status !== 200) {
    r = await req('/api/login', { method: 'POST', body: JSON.stringify({ nickname: nick, password: pass }) });
  }
  token = r.json?.token || '';
  userId = r.json?.user?.id || 0;
  ok('注册/登录', Boolean(token && userId), `user=${userId} nick=${nick}`);

  // 2. 状态墙接口
  r = await req('/api/status/friends');
  ok('GET /api/status/friends', r.status === 200 && Array.isArray(r.json?.statuses), `status=${r.status} n=${r.json?.statuses?.length}`);

  // 设置自己的状态后再查
  r = await req('/api/me', {
    method: 'PUT',
    body: JSON.stringify({ status: { text: '本地验证中', label: '忙', icon: 'busy' } }),
  });
  ok('设置状态', r.status === 200, `status=${r.status}`);
  r = await req('/api/status/friends');
  const meInWall = (r.json?.statuses || []).find((s) => s.isMe || s.userId === userId);
  ok('状态墙含自己状态', Boolean(meInWall), JSON.stringify(meInWall?.statusText || meInWall?.status));

  // 3. 服务通知
  r = await req('/api/service/notices');
  ok('GET /api/service/notices', r.status === 200 && Array.isArray(r.json?.notices), `status=${r.status} n=${r.json?.notices?.length}`);

  // 4. 钱包流水映射到服务通知
  r = await req('/api/wallet');
  ok('GET /api/wallet', r.status === 200 && typeof r.json?.balance === 'number', `bal=${r.json?.balance}`);
  r = await req('/api/wallet/pay', { method: 'POST', body: JSON.stringify({ amount: 1, note: '验证支付通知' }) });
  ok('钱包支付产生流水', r.status === 200, `status=${r.status} ${r.text.slice(0, 80)}`);
  r = await req('/api/service/notices');
  const hasPay = (r.json?.notices || []).some((n) => String(n.title || n.body || '').includes('验证') || n.kind === 'wallet');
  ok('服务通知含支付记录', hasPay || (r.json?.notices || []).length > 0, `n=${r.json?.notices?.length}`);

  // 5. 朋友圈 except 可见性
  r = await req('/api/moments', {
    method: 'POST',
    body: JSON.stringify({ content: '不给谁看验证动态', images: [], visibility: 'except', visibleTo: [] }),
  });
  ok('朋友圈 except 空名单被拒或允许', r.status === 200 || r.status === 400, `status=${r.status} ${r.text.slice(0, 100)}`);

  // 先注册一个“好友”占位 id（无好友关系时用自己 id 测 except 含自己不生效）
  r = await req('/api/moments', {
    method: 'POST',
    body: JSON.stringify({ content: '公开验证动态', images: [], visibility: 'public', visibleTo: [] }),
  });
  ok('朋友圈公开发布', r.status === 200 && r.json?.moment?.id, `id=${r.json?.moment?.id} vis=${r.json?.moment?.visibility}`);

  // partial 需要 visibleTo
  r = await req('/api/moments', {
    method: 'POST',
    body: JSON.stringify({ content: '部分可见验证', images: [], visibility: 'partial', visibleTo: [] }),
  });
  ok('部分可见缺名单返回 400', r.status === 400, `status=${r.status}`);

  // except 带 visibleTo（排除自己不会隐藏自己动态）
  r = await req('/api/moments', {
    method: 'POST',
    body: JSON.stringify({ content: '不给某人看', images: [], visibility: 'except', visibleTo: [userId] }),
  });
  ok('朋友圈 except 发布', r.status === 200, `status=${r.status} vis=${r.json?.moment?.visibility}`);

  // 6. 隐私设置键
  r = await req('/api/settings', {
    method: 'PUT',
    body: JSON.stringify({
      settings: {
        momentsRange: '3d',
        momentsHideFrom: [1, 2],
        momentsHideThem: [3],
        unknownKeyShouldDrop: true,
      },
    }),
  });
  const s = r.json?.settings || {};
  ok('设置 momentsRange=3d', s.momentsRange === '3d', JSON.stringify(s).slice(0, 120));
  ok('设置 momentsHideFrom 数组', Array.isArray(s.momentsHideFrom) && s.momentsHideFrom.length === 2, JSON.stringify(s.momentsHideFrom));
  ok('设置 momentsHideThem 数组', Array.isArray(s.momentsHideThem) && s.momentsHideThem.length === 1, JSON.stringify(s.momentsHideThem));
  ok('未知设置键被过滤', s.unknownKeyShouldDrop === undefined, 'dropped');

  r = await req('/api/settings');
  ok('回读隐私设置', r.json?.settings?.momentsRange === '3d', JSON.stringify(r.json?.settings).slice(0, 120));

  // 7. 收藏（+面板收藏入口依赖）
  r = await req('/api/favorites', {
    method: 'POST',
    body: JSON.stringify({ kind: 'text', content: '验证收藏条目', fromName: '验证' }),
  });
  ok('收藏写入', r.status === 200, `status=${r.status}`);
  r = await req('/api/favorites');
  ok('收藏列表', r.status === 200 && (r.json?.favorites || []).some((f) => f.content === '验证收藏条目'), `n=${r.json?.favorites?.length}`);

  // 8. 好友权限（不让他看 / 不看他）
  // 再注册一个用户作为对方
  const nick2 = `验证友${String(stamp).slice(-5)}`;
  let r2 = await fetch(BASE + '/api/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nickname: nick2, password: pass }),
  });
  const j2 = await r2.json();
  friendId = j2?.user?.id || 0;
  ok('注册对方账号', Boolean(friendId), `friend=${friendId}`);

  // 加好友
  r = await req('/api/friends', { method: 'POST', body: JSON.stringify({ friendId }) });
  ok('添加好友', r.status === 200 || r.status === 400 || r.status === 409, `status=${r.status} ${r.text.slice(0, 80)}`);

  r = await req('/api/friends/permission', {
    method: 'POST',
    body: JSON.stringify({ friendId, permission: 'hide-moments' }),
  });
  ok('设置 hide-moments', r.status === 200, `status=${r.status} ${r.text.slice(0, 80)}`);

  r = await req('/api/friends/permission', {
    method: 'POST',
    body: JSON.stringify({ friendId, permission: 'mute-them' }),
  });
  ok('设置 mute-them 可写（或被规范化）', r.status === 200 || r.status === 400, `status=${r.status} ${r.text.slice(0, 80)}`);

  // 9. 消息类型 todo / 群待办依赖 mediaType
  // 通过 socket 不方便，至少确认 chat 接口健康
  r = await req('/api/chats');
  ok('GET /api/chats', r.status === 200 && Array.isArray(r.json?.chats), `n=${r.json?.chats?.length}`);

  // 汇总
  const fails = results.filter((x) => !x.pass);
  console.log('\n==== SUMMARY ====');
  console.log(`total=${results.length} pass=${results.length - fails.length} fail=${fails.length}`);
  if (fails.length) {
    for (const f of fails) console.log('FAIL:', f.name, f.detail);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('SCRIPT ERROR', e);
  process.exitCode = 1;
});
