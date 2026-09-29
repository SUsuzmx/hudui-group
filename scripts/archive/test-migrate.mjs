import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { runMigrations, appliedMigrations } from '../server/migrate.js';

const dir = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'migtest-'));
const dbPath = path.join(dir, 'chat.db');
console.log('db:', dbPath);

const db = new DatabaseSync(dbPath);
const ran = runMigrations(db);
console.log('ran:', ran.length ? ran.join(', ') : '(none)');
console.log('applied:', appliedMigrations(db).map((m) => `${m.id}:${m.name}`).join(', '));

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r) => r.name);
console.log('tables:', tables.join(', '));
for (const t of ['users', 'messages', 'transfers', 'chat_prefs', 'favorites', 'red_packets']) {
  const cols = db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
  console.log(`${t}:`, cols.join(', '));
}

// 幂等：再跑一遍不应新增
const again = runMigrations(db);
console.log('second run applied:', again.length ? again.join(', ') : '(none — idempotent)');
db.close();
