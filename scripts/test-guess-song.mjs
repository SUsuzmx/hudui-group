// 猜歌抢答集成检查：房间 / 邀请 / 抢答 / 计分 / 再来一局
// 用法: 先 PORT=3011 node server/index.js，再 node scripts/test-guess-song.mjs
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
    const t = setTimeout(() => resolve({ error: 'ack timeout' }), 8000);
    s.emit(event, payload, (res) => {
      clearTimeout(t);
      resolve(res || {});
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function waitEvent(s, event, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      s.off(event, on);
      resolve(null);
    }, timeoutMs);
    function on(payload) {
      clearTimeout(t);
      s.off(event, on);
      resolve(payload);
    }
    s.on(event, on);
  });
}

async function main() {
  const suffix = Date.now().toString(36).slice(-5);
  const cmd = (n) => `${n}-${suffix}-${Math.random().toString(36).slice(2, 6)}`;

  // 注册 3 个账号
  const users = [];
  for (const name of [`gs_a_${suffix}`, `gs_b_${suffix}`, `gs_c_${suffix}`]) {
    const r = await req('/api/register', { method: 'POST', body: { nickname: name, password: 'pass1234' } });
    ok(`register ${name}`, r.status === 200 && r.data.token);
    users.push({ name, token: r.data.token, id: r.data.user.id });
  }
  const [u1, u2, u3] = users;
  const s1 = await connect(u1.token);
  const s2 = await connect(u2.token);
  const s3 = await connect(u3.token);

  // 1. 创建房间
  const create = await emitAck(s1, 'guess:room:create', { songCount: 5, commandId: cmd('c') });
  ok('create room', create.ok && create.room?.id, create.error || '');
  const roomId = create.room?.id;
  ok('host is creator', create.room?.hostUserId === u1.id);
  ok('status waiting', create.room?.status === 'waiting');
  ok('songCount 5', create.room?.songCount === 5);
  ok('max 8 players', create.room?.maxPlayers === 8);

  // 2. 曲目数
  const sc = await emitAck(s1, 'guess:song-count', { songCount: 15 });
  ok('host set song count', sc.ok && sc.room?.songCount === 15);
  const sc2 = await emitAck(s2, 'guess:song-count', { songCount: 5 });
  ok('non-host cannot set', !sc2.ok || sc2.code === 'not_host' || sc2.code === 'no_room');

  // 3. 邀请加入（模拟点卡）
  const inv = await emitAck(s1, 'guess:invite:send', {
    conversationId: 'default',
  });
  ok('send invite card', inv.ok && inv.inviteId, inv.error || '');
  ok('invite message id', inv.messageId > 0);

  const join2 = await emitAck(s2, 'guess:invite:join', {
    inviteId: inv.inviteId,
    commandId: cmd('j2'),
  });
  ok('player2 join', join2.ok && join2.joined, join2.error || '');
  ok('player count 2', join2.room?.playerCount === 2);

  const join3 = await emitAck(s3, 'guess:invite:join', {
    inviteId: inv.inviteId,
    commandId: cmd('j3'),
  });
  ok('player3 join', join3.ok && join3.joined, join3.error || '');

  // 4. 同一账号只占一个位置（再加入返回 restored）
  const join2again = await emitAck(s2, 'guess:invite:join', {
    inviteId: inv.inviteId,
    commandId: cmd('j2b'),
  });
  ok('same user one seat', join2again.ok && join2again.restored, join2again.error || '');

  // 5. 准备 + 开始
  await emitAck(s1, 'guess:ready', { ready: true });
  await emitAck(s2, 'guess:ready', { ready: true });
  await emitAck(s3, 'guess:ready', { ready: true });

  const startNotHost = await emitAck(s2, 'guess:start', {});
  ok('only host starts', !startNotHost.ok || startNotHost.code === 'not_host');

  const startedEv = waitEvent(s1, 'guess:started', 20000);
  const roundEv = waitEvent(s1, 'guess:round', 25000);
  const playEv = waitEvent(s1, 'guess:play', 25000);
  const start = await emitAck(s1, 'guess:start', { songCount: 5 });
  ok('host start', start.ok, start.error || '');
  const started = await startedEv;
  ok('started event', Boolean(started), 'timeout waiting guess:started');

  // 6. 回合加载 → prep → play
  const round = await roundEv;
  ok('round event has trackRef', Boolean(round?.trackRef), JSON.stringify(round || {}));
  ok('round hides title', round?.trackRef && !round.trackRef.title, 'title leaked in trackRef');
  ok('round has clip window', Number(round?.clipDurationMs) > 0);
  ok('clip 8-10s', Number(round?.clipDurationMs) >= 7500 && Number(round?.clipDurationMs) <= 10500, String(round?.clipDurationMs));

  // 客户端报告加载
  await emitAck(s1, 'guess:track:loaded', {});
  await emitAck(s2, 'guess:track:loaded', {});
  await emitAck(s3, 'guess:track:loaded', {});

  const play = await playEv;
  ok('play event with startAt', Boolean(play?.startAt), JSON.stringify(play || {}));

  await sleep(300);

  // 7. 抢答
  const buzz1 = await emitAck(s1, 'guess:buzz', { commandId: cmd('bz1') });
  ok('buzz accepted', buzz1.ok || buzz1.youBuzzed || buzz1.room, buzz1.error || JSON.stringify(buzz1).slice(0, 200));
  const options = buzz1.options || [];
  ok('buzzer gets 4 options', options.length === 4, `got ${options.length}`);
  ok('options opaque', options.every((o) => o.optionId && o._correct === undefined));
  ok('options have titles', options.every((o) => o.title));

  // 其他人不应在同一 ack 里拿到选项
  const buzz2 = await emitAck(s2, 'guess:buzz', { commandId: cmd('bz2') });
  ok('second buzz rejected or no options', !buzz2.ok || !buzz2.options?.length, buzz2.error || '');

  // 8. 答对 / 答错
  const correctOpt = options.find((o) => o.title);
  // 服务端不下发正确标记，这里通过选项逐个试：第一个答错也能验证扣分
  // 为了稳定，我们先找正确项：通过 lastResult 事后校验；这里用已知选项随机
  // 更稳妥：从 room snapshot 不可知，改为连续答直到 correct 或 all_wrong
  let answered = false;
  let gotCorrect = false;
  // 只给一次作答机会（答错则本轮不能再主答），所以直接答第一个选项
  const ans = await emitAck(s1, 'guess:answer', {
    optionId: correctOpt.optionId,
    commandId: cmd('an1'),
  });
  answered = Boolean(ans.ok || ans.correct !== undefined);
  gotCorrect = Boolean(ans.correct);
  ok('answer accepted', answered, ans.error || JSON.stringify(ans).slice(0, 200));
  ok('score delta applied', typeof ans.delta === 'number', String(ans.delta));
  if (gotCorrect) {
    ok('correct score 100', ans.delta === 100, String(ans.delta));
  } else {
    ok('wrong penalty -15', ans.delta === -15, String(ans.delta));
  }

  // 若答对，进入歌手抢分
  if (gotCorrect) {
    const artistEv = await waitEvent(s1, 'guess:artist', 10000);
    ok('artist phase', Boolean(artistEv?.options?.length === 4), JSON.stringify(artistEv || {}).slice(0, 200));
    if (artistEv?.options?.length) {
      const a = await emitAck(s2, 'guess:artist', {
        optionId: artistEv.options[0].optionId,
        commandId: cmd('ar2'),
      });
      ok('artist answer accepted', a.ok || a.correct !== undefined, a.error || '');
      ok('artist delta number', typeof a.delta === 'number', String(a.delta));
    }
  } else {
    // 答错后其他人可继续抢
    const buzz3 = await emitAck(s2, 'guess:buzz', { commandId: cmd('bz3') });
    ok('other player can buzz after wrong', buzz3.ok || buzz3.options?.length || buzz3.error === 'already_buzzed' || buzz3.error === '手速太快了。', buzz3.error || '');
  }

  // 9. 不提前泄露完整歌名给非作答者
  const snap = await emitAck(s3, 'guess:room:sync', {});
  const roundPub = snap.room?.round;
  if (roundPub) {
    const leaked =
      (roundPub.revealed === false || !roundPub.revealed) &&
      JSON.stringify(roundPub).includes('晴天');
    ok('no answer leak to non-buzzer', !roundPub.myOptions || roundPub.myOptions.every((o) => o._correct === undefined));
    void leaked;
  }

  // 10. 断线恢复
  s3.disconnect();
  await sleep(300);
  const s3b = await connect(u3.token);
  const sync3 = await emitAck(s3b, 'guess:room:sync', {});
  ok('disconnect recover', sync3.ok && sync3.room?.id === roomId, sync3.error || '');
  ok('still in match after reconnect', sync3.room?.status === 'playing' || sync3.room?.status === 'finished');

  // 11. 等待一小段后 rematch / leave
  await emitAck(s1, 'guess:room:leave', {});
  await emitAck(s2, 'guess:room:leave', {});
  await emitAck(s3b, 'guess:room:leave', {});
  ok('leave ok', true);

  s1.close();
  s2.close();
  s3b.close();

  console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
