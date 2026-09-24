// 验证朋友圈 except 对被排除用户不可见
const BASE = 'http://127.0.0.1:3010';
const stamp = Date.now();
const pass = 'Verify@12345';
const nickA = `A可见${String(stamp).slice(-5)}`;
const nickB = `B被挡${String(stamp).slice(-5)}`;
const nickC = `C路人${String(stamp).slice(-5)}`;

async function reg(nick) {
  const res = await fetch(BASE + '/api/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nickname: nick, password: pass }),
  });
  const j = await res.json();
  return { token: j.token, id: j.user.id, user: j.user };
}

async function api(token, path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(opts.headers || {}) },
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* */ }
  return { status: res.status, json, text };
}

function ok(name, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  return !!cond;
}

async function main() {
  let allPass = true;
  const A = await reg(nickA);
  const B = await reg(nickB);
  const C = await reg(nickC);

  // A 加 B 为好友，发布 except 排除 B
  await api(A.token, '/api/friends', { method: 'POST', body: JSON.stringify({ friendId: B.id }) });
  await api(A.token, '/api/friends', { method: 'POST', body: JSON.stringify({ friendId: C.id }) });

  const pub = await api(A.token, '/api/moments', {
    method: 'POST',
    body: JSON.stringify({ content: '公开的一条', images: [], visibility: 'public', visibleTo: [] }),
  });
  allPass &= ok('A 发公开', pub.status === 200, pub.text.slice(0, 60));

  const ex = await api(A.token, '/api/moments', {
    method: 'POST',
    body: JSON.stringify({ content: '不给 B 看的秘密', images: [], visibility: 'except', visibleTo: [B.id] }),
  });
  allPass &= ok('A 发 except 排除 B', ex.status === 200 && ex.json?.moment?.visibility === 'except', ex.text.slice(0, 80));

  // B 看 A 的朋友圈主页
  const bView = await api(B.token, `/api/moments/user/${A.id}`);
  const bContents = (bView.json?.moments || []).map((m) => m.content);
  allPass &= ok('B 看不到 except 动态', !bContents.includes('不给 B 看的秘密'), JSON.stringify(bContents));
  allPass &= ok('B 能看到公开动态', bContents.includes('公开的一条'), JSON.stringify(bContents));

  // C 能看到 except 动态（仅排除 B）
  const cView = await api(C.token, `/api/moments/user/${A.id}`);
  const cContents = (cView.json?.moments || []).map((m) => m.content);
  allPass &= ok('C 能看到 except 动态', cContents.includes('不给 B 看的秘密') || cContents.includes('公开的一条'), JSON.stringify(cContents));
  allPass &= ok('C 可见 except 正文', cContents.includes('不给 B 看的秘密'), JSON.stringify(cContents));

  // 自己 mine 全可见
  const mine = await api(A.token, '/api/moments/mine');
  const mContents = (mine.json?.moments || []).map((m) => m.content);
  allPass &= ok('A 自己可见全部', mContents.includes('不给 B 看的秘密') && mContents.includes('公开的一条'), JSON.stringify(mContents));

  // partial 仅选中可见
  const p = await api(A.token, '/api/moments', {
    method: 'POST',
    body: JSON.stringify({ content: '仅 C 可见', images: [], visibility: 'partial', visibleTo: [C.id] }),
  });
  allPass &= ok('A 发 partial 选 C', p.status === 200, p.text.slice(0, 60));
  const b2 = await api(B.token, `/api/moments/user/${A.id}`);
  allPass &= ok('B 看不到 partial', !(b2.json?.moments || []).some((m) => m.content === '仅 C 可见'), '');
  const c2 = await api(C.token, `/api/moments/user/${A.id}`);
  allPass &= ok('C 能看到 partial', (c2.json?.moments || []).some((m) => m.content === '仅 C 可见'), '');

  // 状态墙：B 是 A 的好友后能出现
  const wall = await api(A.token, '/api/status/friends');
  await api(B.token, '/api/me', { method: 'PUT', body: JSON.stringify({ status: { text: 'B 在摸鱼', label: '摸鱼' } }) });
  const wall2 = await api(A.token, '/api/status/friends');
  const hasB = (wall2.json?.statuses || []).find((s) => s.userId === B.id);
  allPass &= ok('状态墙含好友状态', Boolean(hasB), JSON.stringify(hasB?.statusText || wall2.json?.statuses));

  console.log(allPass ? '\nALL PASS' : '\nSOME FAILED');
  if (!allPass) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
