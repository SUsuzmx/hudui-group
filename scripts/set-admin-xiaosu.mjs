import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';

const db = new DatabaseSync('data/chat.db');
const users = db.prepare('SELECT id, nickname, settings, password_hash FROM users ORDER BY id').all();
console.log('users:', users.map((u) => ({ id: u.id, nickname: u.nickname, settings: u.settings })));

const target = db.prepare("SELECT * FROM users WHERE nickname = ? COLLATE NOCASE").get('小苏');
console.log('小苏 found:', target ? { id: target.id, nickname: target.nickname } : null);

// 唯一管理员：小苏
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

if (!target) {
  console.log('小苏 不存在，需要创建');
  process.exit(2);
}

// 重置密码为 1234（直接写库，绕过 6 位前端限制）
db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword('1234'), target.id);

// 清掉所有 isAdmin，再只给小苏
for (const u of users) {
  let s = {};
  try { s = u.settings ? JSON.parse(u.settings) : {}; } catch { s = {}; }
  if (s.isAdmin) {
    delete s.isAdmin;
    db.prepare('UPDATE users SET settings = ? WHERE id = ?').run(JSON.stringify(s), u.id);
  }
}
let s = {};
try { s = target.settings ? JSON.parse(target.settings) : {}; } catch { s = {}; }
s.isAdmin = true;
db.prepare('UPDATE users SET settings = ? WHERE id = ?').run(JSON.stringify(s), target.id);

const after = db.prepare('SELECT id, nickname, settings FROM users').all();
console.log('after:', after);
console.log('done: 小苏 password=1234, sole admin');
