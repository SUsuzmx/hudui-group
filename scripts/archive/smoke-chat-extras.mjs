// 聊天新能力冒烟: 接龙 / 群收款 / 合并转发卡片
import { io } from 'socket.io-client';

const BASE = process.env.BASE || 'http://127.0.0.1:3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

function connect(token) {
  return new Promise((resolve, reject) => {
    const s = io(BASE, { auth: { token }, transports: ['websocket'] });
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
    setTimeout(() => reject(new Error('timeout')), 8000);
  });
}

function emit(sock, ev, payload) {
  return new Promise((resolve) => sock.emit(ev, payload, resolve));
}

const nick = '功能检' + Date.now().toString(36).slice(-4);
const reg = await api('/api/register', { body: { nickname: nick, password: 'test1234' } });
console.log('register', reg.status, !!reg.data.token);
const token = reg.data.token;
const sock = await connect(token);
const chats = await api('/api/chats', { method: 'GET', token });
const group = (chats.data.chats || []).find((c) => c.type === 'group');
const conv = group?.conversationId || 'grp_1';
sock.emit('group:join', conv);

// 接龙
const jl = await emit(sock, 'message:send', {
  conversationId: conv,
  content: '【接龙】周末爬山\n1. 思琪',
  mediaType: 'jielong',
  ext: { jieleng: true, title: '周末爬山', items: ['思琪', nick] },
});
console.log('jielong send', jl);

// 群收款
const gc = await emit(sock, 'message:send', {
  conversationId: conv,
  content: '[群收款]AA聚餐 ¥20.00',
  mediaType: 'groupcollect',
  ext: { collect: true, amount: 20, note: 'AA聚餐' },
});
console.log('groupcollect send', gc);

// 合并转发
const hist1 = await emit(sock, 'history:load', { conversationId: conv });
const ids = (hist1 || []).filter((m) => m.senderType === 'user').slice(-2).map((m) => m.id);
const fwd = ids.length >= 1
  ? await emit(sock, 'message:forward', { ids: ids.length >= 2 ? ids : [ids[0], ids[0]], toConversationId: conv })
  : { error: 'no ids' };
console.log('forward/merge', fwd, 'ids', ids);

const hist2 = await emit(sock, 'history:load', { conversationId: conv });
const hasJl = (hist2 || []).some((m) => m.mediaType === 'jielong' || String(m.content).includes('接龙'));
const hasGc = (hist2 || []).some((m) => m.mediaType === 'groupcollect' || String(m.content).includes('群收款'));
const hasMerge = (hist2 || []).some((m) => m.mediaType === 'merge' || String(m.content).includes('聊天记录'));
console.log('history flags', { hasJl, hasGc, hasMerge, n: hist2?.length });

// @所有人 文本
const at = await emit(sock, 'message:send', {
  conversationId: conv,
  content: '@所有人 今晚开会',
});
console.log('at-all send', at);

sock.disconnect();
const ok = jl?.ok && gc?.ok && at?.ok && hasJl && hasGc && (fwd?.ok || hasMerge);
console.log(ok ? 'CHAT FEATURES OK' : 'CHAT FEATURES FAIL');
process.exit(ok ? 0 : 1);
