// 验证隐私设置真正生效：hide-moments / 状态可见性 / 附件直链
const BASE = process.env.BASE || 'http://127.0.0.1:3010';
const stamp = Date.now();
const pass = 'Verify@12345';
const nickA = `PA${String(stamp).slice(-5)}`;
const nickB = `PB${String(stamp).slice(-5)}`;
const nickS = `PS${String(stamp).slice(-5)}`;

async function reg(nick) {
  const res = await fetch(BASE + '/api/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nickname: nick, password: pass }),
  });
  const j = await res.json();
  return { token: j.token, id: j.user.id, user: j.user, cookie: res.headers.get('set-cookie') || '' };
}

async function api(token, path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* */ }
  return { status: res.status, json, text, headers: res.headers };
}

function ok(name, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  return !!cond;
}

async function main() {
  let allPass = true;
  const A = await reg(nickA);
  const B = await reg(nickB);
  const S = await reg(nickS); // 陌生人

  // 成为好友
  await api(A.token, '/api/friends', { method: 'POST', body: JSON.stringify({ friendId: B.id }) });

  // A 发公开动态
  const pub = await api(A.token, '/api/moments', {
    method: 'POST',
    body: JSON.stringify({ content: '好友应可见', images: [], visibility: 'public', visibleTo: [] }),
  });
  allPass &= ok('A 发公开', pub.status === 200);

  // B 正常可见
  let bView = await api(B.token, `/api/moments/user/${A.id}`);
  allPass &= ok('B 默认可见公开动态', (bView.json?.moments || []).some((m) => m.content === '好友应可见'));

  // A 对 B 设置「不让他看我」
  const hide = await api(A.token, '/api/friends/permission', {
    method: 'POST',
    body: JSON.stringify({ friendId: B.id, permission: 'hide-moments' }),
  });
  allPass &= ok('设置 hide-moments', hide.status === 200 && hide.json?.permission === 'hide-moments', hide.text.slice(0, 80));

  bView = await api(B.token, `/api/moments/user/${A.id}`);
  allPass &= ok('B 看不到被「不让他看我」屏蔽的动态', !(bView.json?.moments || []).some((m) => m.content === '好友应可见'), JSON.stringify((bView.json?.moments || []).map((m) => m.content)));

  // 陌生人默认看不了（strangerSee10 默认 false）
  const sView = await api(S.token, `/api/moments/user/${A.id}`);
  allPass &= ok('陌生人默认看不到朋友圈', !(sView.json?.moments || []).some((m) => m.content === '好友应可见'), JSON.stringify((sView.json?.moments || []).map((m) => m.content)));

  // 打开陌生人可见十条
  await api(A.token, '/api/settings', {
    method: 'PUT',
    body: JSON.stringify({ settings: { strangerSee10: true, momentsPublic: true } }),
  });
  const sView2 = await api(S.token, `/api/moments/user/${A.id}`);
  allPass &= ok('打开后陌生人可见公开动态', (sView2.json?.moments || []).some((m) => m.content === '好友应可见'), JSON.stringify((sView2.json?.moments || []).map((m) => m.content)));

  // 状态 private 仅自己
  await api(A.token, '/api/me', {
    method: 'PUT',
    body: JSON.stringify({ status: { text: '只给自己看', label: '私密', visibility: 'private' } }),
  });
  const bStatus = await api(B.token, '/api/status/friends');
  // B 仍是好友但 A 状态 private 且 B 被 hide-moments
  const hasSecret = (bStatus.json?.statuses || []).some((s) => s.userId === A.id && String(s.statusText || '').includes('只给自己看'));
  allPass &= ok('B 看不到 private 状态', !hasSecret, JSON.stringify(bStatus.json?.statuses?.map((s) => s.statusText)));

  // A 自己可见
  const meRes = await api(A.token, '/api/me');
  allPass &= ok('A 自己可见 private 状态', meRes.json?.user?.status?.visibility === 'private', JSON.stringify(meRes.json?.user?.status));

  // 附件：上传后再用他人 token 直链
  const boundary = '----vfy' + Date.now();
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="kind"\r\n\r\nfile\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="note.txt"\r\nContent-Type: text/plain\r\n\r\nhello-private\r\n`),
    Buffer.from(`--${boundary}--\r\n`),
  ]);
  const up = await fetch(BASE + '/api/chat/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${A.token}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });
  const upJson = await up.json().catch(() => ({}));
  allPass &= ok('上传 txt 附件', up.status === 200 && Boolean(upJson.url), JSON.stringify(upJson).slice(0, 80));

  if (upJson.url) {
    const name = String(upJson.url).split('/').pop();
    // 无 token 直链
    const noAuth = await fetch(BASE + upJson.url);
    allPass &= ok('无登录打不开附件', noAuth.status === 401, String(noAuth.status));

    // 他人 token 直链（B 未收到该消息）
    const bOpen = await fetch(BASE + upJson.url, {
      headers: { Authorization: `Bearer ${B.token}` },
    });
    allPass &= ok('无关用户打不开附件', bOpen.status === 403, String(bOpen.status));

    // 所有者可打开
    const aOpen = await fetch(BASE + upJson.url, {
      headers: { Authorization: `Bearer ${A.token}` },
    });
    allPass &= ok('所有者可打开附件', aOpen.status === 200, String(aOpen.status));

    // 拒绝 html 上传
    const htmlBoundary = '----html' + Date.now();
    const htmlBody = Buffer.concat([
      Buffer.from(`--${htmlBoundary}\r\nContent-Disposition: form-data; name="kind"\r\n\r\nfile\r\n`),
      Buffer.from(`--${htmlBoundary}\r\nContent-Disposition: form-data; name="file"; filename="evil.html"\r\nContent-Type: text/html\r\n\r\n<script>alert(1)</script>\r\n`),
      Buffer.from(`--${htmlBoundary}--\r\n`),
    ]);
    const htmlUp = await fetch(BASE + '/api/chat/upload', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${A.token}`,
        'Content-Type': `multipart/form-data; boundary=${htmlBoundary}`,
      },
      body: htmlBody,
    });
    allPass &= ok('拒绝 html 附件', htmlUp.status === 400, String(htmlUp.status));
    void name;
  }

  console.log(allPass ? '\nALL PASS' : '\nSOME FAILED');
  if (!allPass) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
