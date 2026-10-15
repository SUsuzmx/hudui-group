// 临时验证脚本：设备封禁端到端逻辑（在隔离数据目录中跑真实 db.js + device-ban.js）
// 用法: PERRY_DATA_DIR=<tmp> node scripts/test-device-ban.mjs
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'perry-device-test-'));
process.env.PERRY_DATA_DIR = tmp;

const { db, stmts } = await import('../server/db.js');
const {
  normalizeDeviceId, normalizeDeviceSig, isDeviceBanned, isSigBanned, isBannedRequest,
  touchDevice, banDevice, banSig, unbanDevice, usersOfDevice, deviceOfUser,
  identityOfUser, listBannedDevices, sigRegisterLimited, SIG_REGISTER_LIMIT,
} = await import('../server/device-ban.js');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass += 1; console.log('  OK', name); }
  else { fail += 1; console.log('FAIL', name); }
}
const sigRows = (sig) => db.prepare('SELECT COUNT(*) AS n FROM banned_devices WHERE sig_hash = ?').get(normalizeDeviceSig(sig)).n;

// 造用户
const t = Date.now();
const mk = (nick) => {
  stmts.insertUser.run(nick, 'x', '#fff', t, null, `wx_${nick}`, '', '');
  return db.prepare('SELECT id FROM users WHERE nickname = ?').get(nick).id;
};
const alice = mk('alice');
const bob = mk('bob');
const eve = mk('eve');

const ID_A = 'device-abc-123';
const SIG_A = 'Win|Chrome|1920x1080|canvas-xyz';
const ID_A2 = 'device-fresh-999'; // alice 清缓存后的新持久 ID，特征不变

// 1) 登记：同设备同指纹（alice、bob 共用一台设备）
touchDevice({ userId: alice, deviceId: ID_A, sig: SIG_A, ip: '1.2.3.4', userAgent: 'TestUA' });
touchDevice({ userId: bob, deviceId: ID_A, sig: SIG_A, ip: '1.2.3.4', userAgent: 'TestUA' });
check('touchDevice alice id', deviceOfUser(alice) === normalizeDeviceId(ID_A));
check('touchDevice alice sig', identityOfUser(alice).deviceSig === normalizeDeviceSig(SIG_A));
check('same id re-touch keeps one row', sigRows(SIG_A) === 1);
check('not banned initially', !isBannedRequest({ deviceId: ID_A, sig: SIG_A }));

// 2) 清缓存场景登记：新持久 ID + 同特征指纹 → 出现第二行
touchDevice({ userId: eve, deviceId: ID_A2, sig: SIG_A, ip: '5.6.7.8', userAgent: 'TestUA' });
check('cache-clear creates second row for same sig', sigRows(SIG_A) === 2);

// 3) 关联账号反查（alice + bob + eve 去重）
const users = usersOfDevice(ID_A, SIG_A);
check('usersOfDevice finds all 3 deduped', users.length === 3, `got ${users.length}`);

// 4) 双轨封禁：封 ID_A 连带 sig 传播到 ID_A2 行
const br = banDevice(ID_A, { reason: '测试封禁', by: 'admin' });
check('banDevice', Boolean(br.ok));
check('id banned', isDeviceBanned(ID_A));
check('sig banned (propagated)', isSigBanned(SIG_A));
check('ban propagates to cache-clear row', isDeviceBanned(ID_A2));
check('isBannedRequest by id only', isBannedRequest({ deviceId: ID_A }));
check('isBannedRequest by sig only', isBannedRequest({ sig: SIG_A }));

// 5) 核心场景：清缓存 → 新持久 ID + 同特征指纹 → 仍被拦
check('fresh id same sig still blocked', isBannedRequest({ deviceId: 'brand-new-id', sig: SIG_A }));
check('all sig rows flagged banned',
  db.prepare("SELECT COUNT(*) AS n FROM banned_devices WHERE sig_hash = ? AND banned_at > 0")
    .get(normalizeDeviceSig(SIG_A)).n === 2);

// 6) 解封传播：ID 行与同 sig 所有行一起清
const ur = unbanDevice(ID_A);
check('unbanDevice', Boolean(ur.ok));
check('unban clears all sig rows', !isDeviceBanned(ID_A) && !isDeviceBanned(ID_A2) && !isSigBanned(SIG_A));

// 7) 只有 sig 的封禁（设备从未带持久 ID）
touchDevice({ userId: eve, deviceId: '', sig: 'sig-only-device-xyz', ip: '9.9.9.9', userAgent: 'UA2' });
const sr = banSig('sig-only-device-xyz', { reason: '仅指纹封禁', by: 'admin' });
check('banSig', Boolean(sr.ok) && isSigBanned('sig-only-device-xyz'));
check('sig-only row listed', listBannedDevices({}).devices.some((d) => d.sigHash === normalizeDeviceSig('sig-only-device-xyz')));
check('unban via sig-hash id clears row', Boolean(unbanDevice(normalizeDeviceSig('sig-only-device-xyz')).ok) && !isSigBanned('sig-only-device-xyz'));

// 8) 同指纹注册限额（24h / 3 个）
check('limit not hit with 0', !sigRegisterLimited(SIG_A));
for (let i = 0; i < SIG_REGISTER_LIMIT.limit; i++) {
  stmts.insertUser.run(`limit${i}`, 'x', '#fff', Date.now(), null, `wx_limit${i}`, '', '');
  const uid = db.prepare('SELECT id FROM users WHERE nickname = ?').get(`limit${i}`).id;
  touchDevice({ userId: uid, deviceId: `limit-id-${i}`, sig: 'limit-sig' });
}
check('limit hit after 3 registrations', sigRegisterLimited('limit-sig'));
check('other sig unaffected', !sigRegisterLimited(SIG_A));

// 9) 空值安全
check('empty values no-op', !isBannedRequest({}) && Boolean(banDevice('').error) && Boolean(banSig('').error));

console.log(`\n${pass} passed, ${fail} failed`);
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows 偶发 EPERM，忽略 */ }
process.exit(fail ? 1 : 0);
