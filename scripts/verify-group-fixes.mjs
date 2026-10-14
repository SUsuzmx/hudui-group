// 验证群聊信息页相关修复：成员头像字段、群昵称、群公告接口
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = process.env.VERIFY_PORT || '3199';
const BASE = `http://127.0.0.1:${PORT}`;
const child = spawn(process.execPath, ['server/index.js'], {
  cwd: process.cwd(),
  env: { ...process.env, PORT },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
child.stdout.on('data', (d) => { out += d; });
child.stderr.on('data', (d) => { out += d; });

function ok(name, cond, extra = '') {
  console.log(`${cond ? 'OK' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) process.exitCode = 1;
}

try {
  // 等启动
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(BASE + '/');
      if (r.ok) break;
    } catch { /* retry */ }
    await sleep(200);
  }

  const nick = 'f' + String(Date.now()).slice(-8);
  const regRes = await fetch(BASE + '/api/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nickname: nick, password: 'pass1234' }),
  });
  const regText = await regRes.text();
  let rj;
  try { rj = JSON.parse(regText); } catch { rj = { raw: regText.slice(0, 200) }; }
  ok('注册', regRes.status === 200 && rj.token, `status=${regRes.status} ${JSON.stringify(rj).slice(0, 120)}`);
  const token = rj.token;
  const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token };

  // 群聊已去掉 AI 群友: 该接口恒为空
  const ais = await fetch(BASE + '/api/ai-contacts', { headers: H }).then((r) => r.json());
  ok('AI 联系人已下线', (ais.contacts || []).length === 0, `n=${(ais.contacts || []).length}`);

  // 建群需要至少 2 位真人好友, 这里先注册两位
  const mk = async (name) => {
    const r = await fetch(BASE + '/api/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname: name, password: 'pass1234' }),
    }).then((x) => x.json());
    return r.user?.id;
  };
  const uidB = await mk('fB' + String(Date.now()).slice(-7));
  const uidC = await mk('fC' + String(Date.now()).slice(-7));

  const cg = await fetch(BASE + '/api/groups', {
    method: 'POST', headers: H,
    body: JSON.stringify({ name: '修复验证群', memberIds: [uidB, uidC] }),
  }).then((r) => r.json());
  const gid = cg.group?.id;
  ok('创建群', Boolean(gid), `gid=${gid}`);

  const mem = await fetch(BASE + `/api/groups/${gid}/members`, { headers: H }).then((r) => r.json());
  const list = mem.members || [];
  ok('成员列表非空', list.length >= 2, `n=${list.length}`);
  ok('成员含头像字段', list.every((m) => 'avatar' in m), list.map((m) => `${m.nickname}:${m.avatar}`).join(' | '));
  ok('真人成员有 userId', list.every((m) => m.userId), JSON.stringify(list.map((m) => ({ u: m.userId, n: m.nickname }))));
  ok('成员里没有 AI', list.every((m) => !m.isAI), JSON.stringify(list.map((m) => m.isAI)));

  const nn = await fetch(BASE + `/api/groups/${gid}/my-nickname`, {
    method: 'POST', headers: H, body: JSON.stringify({ nickname: '群内小名X' }),
  });
  const nnj = await nn.json();
  ok('设置群昵称', nn.status === 200 && nnj.nickname === '群内小名X', JSON.stringify(nnj));

  const mem2 = await fetch(BASE + `/api/groups/${gid}/members`, { headers: H }).then((r) => r.json());
  const mine = (mem2.members || []).find((m) => Number(m.userId) === Number(rj.user?.id));
  ok('群昵称已写入成员列表', mine?.nickname === '群内小名X', mine?.nickname);

  const notice = await fetch(BASE + `/api/groups/${gid}/notice`, {
    method: 'POST', headers: H, body: JSON.stringify({ notice: '测试公告内容' }),
  }).then((r) => r.json());
  ok('群公告可发布', notice.group?.notice === '测试公告内容', notice.group?.notice || notice.error);

  // 不存在的用户
  const noUser = await fetch(BASE + '/api/users/99999999', { headers: H });
  ok('无效用户返回 404', noUser.status === 404);
} catch (e) {
  ok('脚本异常', false, e.message);
  console.log(out.slice(-800));
} finally {
  child.kill();
}
