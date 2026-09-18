// 针对本次安全/性能优化的接口冒烟 (对 http://127.0.0.1:PORT)
const BASE = process.env.BASE || 'http://127.0.0.1:3011';
let failed = 0;

function ok(name, cond, extra = '') {
  if (cond) console.log(`PASS ${name} ${extra}`);
  else { console.error(`FAIL ${name} ${extra}`); failed++; }
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
  return { status: res.status, data, headers: res.headers };
}

async function main() {
  // security headers
  const root = await fetch(BASE + '/');
  ok('x-content-type-options', root.headers.get('x-content-type-options') === 'nosniff');
  ok('x-frame-options', root.headers.get('x-frame-options') === 'SAMEORIGIN');
  ok('index no-cache', String(root.headers.get('cache-control') || '').includes('no-cache'));

  // register two users
  const suffix = Date.now().toString(36).slice(-5);
  const u1n = `smoke_a_${suffix}`;
  const u2n = `smoke_b_${suffix}`;
  const r1 = await req('/api/register', { method: 'POST', body: { nickname: u1n, password: 'pass1234' } });
  const r2 = await req('/api/register', { method: 'POST', body: { nickname: u2n, password: 'pass1234' } });
  ok('register u1', r1.status === 200 && r1.data.token, r1.data.error || '');
  ok('register u2', r2.status === 200 && r2.data.token, r2.data.error || '');
  const t1 = r1.data.token;
  const u1 = r1.data.user;
  const u2 = r2.data.user;

  // weak password rejected
  const weak = await req('/api/register', { method: 'POST', body: { nickname: `smoke_w_${suffix}`, password: '123' } });
  ok('weak password rejected', weak.status === 400);

  // clearHistory ACL: u1 cannot clear random private conv not belonging to them
  const evilConv = `pv_u_${u2.id}_${u2.id + 99999}`;
  const evil = await req('/api/chat/clear', { method: 'POST', body: { conversationId: evilConv }, token: t1 });
  ok('clear foreign private denied', evil.status === 403, `status=${evil.status}`);

  // clear own default group is allowed and only marks cleared_before
  const clearDef = await req('/api/chat/clear', { method: 'POST', body: { conversationId: 'default' }, token: t1 });
  ok('clear default allowed', clearDef.status === 200 && clearDef.data.ok, JSON.stringify(clearDef.data));

  // search unauth
  const noAuth = await req('/api/chat/search?q=测试');
  ok('search unauth 401', noAuth.status === 401);

  // search auth without conv should not error and only return scoped
  const search = await req('/api/chat/search?q=a', { token: t1 });
  ok('search auth ok', search.status === 200 && Array.isArray(search.data.messages));
  const leak = (search.data.messages || []).filter((m) => {
    const c = String(m.conversationId || '');
    return c.startsWith('pv_') && !c.includes(String(u1.id));
  });
  ok('search no foreign private', leak.length === 0, `leaks=${leak.length}`);

  // search own private conv allowed after creating? just query a foreign private conv id
  const searchForeign = await req(`/api/chat/search?q=a&conversationId=${evilConv}`, { token: t1 });
  ok('search foreign private denied', searchForeign.status === 403, `status=${searchForeign.status}`);

  // search own AI private allowed
  const ownAi = `pv_${u1.id}_ai_perry`;
  const searchOwn = await req(`/api/chat/search?q=a&conversationId=${ownAi}`, { token: t1 });
  ok('search own ai private allowed', searchOwn.status === 200, `status=${searchOwn.status}`);

  // rate limit login — 阈值与 server/auth.js LOGIN_RATE.limit=10 对齐
  const LOGIN_RATE_LIMIT = 10;
  let limited = false;
  let loginTries = 0;
  for (let i = 0; i < LOGIN_RATE_LIMIT + 3; i++) {
    loginTries = i + 1;
    const lr = await req('/api/login', { method: 'POST', body: { nickname: u1n, password: 'wrong-pass' } });
    if (lr.status === 429) { limited = true; break; }
  }
  ok('login rate limited', limited, limited ? `第${loginTries}次429` : `${loginTries}次未触发`);

  // chats still works
  const chats = await req('/api/chats', { token: r2.data.token });
  ok('chats ok', chats.status === 200 && Array.isArray(chats.data.chats));

  // me
  const me = await req('/api/me', { token: t1 });
  ok('me ok', me.status === 200 && me.data.user?.id === u1.id);

  console.log(failed ? `\n${failed} FAILED` : '\nALL PASS');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
