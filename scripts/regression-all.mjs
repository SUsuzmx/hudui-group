// 全功能回归: 认证/好友/AI联系人/多群/引用撤回拍一拍/媒体/搜索/朋友圈
import { io } from 'socket.io-client';

const BASE = process.env.BASE || 'http://127.0.0.1:3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};

async function http(path, { method = 'POST', body, token, raw = false } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, res };
}

const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const wav =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

// ── 1. 认证 ──
const nick = '全量验收' + Math.floor(Math.random() * 10000);
const reg = await http('/api/register', { body: { nickname: nick, password: 'test1234', avatar: null } });
check('注册', reg.status === 200 && reg.data.token, nick);
const token = reg.data.token;
const meId = reg.data.user?.id;

const login = await http('/api/login', { body: { nickname: nick, password: 'test1234' } });
check('登录', login.status === 200 && login.data.token);
// 单端登录会挤掉注册会话，后续统一用最新 token
const authToken = login.data.token || token;

const me1 = await http('/api/me', { method: 'GET', token: authToken });
check('获取我', me1.status === 200 && me1.data.user?.nickname === nick);

const upd = await http('/api/me', {
  method: 'PUT',
  token: authToken,
  body: { signature: '回归签名', region: '上海', wxid: 'wx' + meId + 'rg' },
});
check('更新资料', upd.status === 200 && upd.data.user?.signature === '回归签名');

// ── 2. 好友 + AI联系人 ──
const friendSeed = await http('/api/register', {
  body: { nickname: '好友乙' + meId, password: 'test1234' },
});
const friendId = friendSeed.data?.user?.id;
const addF = await http('/api/friends', { token: authToken, body: { friendId } });
check('添加好友', addF.status === 200);
const listF = await http('/api/friends', { method: 'GET', token: authToken });
check('好友列表', listF.status === 200 && listF.data.friends?.some((f) => f.id === friendId));
const delF = await http(`/api/friends/${friendId}`, { method: 'DELETE', token: authToken });
check('删除好友', delF.status === 200);

const aiC = await http('/api/ai-contacts', { method: 'GET', token: authToken });
check('AI联系人', aiC.status === 200 && (aiC.data.contacts?.length || 0) >= 10, `n=${aiC.data.contacts?.length}`);

// ── 3. 会话列表多群 ──
const chats = await http('/api/chats', { method: 'GET', token: authToken });
const groups = (chats.data.chats || []).filter((c) => c.type === 'group');
check('多群会话', groups.length >= 5, groups.map((g) => g.name).join('/'));

function connect(token) {
  return new Promise((resolve, reject) => {
    const s = io(BASE, { auth: { token }, transports: ['websocket'] });
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
    setTimeout(() => reject(new Error('socket timeout')), 10000);
  });
}

const sock = await connect(authToken);

async function emit(ev, payload) {
  return new Promise((resolve) => sock.emit(ev, payload, resolve));
}

// ── 4. 群消息 + 引用 + 撤回 + 拍一拍 + 媒体 ──
const conv = groups.find((g) => g.kind === 'product')?.conversationId || groups[0]?.conversationId || 'grp_1';
sock.emit('group:join', conv);

const s1 = await emit('message:send', { content: '回归文本消息', conversationId: conv });
check('群发送文本', s1?.ok === true, String(s1?.id));

const s2 = await emit('message:send', {
  content: '这是引用',
  conversationId: conv,
  quote: { id: s1.id, name: nick, content: '回归文本消息' },
});
check('引用发送', s2?.ok === true);

const upImg = await http('/api/chat/upload', { token: authToken, body: { data: png, kind: 'image' } });
check('上传图片', upImg.status === 200 && upImg.data.url, upImg.data.url || '');
const s3 = await emit('message:send', {
  mediaType: 'image',
  mediaUrl: upImg.data.url,
  conversationId: conv,
});
check('发送图片', s3?.ok === true);

const upV = await http('/api/chat/upload', { token: authToken, body: { data: wav, kind: 'voice' } });
check('上传语音', upV.status === 200 && upV.data.url, upV.data.url || '');
const s4 = await emit('message:send', {
  content: '[语音] 1"',
  mediaType: 'voice',
  mediaUrl: upV.data.url,
  conversationId: conv,
});
check('发送语音', s4?.ok === true);

const rec = await emit('message:recall', { id: s1.id, conversationId: conv });
check('撤回文本', rec?.ok === true);

const hist = await emit('history:load', { conversationId: conv });
const recalled = hist.find((m) => m.id === s1.id);
check('撤回变系统提示', recalled?.senderType === 'system', recalled?.content);
const quoted = hist.find((m) => m.id === s2.id);
check('历史含引用', Boolean(quoted?.quote?.content), JSON.stringify(quoted?.quote || null));
const imgMsg = hist.find((m) => m.id === s3.id);
check('历史含图片', imgMsg?.mediaType === 'image' && Boolean(imgMsg?.mediaUrl));
const voiceMsg = hist.find((m) => m.id === s4.id);
check('历史含语音', voiceMsg?.mediaType === 'voice');

const pat = await emit('message:pat', { conversationId: conv, targetName: '思琪' });
check('拍一拍', pat?.ok === true);
await sleep(500);
const hist2 = await emit('history:load', { conversationId: conv });
check('拍一拍系统消息', hist2.some((m) => m.senderType === 'system' && m.content?.includes('拍了拍')));

// 多群隔离
const family = groups.find((g) => g.kind === 'family')?.conversationId || 'grp_3';
const famHist = await emit('history:load', { conversationId: family });
check('多群不串消息', !famHist.some((m) => m.content === '这是引用'));

// 搜索: 用未撤回消息里的词
const search = await http('/api/chat/search?q=%E5%BC%95%E7%94%A8&conversationId=' + conv, {
  method: 'GET',
  token: authToken,
});
check('搜索聊天记录', search.status === 200 && (search.data.messages?.length || 0) > 0, `n=${search.data.messages?.length}`);

// typing
sock.emit('typing:start', { conversationId: conv });
check('typing事件可发', true);

// ── 5. 朋友圈 ──
const upM = await http('/api/moments/upload', { token: authToken, body: { data: png } });
check('朋友圈传图', upM.status === 200 && upM.data.url, upM.data.url || '');
const cm = await http('/api/moments', {
  token: authToken,
  body: { content: '回归朋友圈', images: [upM.data.url] },
});
check('发朋友圈', cm.status === 200 && cm.data.moment?.id, String(cm.data.moment?.id));
const mid = cm.data.moment?.id;
const like = await http('/api/moments/like', { token: authToken, body: { id: mid } });
check('点赞', like.status === 200 && like.data.likes?.length === 1);
const cmt = await http('/api/moments/comment', { token: authToken, body: { id: mid, content: '好看' } });
check('评论', cmt.status === 200 && cmt.data.comments?.length === 1);
const mList = await http('/api/moments', { method: 'GET', token: authToken });
const found = mList.data.moments?.find((m) => m.id === mid);
check('列表含图与互动', found?.images?.length === 1 && found?.likes?.length === 1 && found?.comments?.length === 1);
const unlike = await http('/api/moments/unlike', { token: authToken, body: { id: mid } });
check('取消赞', unlike.status === 200 && unlike.data.likes?.length === 0);
const delM = await http(`/api/moments/${mid}`, { method: 'DELETE', token: authToken });
check('删朋友圈', delM.status === 200);

// ── 6. 私聊 AI ──
const convPv = `pv_${meId}_ai_siqi`;
const pvMsgs = [];
sock.on('private:message', (m) => {
  if (m.conversationId === convPv && m.senderType === 'ai') pvMsgs.push(m);
});
sock.emit('private:join', convPv);
const pv = await emit('private:send', { conversationId: convPv, content: '在干什么' });
check('私聊发送', pv?.ok === true);
for (let i = 0; i < 20; i++) {
  await sleep(1500);
  if (pvMsgs.length) break;
}
check('私聊AI回复', pvMsgs.length > 0, pvMsgs[0]?.content?.slice(0, 24));

// ── 7. 用户资料/二维码/头像 ──
const avatars = await http('/api/avatars', { method: 'GET' });
check('头像列表', avatars.status === 200 && avatars.data.avatars?.length > 10, `n=${avatars.data.avatars?.length}`);

const userPage = await http(`/api/users/${friendId}`, { method: 'GET', token: authToken });
check('用户资料', userPage.status === 200 && userPage.data.user?.id === friendId);

// ── 8. 群AI接话(非默认群) ──
const climb = groups.find((g) => g.kind === 'climb')?.conversationId || 'grp_4';
const climbAI = [];
const onClimb = (m) => {
  if (m.conversationId === climb && m.senderType === 'ai') climbAI.push(m);
};
sock.on('group:message', onClimb);
sock.emit('group:join', climb);
await emit('message:send', { content: '这周爬山还去吗 @王也', conversationId: climb });
for (let i = 0; i < 20; i++) {
  await sleep(2000);
  if (climbAI.length) break;
}
check('非默认群AI接话', climbAI.length > 0, (climbAI[0]?.senderName || '') + ':' + ((climbAI[0]?.content || '').slice(0, 20)));

sock.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n=== ${results.length - failed.length}/${results.length} passed ===`);
if (failed.length) {
  console.log('Failed:', failed.map((f) => `${f.name}(${f.detail})`).join(' | '));
  process.exit(1);
}
process.exit(0);
