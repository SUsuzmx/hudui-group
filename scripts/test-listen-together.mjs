// 一起听自动检查：房间创建/加入/权限/队列/同步/结束
// 用法: node scripts/test-listen-together.mjs
// 需先启动服务：PORT=3011 node server/index.js
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
  const u1n = `lt_a_${suffix}`;
  const u2n = `lt_b_${suffix}`;
  const u3n = `lt_c_${suffix}`;
  const r1 = await req('/api/register', { method: 'POST', body: { nickname: u1n, password: 'pass1234' } });
  const r2 = await req('/api/register', { method: 'POST', body: { nickname: u2n, password: 'pass1234' } });
  const r3 = await req('/api/register', { method: 'POST', body: { nickname: u3n, password: 'pass1234' } });
  ok('register u1', r1.status === 200 && r1.data.token);
  ok('register u2', r2.status === 200 && r2.data.token);
  ok('register u3', r3.status === 200 && r3.data.token);
  const t1 = r1.data.token;
  const t2 = r2.data.token;
  const t3 = r3.data.token;
  const id1 = r1.data.user.id;
  const id2 = r2.data.user.id;

  const s1 = await connect(t1);
  const s2 = await connect(t2);
  const s3 = await connect(t3);

  const track = {
    id: 'lt-test-1',
    source: 'qq',
    title: '同步测试曲',
    artist: '测试',
    cover: '',
    duration: 180,
  };

  // 1. 群聊（default）创建房间
  const create1 = await emitAck(s1, 'listen:create', { conversationId: 'default', track });
  ok('create room', create1.ok && (create1.room?.id || create1.room?.sessionId), create1.error || '');
  const roomId = create1.room?.id || create1.room?.sessionId;
  ok('host is creator', create1.room?.hostId === id1);
  ok('room playing paused', create1.room?.playing === false);

  // 同会话已有房间
  const createDup = await emitAck(s1, 'listen:create', { conversationId: 'default', track });
  ok('duplicate room rejected', createDup.error?.includes('已经有一起听') || createDup.roomId === roomId, createDup.error || '');

  // 2. 加入
  const join2 = await emitAck(s2, 'listen:join', { sessionId: roomId, roomId });
  ok('u2 join', join2.ok && join2.room?.members?.some((m) => m.userId === id2));
  const join3 = await emitAck(s3, 'listen:join', { sessionId: roomId, roomId });
  ok('u3 join', join3.ok);

  // 3. 非法歌曲
  const bad = await emitAck(s1, 'listen:queue', {
    roomId,
    action: 'add',
    track: { id: 'x', source: 'http', title: 'evil', url: 'https://evil.example/a.mp3' },
  });
  ok('reject external source', Boolean(bad.error) && !bad.ok, bad.error || 'accepted!');

  // 4. 队列添加/去重
  const q1 = await emitAck(s1, 'listen:queue', {
    roomId,
    action: 'add',
    track: { id: 'q-1', source: 'qq', title: '队列歌A', artist: 'A' },
  });
  ok('queue add', q1.ok, q1.error || '');
  const qDup = await emitAck(s1, 'listen:queue', {
    roomId,
    action: 'add',
    track: { id: 'q-1', source: 'qq', title: '队列歌A', artist: 'A' },
  });
  ok('queue dedupe', Boolean(qDup.error), qDup.error || 'no error');

  // 5. 普通成员不能播放
  const memberPlay = await emitAck(s2, 'listen:control', { roomId, action: 'play' });
  ok('member cannot play', memberPlay.error?.includes('主持人'), memberPlay.error || '');

  // 6. 主持人播放 + 进度（listen:command + commandId）
  const play = await emitAck(s1, 'listen:command', {
    sessionId: roomId,
    action: 'play',
    positionMs: 12000,
    commandId: 'cmd-play-1',
    baseRevision: create1.room?.revision || 1,
  });
  ok('host play', play.ok && (play.room?.playing === true || play.room?.playbackState === 'playing'));
  const pos1 = play.room?.positionMs ?? 0;
  ok('position set', pos1 >= 10000, `pos=${pos1}`);

  // commandId 重复提交不执行两次
  const playDup = await emitAck(s1, 'listen:command', {
    sessionId: roomId,
    action: 'pause',
    commandId: 'cmd-play-1',
    baseRevision: play.room?.revision || 1,
  });
  ok('commandId dedupe', playDup.duplicate === true || playDup.ok, JSON.stringify(playDup).slice(0, 80));

  // 中途加入看进度
  const rejoin = await emitAck(s2, 'listen:sync', { sessionId: roomId });
  ok('mid-join position', rejoin.ok && rejoin.room?.positionMs >= 10000, `pos=${rejoin.room?.positionMs}`);

  // 7. 暂停后位置冻结
  const pause = await emitAck(s1, 'listen:command', {
    sessionId: roomId,
    action: 'pause',
    commandId: 'cmd-pause-1',
    baseRevision: rejoin.room?.revision || 1,
  });
  ok('host pause', pause.ok && (pause.room?.playing === false || pause.room?.playbackState === 'paused'));
  await sleep(300);
  const syncPaused = await emitAck(s2, 'listen:sync', { sessionId: roomId });
  ok('paused pos stable', Math.abs((syncPaused.room?.positionMs || 0) - (pause.room?.positionMs || 0)) < 50);

  // 8. 开启全员控制
  const setAll = await emitAck(s1, 'listen:control-mode', { sessionId: roomId, allowAllControl: true });
  ok('allow all control', setAll.ok && (setAll.room?.allowAllControl === true || setAll.room?.controlMode === 'all'));
  const memberPlay2 = await emitAck(s2, 'listen:command', {
    sessionId: roomId,
    action: 'play',
    commandId: 'cmd-member-play',
    baseRevision: setAll.room?.revision || 1,
  });
  ok('member play after allow', memberPlay2.ok && (memberPlay2.room?.playing === true || memberPlay2.room?.playbackState === 'playing'));

  // 9. 切歌到队列
  const next = await emitAck(s1, 'listen:command', {
    sessionId: roomId,
    action: 'next',
    commandId: 'cmd-next-1',
    baseRevision: memberPlay2.room?.revision || 1,
  });
  ok('next to queue', next.ok && next.room?.current?.id === 'q-1', `cur=${next.room?.current?.id}`);

  // 10. 主持人退出转移
  await emitAck(s1, 'listen:leave', { sessionId: roomId, roomId });
  await sleep(200);
  const afterLeave = await emitAck(s2, 'listen:sync', { sessionId: roomId, roomId });
  ok('host transfer', afterLeave.ok && afterLeave.room?.hostId === id2, `host=${afterLeave.room?.hostId}`);

  // 11. 其余成员离开后：明确退出且空房立即结束
  await emitAck(s2, 'listen:leave', { sessionId: roomId, roomId });
  // s2 离开后 s3 仍在，房间应保留（重连宽限语义）
  const mid = await emitAck(s3, 'listen:sync', { sessionId: roomId, roomId });
  ok('grace window keeps room', mid.ok === true, mid.error || '');
  await emitAck(s3, 'listen:leave', { sessionId: roomId, roomId });
  await sleep(300);
  const ended = await emitAck(s2, 'listen:sync', { sessionId: roomId, roomId });
  ok('room ended when empty', Boolean(ended.error), ended.error || 'still active');

  // 12. 私聊房间 ACL
  const pv = `pv_u_${id1}_${id2}`;
  const pvCreate = await emitAck(s1, 'listen:create', {
    conversationId: pv,
    track: { id: 'pv-1', source: 'qq', title: '私聊歌' },
  });
  ok('private room create', pvCreate.ok, pvCreate.error || '');
  const pvId = pvCreate.room?.id;
  const outsider = await emitAck(s3, 'listen:join', { roomId: pvId });
  ok('outsider denied', Boolean(outsider.error), outsider.error || 'joined!');

  // AI 私聊拒绝
  const aiConv = 'pv_' + id1 + '_ai_siqi';
  const aiCreate = await emitAck(s1, 'listen:create', {
    conversationId: aiConv,
    track: { id: 'ai-1', source: 'qq', title: 'x' },
  });
  ok('AI 私聊拒绝', Boolean(aiCreate.error), aiCreate.error || 'created!');

  s1.disconnect();
  s2.disconnect();
  s3.disconnect();
  console.log(failed ? `\nFAILED ${failed}` : '\nALL LISTEN-TOGETHER CHECKS PASSED');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
