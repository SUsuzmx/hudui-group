// 后台管理员密码重置（离线直连数据库）。
// 用途：忘记后台密码、或唯一的超管被锁在门外时的自救工具。
//
// 用法：
//   node scripts/admin-reset-password.mjs                      # 列出所有后台账号
//   node scripts/admin-reset-password.mjs <用户名> <新密码>      # 重置指定账号
//
// 注意：重置会同时踢掉该账号所有后台会话。
import crypto from 'node:crypto';
import { db } from '../server/db.js';

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

const [username, password] = process.argv.slice(2);

const accounts = db.prepare(
  'SELECT id, username, display_name, role, status, last_login_at FROM admin_accounts ORDER BY id'
).all();

if (!username) {
  console.log('后台管理员账号：\n');
  if (!accounts.length) {
    console.log('  （无）—— 重启服务会自动初始化（迁移旧平台管理员或生成 admin 账号）');
  }
  for (const a of accounts) {
    const last = a.last_login_at
      ? new Date(Number(a.last_login_at)).toLocaleString('zh-CN', { hour12: false })
      : '从未登录';
    console.log(`  #${a.id}  ${a.username.padEnd(16)} ${a.role.padEnd(9)} ${a.status.padEnd(8)} 最近登录: ${last}`);
  }
  console.log('\n重置密码： node scripts/admin-reset-password.mjs <用户名> <新密码>');
  process.exit(0);
}

if (!password) {
  console.error('请同时提供新密码： node scripts/admin-reset-password.mjs <用户名> <新密码>');
  process.exit(1);
}

const strict = String(password).length >= 8
  && /[a-zA-Z]/.test(password) && /[0-9]/.test(password);
if (!strict) {
  console.warn('警告：新密码不满足后台校验规则（建议 ≥8 位且同时含字母和数字）。');
  console.warn('      离线重置会直接写入，登录可用，但改密页面会要求更强密码。');
}

const target = db.prepare('SELECT * FROM admin_accounts WHERE username = ? COLLATE NOCASE')
  .get(String(username).trim());
if (!target) {
  console.error(`找不到管理员账号：${username}`);
  console.error('现有账号：' + accounts.map((a) => a.username).join(', '));
  process.exit(1);
}

db.prepare('UPDATE admin_accounts SET password_hash = ?, updated_at = ? WHERE id = ?')
  .run(hashPassword(password), Date.now(), target.id);

const kicked = db.prepare('DELETE FROM admin_sessions WHERE admin_id = ?').run(target.id).changes;

db.prepare(
  `INSERT INTO admin_audit_logs
     (admin_id, admin_name, module, action, target_type, target_id, detail, ip, created_at)
   VALUES (?, ?, 'auth', 'offline-reset-password', 'admin', ?, ?, 'cli', ?)`
).run(
  target.id, target.username, String(target.id),
  `通过 CLI 离线重置密码，踢下线 ${kicked} 个会话`, Date.now()
);

console.log(`✓ 已重置 ${target.username}（${target.role}）的密码`);
console.log(`  踢下线会话: ${kicked}`);
console.log('  请用新密码登录后台，登录后建议立即在「我的账号」再改一次。');
