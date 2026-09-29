import fs from 'node:fs';

const p = 'server/migrate.js';
let c = fs.readFileSync(p, 'utf8');

const pairs = [
  [
    `CREATE TABLE IF NOT EXISTS transfers (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          message_id  INTEGER,
          from_id     INTEGER NOT NULL,
          to_id       INTEGER,
          amount      REAL NOT NULL,
          note        TEXT NOT NULL DEFAULT '',
          status      TEXT NOT NULL DEFAULT 'pending',
          claimed_at  INTEGER,
          created_at  INTEGER NOT NULL
        );`,
    `CREATE TABLE IF NOT EXISTS transfers (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          message_id  INTEGER,
          from_id     INTEGER NOT NULL,
          to_conv     TEXT NOT NULL,
          to_user_id  INTEGER,
          amount      REAL NOT NULL,
          note        TEXT NOT NULL DEFAULT '',
          status      TEXT NOT NULL DEFAULT 'pending',
          created_at  INTEGER NOT NULL
        );`,
  ],
  [
    `CREATE TABLE IF NOT EXISTS chat_prefs (
          user_id         INTEGER NOT NULL,
          conversation_id TEXT NOT NULL,
          muted           INTEGER NOT NULL DEFAULT 0,
          pinned          INTEGER NOT NULL DEFAULT 0,
          folded          INTEGER NOT NULL DEFAULT 0,
          draft           TEXT NOT NULL DEFAULT '',
          bg_key          TEXT,
          updated_at      INTEGER NOT NULL,
          PRIMARY KEY (user_id, conversation_id)
        );`,
    `CREATE TABLE IF NOT EXISTS chat_prefs (
          user_id         INTEGER NOT NULL,
          conversation_id TEXT NOT NULL,
          muted           INTEGER NOT NULL DEFAULT 0,
          pinned          INTEGER NOT NULL DEFAULT 0,
          folded          INTEGER NOT NULL DEFAULT 0,
          draft           TEXT NOT NULL DEFAULT '',
          bg_key          TEXT,
          cleared_before  INTEGER NOT NULL DEFAULT 0,
          updated_at      INTEGER NOT NULL,
          PRIMARY KEY (user_id, conversation_id)
        );`,
  ],
  [
    `CREATE TABLE IF NOT EXISTS favorites (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id    INTEGER NOT NULL,
          kind       TEXT NOT NULL DEFAULT 'text',
          content    TEXT NOT NULL DEFAULT '',
          media_url  TEXT,
          ref_id     INTEGER,
          created_at INTEGER NOT NULL
        );`,
    `CREATE TABLE IF NOT EXISTS favorites (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id     INTEGER NOT NULL,
          kind        TEXT NOT NULL DEFAULT 'text',
          content     TEXT NOT NULL DEFAULT '',
          media_url   TEXT,
          from_name   TEXT,
          created_at  INTEGER NOT NULL
        );`,
  ],
  [`avatar     TEXT NOT NULL DEFAULT '',`, `avatar     TEXT,`],
  [`nickname    TEXT NOT NULL DEFAULT '',`, `nickname    TEXT NOT NULL,`],
];

let n = 0;
for (const [from, to] of pairs) {
  if (c.includes(from)) {
    c = c.replace(from, to);
    n++;
  } else {
    console.log('NOT FOUND:', from.slice(0, 60).replace(/\n/g, ' '));
  }
}
fs.writeFileSync(p, c, 'utf8');
console.log('applied', n, 'schema fixes');
