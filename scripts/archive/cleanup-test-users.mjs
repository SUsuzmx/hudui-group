// 清理测试联系人：删除测试账号及其关联数据
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

const dbPath = process.argv[2] || 'C:/perry/data/chat.db';
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL');

const rows = db.prepare('SELECT id, nickname FROM users').all();
const testRe = /(测试|外网|验证|验收|好友乙|旁观|smoke|红包|群管|通话|下一阶段|testuser|计划|全量|阶段|apidemo|pvdbg|feat|fix|p2mu|p3[a-c]?mu|ux2?mu|pvmu|wxmu|uimu|mu[0-9a-z]{4,}|^\?\?\?\?)/i;

const keepNames = new Set(['perry']);
const dropIds = [];
const keepIds = [];
for (const r of rows) {
  const n = String(r.nickname || '');
  const isTest = testRe.test(n) || (!keepNames.has(n) && !/^[\u4e00-\u9fa5]{2,4}$/.test(n));
  // 中文短名且不在测试词表 → 保留（如真人）
  const chineseReal = /^[\u4e00-\u9fa5]{2,6}$/.test(n) && !testRe.test(n) && !keepNames.has(n)
    ? false // 短中文名也可能是测试「好友甲」等, 仅保留 perry
    : false;
  if (keepNames.has(n)) {
    keepIds.push(r);
    continue;
  }
  dropIds.push(r);
}

console.log('keep', keepIds.map((u) => `${u.id}:${u.nickname}`).join(', ') || '(none)');
console.log('drop count', dropIds.length);

const idList = dropIds.map((u) => u.id);
if (!idList.length) {
  console.log('nothing to drop');
  process.exit(0);
}

const ph = idList.map(() => '?').join(',');
const tables = [
  ['sessions', `user_id IN (${ph})`],
  ['friends', `user_id IN (${ph}) OR friend_id IN (${ph})`],
  ['friend_requests', `from_id IN (${ph}) OR to_id IN (${ph})`],
  ['moments', `user_id IN (${ph})`],
  ['moment_likes', `user_id IN (${ph}) OR user_id < 0`],
  ['moment_comments', `user_id IN (${ph})`],
  ['red_packet_claims', `user_id IN (${ph})`],
  ['red_packets', `from_id IN (${ph}) OR claimed_by IN (${ph})`],
  ['transfers', `from_id IN (${ph}) OR to_user_id IN (${ph})`],
  ['wallet_tx', `user_id IN (${ph}) OR peer_id IN (${ph})`],
  ['chat_prefs', `user_id IN (${ph})`],
  ['chat_reads', `user_id IN (${ph})`],
  ['favorites', `user_id IN (${ph})`],
  ['tags', `user_id IN (${ph})`],
  ['tag_members', `user_id IN (${ph})`],
  ['oa_follows', `user_id IN (${ph})`],
  ['user_cards', `user_id IN (${ph})`],
  ['group_members', `user_id IN (${ph})`],
  ['messages', `sender_type = 'user' AND sender_id IN (${ph})`],
];

for (const [table, where] of tables) {
  try {
    const info = db.prepare(`DELETE FROM ${table} WHERE ${where}`).run(...idList);
    console.log(table, info.changes ?? 0);
  } catch (e) {
    console.log('skip', table, e.message);
  }
}

try {
  const info = db.prepare(`DELETE FROM users WHERE id IN (${ph})`).run(...idList);
  console.log('users', info.changes ?? 0);
} catch (e) {
  console.log('users fail', e.message);
}

console.log('remaining users', db.prepare('SELECT COUNT(*) n FROM users').get().n);
console.log(db.prepare('SELECT id,nickname FROM users ORDER BY id').all());
db.close();
