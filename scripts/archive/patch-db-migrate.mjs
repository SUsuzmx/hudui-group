import fs from 'node:fs';

const p = 'server/db.js';
const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
const stmtsIdx = lines.findIndex((l) => l.includes('export const stmts'));
if (stmtsIdx < 0) {
  console.error('stmts not found');
  process.exit(1);
}

const header = `import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigrations } from './migrate.js';

export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DATA_DIR = path.join(ROOT, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'chat.db'));
db.exec('PRAGMA journal_mode = WAL;');

// 版本化迁移（表结构 + 增量列/索引），已有库自动跳过已存在列
const applied = runMigrations(db);
if (applied.length) {
  console.log('[db] migrations applied:', applied.join(', '));
}
`;

const rest = lines.slice(stmtsIdx).join('\n');
fs.writeFileSync(p, header + '\n' + rest + '\n', 'utf8');
console.log('db.js rewritten, stmts starts at', stmtsIdx + 1);
