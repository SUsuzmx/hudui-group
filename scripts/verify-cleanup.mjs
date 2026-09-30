import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';

const db = new DatabaseSync('data/chat.db');

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const check = crypto.scryptSync(password ?? '', salt, 32).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex'));
}

const users = db.prepare('SELECT id, nickname, password_hash, settings FROM users ORDER BY id').all();
console.log('users:');
for (const u of users) {
  console.log(' ', u.id, u.nickname, 'settings=', u.settings);
}

const test = db.prepare("SELECT * FROM users WHERE nickname = '测试账号'").get();
console.log('测试账号 password 123456 =>', verifyPassword('123456', test.password_hash));

const xiaosu = db.prepare("SELECT * FROM users WHERE nickname = '小苏'").get();
let s = {};
try { s = JSON.parse(xiaosu.settings || '{}'); } catch { s = {}; }
console.log('小苏 isAdmin=', s.isAdmin === true, 'password 1234 =>', verifyPassword('1234', xiaosu.password_hash));

// 清理测试群（kind=custom 且 owner 不是保留用户，或名称含验收/越权/测试）
const KEEP = new Set(['小苏', '小鸡', '烨', '。', '测试账号']);
const keepIds = new Set(users.map((u) => u.id));
const groups = db.prepare('SELECT * FROM groups').all();
const drop = [];
for (const g of groups) {
  const name = String(g.name || '');
  const isSeed = ['main', 'product', 'work'].includes(g.kind);
  const testLike = /验收|越权|测试|Smoke|smoke|群主改名|管理员改名|清理/.test(name);
  if (!isSeed && (testLike || !g.owner_id || !keepIds.has(g.owner_id))) {
    drop.push(g);
  }
}
console.log('待删测试群', drop.map((g) => `${g.id}:${g.name}`).join(' | ') || '(无)');
for (const g of drop) {
  const conv = `grp_${g.id}`;
  for (const [sql, ...args] of [
    ['DELETE FROM group_members WHERE group_id = ?', g.id],
    ['DELETE FROM messages WHERE conversation_id = ?', conv],
    ['DELETE FROM chat_prefs WHERE conversation_id = ?', conv],
    ['DELETE FROM chat_reads WHERE conversation_id = ?', conv],
    ['DELETE FROM group_announcement_reads WHERE group_id = ?', g.id],
    ['DELETE FROM group_join_requests WHERE group_id = ?', g.id],
    ['DELETE FROM groups WHERE id = ?', g.id],
  ]) {
    try { db.prepare(sql).run(...args); } catch { /* ignore */ }
  }
}

const afterGroups = db.prepare('SELECT id, name, kind, owner_id FROM groups').all();
console.log('保留群:', afterGroups.map((g) => `${g.id}:${g.name}`).join(' | '));

// 清掉已删用户的残留朋友圈
const moments = db.prepare('SELECT COUNT(*) n FROM moments WHERE user_id NOT IN (SELECT id FROM users)').get();
console.log('孤儿朋友圈数', moments.n);
if (moments.n) {
  db.prepare('DELETE FROM moments WHERE user_id NOT IN (SELECT id FROM users)').run();
}
console.log('done');
