const BASE = process.env.BASE || 'http://127.0.0.1:3000';
async function api(path, { method = 'POST', body, token } = {}) {
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

const nick = '群管验收' + Date.now().toString(36).slice(-4);
const reg = await api('/api/register', { body: { nickname: nick, password: 'test1234' } });
console.log('register', reg.status, !!reg.data.token);
const token = reg.data.token;
// 群聊已去掉 AI 群友: 建群需要 2 位真人
const r1 = await api('/api/register', { body: { nickname: nick + 'b', password: 'test1234' } });
const r2 = await api('/api/register', { body: { nickname: nick + 'c', password: 'test1234' } });
const uid1 = r1.data.user?.id;
const uid2 = r2.data.user?.id;
const g = await api('/api/groups', { body: { name: '验收测试群', memberIds: [uid1, uid2] }, token });
console.log('create group', g.status, g.data.group?.id, g.data.error || '');
const gid = g.data.group?.id;
if (gid) {
  const mem = await api(`/api/groups/${gid}/members`, { method: 'GET', token });
  console.log('members', mem.status, mem.data.count, (mem.data.members || []).map((m) => m.nickname).join(','));
  const inv = await api(`/api/groups/${gid}/members`, { body: { userIds: [] }, token });
  console.log('invite empty rejected', inv.status, inv.data.error || '');
  const mem2 = await api(`/api/groups/${gid}/members`, { method: 'GET', token });
  console.log('members after invite', mem2.data.count);
  const rn = await api(`/api/groups/${gid}/rename`, { body: { name: '验收改名群' }, token });
  console.log('rename', rn.status, rn.data.group?.name);
  const lv = await api(`/api/groups/${gid}/leave`, { body: {}, token });
  console.log('leave', lv.status, lv.data.ok || lv.data.error);
}
const c1 = await api('/api/cards', { body: { kind: 'coupon', title: '满50减10', subtitle: '演示券', color: '#e6a23c' }, token });
console.log('add card', c1.status, c1.data.card?.id);
const cl = await api('/api/cards', { method: 'GET', token });
console.log('list cards', cl.status, cl.data.cards?.length);
const cd = await api('/api/cards/delete', { body: { id: c1.data.card?.id }, token });
console.log('del card', cd.status, cd.data.ok);
console.log('DONE');
