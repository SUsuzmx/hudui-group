import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';

const db = new DatabaseSync('data/chat.db');

const KEEP = new Set(['小苏', '小鸡', '烨', '。']);
const TEST_NICK = '测试账号';

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

const users = db.prepare('SELECT id, nickname FROM users ORDER BY id').all();
const keepUsers = users.filter((u) => KEEP.has(u.nickname));
const dropUsers = users.filter((u) => !KEEP.has(u.nickname) && u.nickname !== TEST_NICK);

console.log('总计用户', users.length);
console.log('保留', keepUsers.map((u) => `${u.id}:${u.nickname}`).join(', '));
console.log('待删', dropUsers.length, '个');

if (keepUsers.length !== 4) {
  console.error('保留账号数量不是 4，请检查:', keepUsers);
  process.exit(1);
}

const keepIds = new Set(keepUsers.map((u) => u.id));

// 删除测试用户及其关联数据（与 deleteAccountData 同源逻辑）
function deleteUserDeep(uid) {
  const tables = [
    ['sessions', 'user_id'],
    ['friends', 'user_id'],
    ['friends', 'friend_id'],
    ['moment_likes', 'user_id'],
    ['moment_comments', 'user_id'],
    ['moment_visitors', 'visitor_id'],
    ['chat_reads', 'user_id'],
    ['chat_prefs', 'user_id'],
    ['favorites', 'user_id'],
    ['password_resets', 'user_id'],
    ['login_history', 'user_id'],
    ['group_announcement_reads', 'user_id'],
    ['group_join_requests', 'user_id'],
    ['cloud_backups', 'user_id'],
    ['feedback', 'user_id'],
    ['reports', 'reporter_id'],
    ['group_members', 'user_id'],
  ];
  for (const [table, col] of tables) {
    try { db.prepare(`DELETE FROM ${table} WHERE ${col} = ?`).run(uid); } catch { /* ignore */ }
  }
  try { db.prepare('DELETE FROM moments WHERE user_id = ?').run(uid); } catch { /* ignore */ }
  try { db.prepare('UPDATE groups SET owner_id = NULL WHERE owner_id = ?').run(uid); } catch { /* ignore */ }
  try { db.prepare('DELETE FROM users WHERE id = ?').run(uid); } catch (e) {
    console.error('删除用户失败', uid, e.message);
  }
}

db.exec('BEGIN');
try {
  for (const u of dropUsers) {
    deleteUserDeep(u.id);
  }
  db.exec('COMMIT');
} catch (e) {
  db.exec('ROLLBACK');
  throw e;
}

// 重置/创建 测试账号
const existingTest = db.prepare('SELECT id FROM users WHERE nickname = ? COLLATE NOCASE').get(TEST_NICK);
const testPwd = hashPassword('123456');
if (existingTest) {
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(testPwd, existingTest.id);
  console.log('测试账号已存在，已重置密码', existingTest.id);
} else {
  // 复用一个保留账号旁边的默认头像/颜色
  const r = db.prepare(
    'INSERT INTO users (nickname, password_hash, avatar_color, created_at, avatar, wxid, region, signature, settings) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    TEST_NICK,
    testPwd,
    '#4f6ef7',
    Date.now(),
    'amdin.png',
    'test_account',
    '中国',
    '可复用测试账号',
    '{}'
  );
  console.log('已创建测试账号 id=', r.lastInsertRowid);
}

// 确保小苏仍是唯一管理员
const xiaosu = db.prepare("SELECT id, settings FROM users WHERE nickname = '小苏'").get();
if (xiaosu) {
  let s = {};
  try { s = xiaosu.settings ? JSON.parse(xiaosu.settings) : {}; } catch { s = {}; }
  s.isAdmin = true;
  db.prepare('UPDATE users SET settings = ? WHERE id = ?').run(JSON.stringify(s), xiaosu.id);
  // 清掉其它人的 isAdmin
  const all = db.prepare('SELECT id, nickname, settings FROM users').all();
  for (const u of all) {
    if (u.nickname === '小苏') continue;
    let su = {};
    try { su = u.settings ? JSON.parse(u.settings) : {}; } catch { su = {}; }
    if (su.isAdmin) {
      delete su.isAdmin;
      db.prepare('UPDATE users SET settings = ? WHERE id = ?').run(JSON.stringify(su), u.id);
    }
  }
}

const after = db.prepare('SELECT id, nickname FROM users ORDER BY id').all();
console.log('清理后用户:', after.map((u) => `${u.id}:${u.nickname}`).join(' | '));
console.log('done');
