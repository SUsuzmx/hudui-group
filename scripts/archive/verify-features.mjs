// 验证新增 API: 好友/朋友圈/资料/生图
const BASE = 'http://127.0.0.1:3000';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};

async function req(path, { method = 'POST', body, token, query } = {}) {
  let url = BASE + path;
  if (query) {
    const qs = new URLSearchParams(query).toString();
    if (qs) url += '?' + qs;
  }
  const res = await fetch(url, {
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

const nick = '验证员' + Math.floor(Math.random() * 10000);
const reg = await req('/api/register', { body: { nickname: nick, password: 'test1234', avatar: null } });
check('注册', reg.status === 200 && reg.data.token, JSON.stringify(reg.data.user ?? reg.data).slice(0, 120));
const token = reg.data.token;
const meId = reg.data.user?.id;

// 更新资料
const upd = await req('/api/me', {
  method: 'PUT',
  token,
  body: { nickname: nick, signature: '这是签名', region: '广东 深圳', wxid: 'wx' + meId + 'abc' },
});
check('更新资料', upd.status === 200 && upd.data.user?.signature === '这是签名', JSON.stringify(upd.data.user ?? upd.data).slice(0, 160));

// 列用户搜好友
const users = await req('/api/friends/search', { method: 'GET', token, query: { q: 'a' } });
check('搜索用户', users.status === 200, `n=${users.data.users?.length ?? 0}`);

// 若搜不到就直接用 me 之外的已有用户
let friendId = users.data.users?.[0]?.id;
if (!friendId) {
  const all = await req('/api/friends/search', { method: 'GET', token, query: { q: 'e' } });
  friendId = all.data.users?.[0]?.id;
}
if (!friendId && meId) {
  // 注册第二个用户
  const nick2 = '验证员B' + Math.floor(Math.random() * 10000);
  const reg2 = await req('/api/register', { body: { nickname: nick2, password: 'test1234' } });
  friendId = reg2.data.user?.id;
}
check('拿到好友候选', Boolean(friendId), String(friendId));

if (friendId) {
  const add = await req('/api/friends', { token, body: { friendId } });
  check('添加好友', add.status === 200, JSON.stringify(add.data).slice(0, 120));

  const list = await req('/api/friends', { method: 'GET', token });
  check('好友列表', list.status === 200 && list.data.friends?.some((f) => f.id === friendId), `n=${list.data.friends?.length}`);

  const del = await req(`/api/friends/${friendId}`, { method: 'DELETE', token });
  check('删除好友', del.status === 200, JSON.stringify(del.data));

  const list2 = await req('/api/friends', { method: 'GET', token });
  check('删除后列表', !list2.data.friends?.some((f) => f.id === friendId));
}

// 朋友圈
const m1 = await req('/api/moments', { token, body: { content: '第一条朋友圈 ' + Date.now(), images: [] } });
check('发布朋友圈', m1.status === 200 && m1.data.moment?.id, JSON.stringify(m1.data.moment ?? m1.data).slice(0, 140));

const mList = await req('/api/moments', { method: 'GET', token });
check('朋友圈列表', mList.status === 200 && mList.data.moments?.length > 0, `n=${mList.data.moments?.length}`);

const mine = await req('/api/moments/mine', { method: 'GET', token });
check('我的朋友圈', mine.status === 200 && mine.data.moments?.length >= 1, `n=${mine.data.moments?.length}`);

if (m1.data.moment?.id) {
  const md = await req(`/api/moments/${m1.data.moment.id}`, { method: 'DELETE', token });
  check('删除朋友圈', md.status === 200, JSON.stringify(md.data));
}

// 头像列表
const av = await req('/api/avatars', { method: 'GET' });
check('头像列表', av.status === 200 && Array.isArray(av.data.avatars), `n=${av.data.avatars?.length}`);

// 生图
console.log('\n--- 生图测试 ---');
const t0 = Date.now();
const { genImage } = await import('../server/ai/media.js');
const imgUrl = await genImage('一只戴墨镜的橘猫坐在便利店门口喝冰可乐');
const dt = ((Date.now() - t0) / 1000).toFixed(1);
check('生图', Boolean(imgUrl), `${dt}s url=${imgUrl}`);
if (imgUrl) {
  const r = await fetch(BASE + imgUrl);
  const buf = Buffer.from(await r.arrayBuffer());
  check('图片可访问', r.ok && buf.length > 10000, `${r.status} ${buf.length} bytes`);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n=== ${results.length - failed.length}/${results.length} passed ===`);
if (failed.length) {
  console.log('Failed:', failed.map((f) => f.name).join(', '));
  process.exit(1);
}
process.exit(0);
