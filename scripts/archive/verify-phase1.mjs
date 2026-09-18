const BASE = 'http://127.0.0.1:3000';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};

async function http(path, { method = 'POST', body, token } = {}) {
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

const nick = '计划验收' + Math.floor(Math.random() * 10000);
const reg = await http('/api/register', { body: { nickname: nick, password: 'test1234' } });
check('注册', reg.status === 200 && reg.data.token, nick);
const token = reg.data.token;
const meId = reg.data.user.id;

// 会话列表含元数据
const chats = await http('/api/chats', { method: 'GET', token });
const groups = (chats.data.chats || []).filter((c) => c.type === 'group');
check('会话列表元数据', groups.length >= 5 && 'unread' in groups[0] && 'pinned' in groups[0],
  `n=${groups.length} unreadTotal=${chats.data.unreadTotal}`);
const main = groups.find((g) => g.isDefault);
check('默认群置顶', Boolean(main?.pinned));

// 发一条消息给自己默认群, 看 unread 是否给其他用户累计
const { io } = await import('socket.io-client');

// 先注册观察者, 再发消息 — 新注册不应把之后的新消息也判为已读
const reg2 = await http('/api/register', { body: { nickname: '旁观' + meId, password: 'test1234' } });
const token2 = reg2.data.token;

const sock = io(BASE, { auth: { token }, transports: ['websocket'] });
await new Promise((res, rej) => {
  sock.on('connect', res);
  sock.on('connect_error', rej);
  setTimeout(() => rej(new Error('t')), 8000);
});
const conv = main?.conversationId || 'grp_1';
sock.emit('group:join', conv);
const sent = await new Promise((r) => sock.emit('message:send', { content: '元数据测试', conversationId: conv }, r));
check('群发消息', sent?.ok === true);

// 观察者看未读
const chats2 = await http('/api/chats', { method: 'GET', token: token2 });
const main2 = (chats2.data.chats || []).find((c) => c.isDefault);
check('他人收到未读', (main2?.unread || 0) >= 1, `unread=${main2?.unread}`);

// 标记已读
const read = await http('/api/chat/read', { body: { conversationId: conv }, token: token2 });
check('标记已读', read.status === 200);
const chats2b = await http('/api/chats', { method: 'GET', token: token2 });
const main2b = (chats2b.data.chats || []).find((c) => c.isDefault);
check('已读后未读清零', (main2b?.unread || 0) === 0, `unread=${main2b?.unread}`);

// 偏好: 置顶/免打扰/草稿
const pref = await http('/api/chat/pref', {
  body: { conversationId: conv, muted: true, pinned: true, draft: '这是草稿' },
  token,
});
check('写入偏好', pref.status === 200 && pref.data.pref?.muted && pref.data.pref?.draft === '这是草稿',
  JSON.stringify(pref.data.pref));
const chats3 = await http('/api/chats', { method: 'GET', token });
const main3 = (chats3.data.chats || []).find((c) => c.isDefault);
check('会话读到草稿/免打扰', main3?.draft === '这是草稿' && main3?.muted === true,
  `${main3?.draft} muted=${main3?.muted}`);

// 清空
const clear = await http('/api/chat/clear', { body: { conversationId: 'grp_2' }, token });
check('清空聊天记录', clear.status === 200);
const hist = await new Promise((r) => {
  sock.emit('history:load', { conversationId: 'grp_2' }, r);
});
check('产品群记录已空', (hist || []).length === 0, `n=${hist?.length}`);

// 好友申请
const req = await http('/api/friends/request', { body: { userId: meId, message: '加个好友' }, token: token2 });
check('发送好友申请', req.status === 200, JSON.stringify(req.data));
const reqs = await http('/api/friends/requests', { method: 'GET', token });
const incoming = (reqs.data.incoming || []).filter((r) => r.status === 'pending');
check('收到好友申请', incoming.length >= 1, `pending=${reqs.data.pending}`);
const handle = await http('/api/friends/request/handle', {
  body: { id: incoming[0].id, action: 'accept' },
  token,
});
check('接受好友申请', handle.status === 200 && handle.data.status === 'accepted');
const fl = await http('/api/friends', { method: 'GET', token });
check('双方成为好友', (fl.data.friends || []).some((f) => f.id === reg2.data.user.id));

// 标签
const tag = await http('/api/tags', { body: { name: '同事' }, token });
check('创建标签', tag.status === 200 && tag.data.tag?.id);
const tags = await http('/api/tags', { method: 'GET', token });
check('标签列表', (tags.data.tags || []).some((t) => t.name === '同事'));

// 收藏
const fav = await http('/api/favorites', { body: { kind: 'text', content: '收藏一条', fromName: '测试' }, token });
check('添加收藏', fav.status === 200);
const favs = await http('/api/favorites', { method: 'GET', token });
check('收藏列表', (favs.data.favorites || []).length >= 1);

// 公众号
const oa = await http('/api/official', { method: 'GET', token });
check('公众号列表', (oa.data.official || []).length >= 1, `n=${oa.data.official?.length}`);
if (oa.data.official?.[0]) {
  const follow = await http('/api/official/follow', { body: { id: oa.data.official[0].id }, token });
  check('关注公众号', follow.status === 200);
}

sock.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n=== ${results.length - failed.length}/${results.length} passed ===`);
process.exit(failed.length ? 1 : 0);
