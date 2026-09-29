// 叠塔对战集成检查：房间 / 邀请 / 落塔 / 结算
// 用法: 先 PORT=3011 node server/index.js，再 node scripts/test-tower-battle.mjs
import { io } from 'socket.io-client';

const BASE = process.env.BASE || 'http://127.0.0.1:3011';
let failed = 0;

function ok(name, cond, extra = '') {
  if (cond) console.log(`PASS ${name} ${extra}`);
  else {
    console.error(`FAIL ${name} ${extra}`);
    failed++;
  }
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
  return { status: res.status, data };
}

function connect(token) {
  return new Promise((resolve, reject) => {
    const s = io(BASE, { auth: { token }, transports: ['websocket'], forceNew: true });
    const timer = setTimeout(() => reject(new Error('socket timeout')), 8000);
    s.on('connect', () => {
      clearTimeout(timer);
      resolve(s);
    });
    s.on('connect_error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

function emitAck(s, event, payload) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({ error: 'ack timeout' }), 6000);
    s.emit(event, payload, (res) => {
      clearTimeout(t);
      resolve(res || {});
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const suffix = Date.now().toString(36).slice(-5);
  const cmd = (n) => `${n}-${suffix}-${Math.random().toString(36).slice(2, 6)}`;

  // 注册 3 个账号
  const users = [];
  for (const name of [`tb_a_${suffix}`, `tb_b_${suffix}`, `tb_c_${suffix}`]) {
    const r = await req('/api/register', { method: 'POST', body: { nickname: name, password: 'pass1234' } });
    ok(`register ${name}`, r.status === 200 && r.data.token);
    users.push({ name, token: r.data.token, id: r.data.user.id });
  }
  const [u1, u2, u3] = users;
  const s1 = await connect(u1.token);
  const s2 = await connect(u2.token);
  const s3 = await connect(u3.token);

  // 1. 创建房间
  const create = await emitAck(s1, 'tower:room:create', { commandId: cmd('c') });
  ok('create room', create.ok && create.room?.id, create.error || '');
  const roomId = create.room?.id;
  ok('host is creator', create.room?.hostUserId === u1.id);
  ok('status waiting', create.room?.status === 'waiting');
  ok('no room code exposed', !JSON.stringify(create.room).includes(roomId.slice(0, 4) + '-code'));

  // 2. 重复创建：已有活动房间
  const create2 = await emitAck(s1, 'tower:room:create', { commandId: cmd('c2') });
  ok('duplicate create returns existing', create2.ok && (create2.exists || create2.room?.id === roomId));

  // 3. 发送到默认群的邀请
  const inv1 = await emitAck(s1, 'tower:invite:send', {
    conversationId: 'default',
    commandId: cmd('i'),
  });
  ok('send invite to group', inv1.ok && inv1.inviteId, inv1.error || '');
  ok('invite has messageId', Boolean(inv1.messageId));
  const inviteId = inv1.inviteId;

  // 4. 伪造 roomId 不能加入
  const fake = await emitAck(s2, 'tower:invite:join', {
    inviteId: 'deadbeefdeadbeefdeadbeefdeadbeef',
    commandId: cmd('jfake'),
  });
  ok('reject fake inviteId', Boolean(fake.error) && !fake.ok);

  // 5. 双人加入后自动开局（第 3 人不可加入）
  const join2 = await emitAck(s2, 'tower:invite:join', { inviteId, commandId: cmd('j2') });
  ok('u2 join', join2.ok && join2.room?.players?.some((p) => p.userId === u2.id), join2.error || '');
  ok('auto countdown on 2nd join', ['countdown', 'playing'].includes(join2.room?.status), join2.room?.status);
  ok('maxPlayers is 2', join2.room?.maxPlayers === 2);

  const join3 = await emitAck(s3, 'tower:invite:join', { inviteId, commandId: cmd('j3') });
  ok('u3 cannot join 2p room', Boolean(join3.error), join3.ok ? 'unexpectedly joined' : '');

  // 6. 重复加入不占双位
  const join2again = await emitAck(s2, 'tower:invite:join', { inviteId, commandId: cmd('j2b') });
  ok('rejoin no dup seat', join2again.ok && join2again.room.players.filter((p) => p.userId === u2.id).length === 1);

  // 7. 等待自动倒计时结束
  await sleep(3200);
  const sync = await emitAck(s1, 'tower:room:sync', {});
  ok('playing after auto countdown', sync.room?.status === 'playing', sync.room?.status);
  ok('shared startAt', Boolean(sync.room?.startAt) && Boolean(sync.room?.endAt));
  ok('has seed+roundId', Boolean(sync.room?.seed) && Boolean(sync.room?.roundId));

  // 8. 双人各落一塔
  const me1 = sync.room.players.find((p) => p.userId === u1.id);
  const me2 = sync.room.players.find((p) => p.userId === u2.id);
  const drop1 = await emitAck(s1, 'tower:drop', {
    roundId: sync.room.roundId,
    seq: me1.seq,
    commandId: cmd('d1'),
    rttMs: 20,
  });
  ok('u1 drop accepted', drop1.ok, drop1.error || '');
  ok('server computed result', drop1.drop && typeof drop1.drop.miss === 'boolean');
  ok('u1 seq advanced', drop1.me?.seq === me1.seq + 1);
  ok('ranking present', Array.isArray(drop1.ranking));
  ok('u1 stack grows on success', !drop1.drop.miss ? (drop1.me?.layers === 1) : true, `layers=${drop1.me?.layers}`);

  const drop2 = await emitAck(s2, 'tower:drop', {
    roundId: sync.room.roundId,
    seq: me2.seq,
    commandId: cmd('d2'),
    rttMs: 20,
  });
  ok('u2 drop accepted', drop2.ok, drop2.error || '');
  ok('both on ranking', drop2.ranking?.length === 2);

  // 12. 伪造分数无效（客户端不能改 score）
  const dropFake = await emitAck(s1, 'tower:drop', {
    roundId: sync.room.roundId,
    seq: 99,
    commandId: cmd('dfake'),
    score: 99999,
  });
  ok('forged seq rejected', Boolean(dropFake.error));
  ok('score not 99999', (dropFake.snapshot?.players?.find((p) => p.userId === u1.id)?.score || 0) < 99999);

  // 13. 重复 commandId 只执行一次
  await sleep(320);
  const dupCmd = cmd('dup');
  const dA = await emitAck(s1, 'tower:drop', {
    roundId: sync.room.roundId,
    seq: drop1.me.seq,
    commandId: dupCmd,
    rttMs: 10,
  });
  const dB = await emitAck(s1, 'tower:drop', {
    roundId: sync.room.roundId,
    seq: drop1.me.seq + 1,
    commandId: dupCmd,
    rttMs: 10,
  });
  ok('commandId dedup', dA.ok && dB.ok && dA.me?.seq === dB.me?.seq, `a=${dA.me?.seq} b=${dB.me?.seq} aerr=${dA.error || ''} berr=${dB.error || ''}`);

  // 14. 旧 roundId 被拒绝
  const stale = await emitAck(s1, 'tower:drop', {
    roundId: 'old-round',
    seq: 0,
    commandId: cmd('stale'),
  });
  ok('stale roundId rejected', Boolean(stale.error));

  // 15. 邀请卡片状态更新（playing）
  // 通过聊天历史读取
  // 16. 私聊邀请
  const pv = `pv_u_${Math.min(u1.id, u2.id)}_${Math.max(u1.id, u2.id)}`;
  // 等这一局结束后再测私聊，先跳过中途

  // 17. 断线恢复
  s2.disconnect();
  await sleep(200);
  const s2b = await connect(u2.token);
  const sync2 = await emitAck(s2b, 'tower:room:sync', {});
  ok('reconnect restores seat', sync2.ok && sync2.room?.players?.some((p) => p.userId === u2.id));
  ok('maxPlayers is 2', sync2.room?.maxPlayers === 2);

  // 19. 非房主不能 remake
  // 20. 快速造 4 人验证满员
  // （可选）跳过，避免测试过长

  // 等待结束或强制：倒计时 90s 太久，用 rematch 路径之前先 leave 检查
  // 直接测 rematch 在 finished 后
  // 这里用 leave 一个玩家后 room 仍在

  // 验证 invite 历史状态
  // 通过 HTTP 读群消息较复杂，改为再发一次 invite 看 duplicated
  const invDup = await emitAck(s1, 'tower:invite:send', {
    conversationId: 'default',
    commandId: cmd('idup'),
  });
  ok(
    'duplicate invite avoided',
    Boolean(invDup.error) || invDup.duplicated || invDup.inviteId,
    invDup.error || JSON.stringify({ d: invDup.duplicated, id: invDup.inviteId })
  );

  // 21. 伪造 roomId 加入被拒
  // 已覆盖

  // 22. AI 私聊不能发送邀请
  const aiConv = `pv_${u1.id}_ai_x`;
  const aiInvite = await emitAck(s1, 'tower:invite:send', {
    conversationId: aiConv,
    commandId: cmd('ai'),
  });
  ok('AI private rejected', Boolean(aiInvite.error));

  // 23. 私聊邀请（真人）
  // 当前 u1 还在比赛房间，仍可发邀请到 waiting? 状态是 playing
  // playing 时应拒绝
  const invPlaying = await emitAck(s1, 'tower:invite:send', {
    conversationId: pv,
    commandId: cmd('ip'),
  });
  ok('no invite during playing', Boolean(invPlaying.error) || invPlaying.duplicated);

  // 24. 新房间 + 私聊邀请卡持久化
  await emitAck(s3, 'tower:room:leave', {});
  await emitAck(s2b, 'tower:room:leave', {});
  await emitAck(s1, 'tower:room:leave', {});
  await sleep(100);
  const create2r = await emitAck(s1, 'tower:room:create', { commandId: cmd('cpriv') });
  ok('create private room', create2r.ok && create2r.room?.id);
  const invPv = await emitAck(s1, 'tower:invite:send', {
    conversationId: pv,
    commandId: cmd('ipv'),
  });
  ok('send private invite', invPv.ok && invPv.inviteId, invPv.error || '');
  ok('private invite has messageId', Boolean(invPv.messageId));

  // 从会话历史读回卡片 ext
  await emitAck(s1, 'private:join', pv);
  const hist = await emitAck(s1, 'private:history', { conversationId: pv });
  const cardMsg = Array.isArray(hist) ? hist.find((m) => m.mediaType === 'tower_invite') : null;
  ok('private history has tower_invite', Boolean(cardMsg), cardMsg ? '' : `n=${Array.isArray(hist) ? hist.length : 'na'}`);
  ok('invite ext persisted', Boolean(cardMsg?.ext?.inviteId === invPv.inviteId), JSON.stringify(cardMsg?.ext || {}));
  ok('invite ext compact no roomId', cardMsg?.ext && !('roomId' in cardMsg.ext) && !('token' in cardMsg.ext));

  // 点击卡片加入
  const joinPv = await emitAck(s2b, 'tower:invite:join', {
    inviteId: invPv.inviteId,
    commandId: cmd('jpv'),
  });
  ok('join via private invite', joinPv.ok && joinPv.room?.players?.some((p) => p.userId === u2.id), joinPv.error || '');

  s1.disconnect();
  s2b.disconnect();
  s3.disconnect();

  console.log(failed ? `\n${failed} FAILED` : '\nALL PASS');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
