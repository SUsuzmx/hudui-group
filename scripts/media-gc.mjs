// 媒体 GC：扫描 DB 中 /media/ 引用，找出 data/media 下的孤儿文件。
// 默认 dry-run；加 --delete 才真正删除。demo/ 目录永远保留。
// 用法: node scripts/media-gc.mjs [--delete] [--json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const MEDIA_DIR = path.join(ROOT, 'data', 'media');
const DB_PATH = path.join(ROOT, 'data', 'chat.db');
const DELETE = process.argv.includes('--delete');
const AS_JSON = process.argv.includes('--json');
// 默认只清 7 天前的孤儿文件，避免误删刚上传但引用尚未落库的
const MIN_AGE_DAYS = (() => {
  const i = process.argv.indexOf('--min-age-days');
  if (i >= 0 && process.argv[i + 1]) return Number(process.argv[i + 1]) || 0;
  return 7;
})();

function collectRefs(db) {
  const refs = new Set();
  const addFromValue = (v) => {
    if (typeof v !== 'string' || !v) return;
    for (const m of v.matchAll(/\/media\/([^"'\\s)?,#]+)/g)) {
      refs.add(decodeURIComponent(m[1]));
    }
  };
  const scan = (sql) => {
    try {
      for (const row of db.prepare(sql).all()) {
        for (const v of Object.values(row)) addFromValue(v);
      }
    } catch (err) {
      console.error('scan failed:', sql.slice(0, 50), err.message);
    }
  };
  scan('SELECT media_url, ext, content, avatar FROM messages');
  scan('SELECT images, content FROM moments');
  scan('SELECT media_url, cover_url FROM look_posts');
  scan('SELECT avatar, moments_cover, status_json, settings FROM users');
  scan('SELECT media_url, content FROM favorites');
  // 通用兜底：扫所有表的 TEXT 列
  try {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((r) => r.name);
    for (const t of tables) {
      const cols = db.prepare(`PRAGMA table_info(${t})`).all();
      const textCols = cols.filter((c) => /TEXT|CLOB|BLOB/i.test(c.type || '') || c.type === '').map((c) => c.name);
      if (!textCols.length) continue;
      scan(`SELECT ${textCols.map((c) => `"${c}"`).join(', ')} FROM "${t}"`);
    }
  } catch { /* ignore */ }
  return refs;
}

function listFiles(dir) {
  const out = [];
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'demo') continue; // 演示素材永不清理
      out.push(...listFiles(p));
    } else {
      out.push(p);
    }
  }
  return out;
}

function fileSize(p) {
  try {
    return fs.statSync(p).size;
  } catch {
    return 0;
  }
}

function fileAgeDays(p) {
  try {
    return (Date.now() - fs.statSync(p).mtimeMs) / 86400000;
  } catch {
    return 0;
  }
}

function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.error('DB not found:', DB_PATH);
    process.exit(1);
  }
  if (!fs.existsSync(MEDIA_DIR)) {
    console.log('media dir missing, nothing to do');
    return;
  }
  const db = new DatabaseSync(DB_PATH);
  const refs = collectRefs(db);
  db.close();

  const files = listFiles(MEDIA_DIR);
  const orphans = [];
  let kept = 0;
  let orphanBytes = 0;
  for (const abs of files) {
    const rel = path.relative(MEDIA_DIR, abs).split(path.sep).join('/');
    const base = path.basename(abs);
    if (refs.has(base) || refs.has(rel) || refs.has(`/${base}`)) {
      kept++;
      continue;
    }
    const ageDays = fileAgeDays(abs);
    if (ageDays < MIN_AGE_DAYS) {
      kept++;
      continue;
    }
    const size = fileSize(abs);
    orphanBytes += size;
    orphans.push({ file: rel, bytes: size, ageDays: Math.floor(ageDays) });
  }

  if (AS_JSON) {
    console.log(JSON.stringify({ refs: refs.size, files: files.length, kept, orphans, orphanBytes, deleted: DELETE }, null, 2));
  } else {
    console.log(`refs=${refs.size} files=${files.length} kept=${kept} orphans=${orphans.length} orphanMB=${(orphanBytes / 1024 / 1024).toFixed(1)}`);
    for (const o of orphans.slice(0, 20)) {
      console.log(`  ${o.file} (${(o.bytes / 1024).toFixed(0)}KB)`);
    }
    if (orphans.length > 20) console.log(`  ... and ${orphans.length - 20} more`);
  }

  if (!DELETE) {
    console.log('dry-run only. pass --delete to remove orphans.');
    return;
  }
  let deleted = 0;
  for (const o of orphans) {
    try {
      fs.rmSync(path.join(MEDIA_DIR, o.file), { force: true });
      deleted++;
    } catch { /* ignore */ }
  }
  console.log(`deleted ${deleted} orphan files (${(orphanBytes / 1024 / 1024).toFixed(1)}MB)`);
}

main();
