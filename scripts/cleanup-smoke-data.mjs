// 定向清理自动化测试留下的痕迹（仅处理 smoke_* 前缀，绝不碰真实账号）。
// 默认 dry-run，加 --apply 才真正删除。
import { db } from '../server/db.js';

const APPLY = process.argv.includes('--apply');

// 匹配自动生成的 smoke 测试账号（大小写不敏感，如 smoke_mv6we7q3 / Smokek3ppmm）。
// 已人工核对：不存在以 smoke 开头的真实用户。
const smokeUsers = db.prepare(
  "SELECT id, nickname, created_at FROM users WHERE nickname LIKE 'smoke%' ORDER BY id"
).all();

const smokeAudit = db.prepare(
  "SELECT COUNT(*) AS n FROM admin_audit_logs WHERE detail LIKE '%冒烟%' OR admin_name LIKE 'smoke\\_%' ESCAPE '\\'"
).get()?.n || 0;

const smokeAdmins = db.prepare(
  "SELECT id, username FROM admin_accounts WHERE username LIKE 'smoke\\_%' ESCAPE '\\' OR username LIKE 'weak\\_%' ESCAPE '\\'"
).all();

// 冒烟测试种子数据（scripts/seed-smoke-report.mjs 创建）
const SEED_MARK = '[smoke-seed]';
const seedReports = db.prepare(
  'SELECT id, category, detail FROM reports WHERE detail LIKE ?'
).all(`${SEED_MARK}%`);

console.log(`模式: ${APPLY ? '实际删除' : 'DRY-RUN（只预览，不改动）'}\n`);
console.log(`待删测试用户 ${smokeUsers.length} 个:`);
for (const u of smokeUsers) console.log(`  #${u.id} ${u.nickname}`);
console.log(`待删测试管理员 ${smokeAdmins.length} 个: ${smokeAdmins.map((a) => a.username).join(', ') || '（无）'}`);
console.log(`待删冒烟审计日志 ${smokeAudit} 条`);
console.log(`待删种子举报 ${seedReports.length} 条: ${seedReports.map((r) => `#${r.id}`).join(', ') || '（无）'}\n`);

// 安全护栏：绝不误删真实账号
const PROTECTED = ['小苏', '小鸡', '烨', '测试账号', '苏培基'];
const clash = smokeUsers.filter((u) => PROTECTED.includes(u.nickname));
console.log(`安全校验：待删列表中不含受保护账号 → ${clash.length === 0 ? '通过' : '异常，已中止'}`);
if (clash.length) process.exit(1);
const guard = db.prepare("SELECT COUNT(*) AS n FROM users WHERE nickname LIKE 'smoke%'").get()?.n;
if (guard !== smokeUsers.length) { console.log('计数不一致，已中止'); process.exit(1); }

if (!APPLY) {
  console.log('\n未做任何改动。确认无误后执行： node scripts/cleanup-smoke-data.mjs --apply');
  process.exit(0);
}

function deleteUserDeep(uid) {
  const tables = [
    ['sessions', 'user_id'], ['friends', 'user_id'], ['friends', 'friend_id'],
    ['moment_likes', 'user_id'], ['moment_comments', 'user_id'], ['moment_visitors', 'visitor_id'],
    ['chat_reads', 'user_id'], ['chat_prefs', 'user_id'], ['favorites', 'user_id'],
    ['password_resets', 'user_id'], ['login_history', 'user_id'],
    ['group_announcement_reads', 'user_id'], ['group_join_requests', 'user_id'],
    ['cloud_backups', 'user_id'], ['feedback', 'user_id'], ['reports', 'reporter_id'],
    ['group_members', 'user_id'], ['tags', 'user_id'], ['tag_members', 'user_id'],
    ['user_cards', 'user_id'], ['oa_follows', 'user_id'],
    ['friend_requests', 'from_id'], ['friend_requests', 'to_id'],
  ];
  for (const [t, c] of tables) {
    try { db.prepare(`DELETE FROM ${t} WHERE ${c} = ?`).run(uid); } catch { /* ignore */ }
  }
  try { db.prepare('DELETE FROM moments WHERE user_id = ?').run(uid); } catch { /* ignore */ }
  try { db.prepare('UPDATE groups SET owner_id = NULL WHERE owner_id = ?').run(uid); } catch { /* ignore */ }
  db.prepare('DELETE FROM users WHERE id = ?').run(uid);
}

db.exec('BEGIN');
try {
  for (const u of smokeUsers) deleteUserDeep(u.id);
  for (const a of smokeAdmins) {
    db.prepare('DELETE FROM admin_sessions WHERE admin_id = ?').run(a.id);
    db.prepare('DELETE FROM admin_accounts WHERE id = ?').run(a.id);
  }
  const auditDel = db.prepare(
    "DELETE FROM admin_audit_logs WHERE detail LIKE '%冒烟%' OR admin_name LIKE 'smoke\\_%' ESCAPE '\\'"
  ).run();
  let reportDel = { changes: 0 };
  if (seedReports.length) {
    reportDel = db.prepare('DELETE FROM reports WHERE detail LIKE ?').run(`${SEED_MARK}%`);
  }
  db.exec('COMMIT');
  console.log(`\n已删除：用户 ${smokeUsers.length}、管理员 ${smokeAdmins.length}、审计日志 ${auditDel.changes}、种子举报 ${reportDel.changes}`);
} catch (e) {
  db.exec('ROLLBACK');
  console.error('回滚：', e.message);
  process.exit(1);
}

console.log('剩余用户数:', db.prepare('SELECT COUNT(*) AS n FROM users').get().n);
console.log('剩余管理员:', db.prepare('SELECT username, role FROM admin_accounts').all().map((a) => a.username).join(', '));
