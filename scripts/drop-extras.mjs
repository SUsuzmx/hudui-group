import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('data/chat.db');
const users = db.prepare('SELECT id, nickname FROM users ORDER BY id').all();
const KEEP = new Set(['小苏', '小鸡', '烨', '。', '测试账号']);

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
  for (const [t, c] of tables) {
    try { db.prepare(`DELETE FROM ${t} WHERE ${c} = ?`).run(uid); } catch { /* ignore */ }
  }
  try { db.prepare('DELETE FROM moments WHERE user_id = ?').run(uid); } catch { /* ignore */ }
  try { db.prepare('UPDATE groups SET owner_id = NULL WHERE owner_id = ?').run(uid); } catch { /* ignore */ }
  db.prepare('DELETE FROM users WHERE id = ?').run(uid);
}

const drop = users.filter((u) => !KEEP.has(u.nickname));
console.log('drop', drop);
for (const u of drop) deleteUserDeep(u.id);

console.log('final', db.prepare('SELECT id, nickname FROM users ORDER BY id').all());
