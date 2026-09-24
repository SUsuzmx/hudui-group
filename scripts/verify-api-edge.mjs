const BASE = 'http://127.0.0.1:3010';
const pass = 'test1234';
const s = Date.now().toString(36).slice(-4);

async function reg(n) {
  const r = await fetch(BASE + '/api/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nickname: n, password: pass }),
  });
  return r.json();
}

const a = await reg('权限验A' + s);
const b = await reg('权限验B' + s);
const h = { Authorization: 'Bearer ' + a.token, 'Content-Type': 'application/json' };
await fetch(BASE + '/api/friends', { method: 'POST', headers: h, body: JSON.stringify({ friendId: b.user.id }) });

const bad = await fetch(BASE + '/api/friends/permission', {
  method: 'POST',
  headers: h,
  body: JSON.stringify({ friendId: b.user.id, permission: 'mute-them' }),
});
console.log('mute-them API', bad.status, (await bad.text()).slice(0, 80));

const good = await fetch(BASE + '/api/friends/permission', {
  method: 'POST',
  headers: h,
  body: JSON.stringify({ friendId: b.user.id, permission: 'hide-moments' }),
});
console.log('hide-moments API', good.status, (await good.text()).slice(0, 80));

const ex = await fetch(BASE + '/api/moments', {
  method: 'POST',
  headers: h,
  body: JSON.stringify({ content: '空except', images: [], visibility: 'except', visibleTo: [] }),
});
console.log('except empty', ex.status, (await ex.text()).slice(0, 100));

const wall = await fetch(BASE + '/api/status/friends', { headers: h });
console.log('status wall', wall.status, (await wall.text()).slice(0, 120));

const notices = await fetch(BASE + '/api/service/notices', { headers: h });
console.log('service notices', notices.status, (await notices.text()).slice(0, 120));
