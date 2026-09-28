// 版本化数据库迁移：schema_migrations 记录已应用版本。
// 已有库自动兼容：列已存在时跳过，不会重复 ALTER。
// 用法：runMigrations(db) — db 由调用方注入，避免循环依赖。

function columnExists(db, table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some((c) => c.name === column);
}

function addColumnIfMissing(db, table, column, ddl) {
  if (!columnExists(db, table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
}

function createIndex(db, sql) {
  db.exec(sql);
}

/** 迁移列表：id 单调递增，不可改写已发布条目 */
const migrations = [
  {
    id: 1,
    name: 'base_schema',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          nickname     TEXT NOT NULL UNIQUE COLLATE NOCASE,
          password_hash TEXT NOT NULL,
          avatar_color TEXT NOT NULL,
          created_at   INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sessions (
          token      TEXT PRIMARY KEY,
          user_id    INTEGER NOT NULL REFERENCES users(id),
          created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS messages (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          sender_type TEXT NOT NULL,
          sender_id   INTEGER,
          sender_name TEXT NOT NULL,
          avatar      TEXT NOT NULL,
          content     TEXT NOT NULL,
          created_at  INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_messages_id ON messages(id);
        CREATE TABLE IF NOT EXISTS friends (
          user_id    INTEGER NOT NULL,
          friend_id  INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (user_id, friend_id)
        );
        CREATE TABLE IF NOT EXISTS moments (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id    INTEGER NOT NULL,
          content    TEXT NOT NULL DEFAULT '',
          images     TEXT NOT NULL DEFAULT '[]',
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_moments_user ON moments(user_id, id DESC);
        CREATE TABLE IF NOT EXISTS groups (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          name       TEXT NOT NULL,
          kind       TEXT NOT NULL DEFAULT 'custom',
          avatars    TEXT NOT NULL DEFAULT '[]',
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS moment_likes (
          moment_id  INTEGER NOT NULL,
          user_id    INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (moment_id, user_id)
        );
        CREATE TABLE IF NOT EXISTS moment_comments (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          moment_id  INTEGER NOT NULL,
          user_id    INTEGER NOT NULL,
          content    TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS red_packets (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          message_id  INTEGER,
          from_id     INTEGER NOT NULL,
          to_conv     TEXT NOT NULL,
          amount      REAL NOT NULL,
          note        TEXT NOT NULL DEFAULT '恭喜发财',
          status      TEXT NOT NULL DEFAULT 'pending',
          claimed_by  INTEGER,
          claimed_at  INTEGER,
          created_at  INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS transfers (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          message_id  INTEGER,
          from_id     INTEGER NOT NULL,
          to_conv     TEXT NOT NULL,
          to_user_id  INTEGER,
          amount      REAL NOT NULL,
          note        TEXT NOT NULL DEFAULT '',
          status      TEXT NOT NULL DEFAULT 'pending',
          created_at  INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS chat_prefs (
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
        );
        CREATE TABLE IF NOT EXISTS chat_reads (
          user_id        INTEGER NOT NULL,
          conversation_id TEXT NOT NULL,
          last_read_id   INTEGER NOT NULL DEFAULT 0,
          unread         INTEGER NOT NULL DEFAULT 0,
          updated_at     INTEGER NOT NULL,
          PRIMARY KEY (user_id, conversation_id)
        );
        CREATE TABLE IF NOT EXISTS friend_requests (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          from_id    INTEGER NOT NULL,
          to_id      INTEGER NOT NULL,
          message    TEXT NOT NULL DEFAULT '',
          status     TEXT NOT NULL DEFAULT 'pending',
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS tags (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id    INTEGER NOT NULL,
          name       TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS tag_members (
          tag_id  INTEGER NOT NULL,
          user_id INTEGER NOT NULL,
          PRIMARY KEY (tag_id, user_id)
        );
        CREATE TABLE IF NOT EXISTS favorites (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id     INTEGER NOT NULL,
          kind        TEXT NOT NULL DEFAULT 'text',
          content     TEXT NOT NULL DEFAULT '',
          media_url   TEXT,
          from_name   TEXT,
          created_at  INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS official_accounts (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          name       TEXT NOT NULL,
          intro      TEXT NOT NULL DEFAULT '',
          avatar     TEXT,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS oa_follows (
          user_id    INTEGER NOT NULL,
          oa_id      INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (user_id, oa_id)
        );
        CREATE TABLE IF NOT EXISTS group_members (
          group_id    INTEGER NOT NULL,
          user_id     INTEGER,
          persona_key TEXT,
          nickname    TEXT NOT NULL,
          role        TEXT NOT NULL DEFAULT 'member',
          created_at  INTEGER NOT NULL,
          UNIQUE(group_id, user_id, persona_key)
        );
        CREATE TABLE IF NOT EXISTS user_cards (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id    INTEGER NOT NULL,
          kind       TEXT NOT NULL DEFAULT 'member',
          title      TEXT NOT NULL,
          subtitle   TEXT NOT NULL DEFAULT '',
          color      TEXT NOT NULL DEFAULT '#07c160',
          created_at INTEGER NOT NULL
        );
      `);
    },
  },
  {
    id: 2,
    name: 'users_profile_and_wallet',
    up(db) {
      addColumnIfMissing(db, 'users', 'avatar', 'TEXT');
      addColumnIfMissing(db, 'users', 'wxid', 'TEXT');
      addColumnIfMissing(db, 'users', 'region', 'TEXT');
      addColumnIfMissing(db, 'users', 'signature', 'TEXT');
      addColumnIfMissing(db, 'users', 'moments_cover', 'TEXT');
      addColumnIfMissing(db, 'users', 'gender', "TEXT DEFAULT ''");
      addColumnIfMissing(db, 'users', 'settings', "TEXT DEFAULT '{}'");
      addColumnIfMissing(db, 'users', 'status_json', 'TEXT');
      addColumnIfMissing(db, 'users', 'balance', 'REAL NOT NULL DEFAULT 100');
    },
  },
  {
    id: 3,
    name: 'messages_media_quote',
    up(db) {
      addColumnIfMissing(db, 'messages', 'media_type', 'TEXT');
      addColumnIfMissing(db, 'messages', 'media_url', 'TEXT');
      addColumnIfMissing(db, 'messages', 'conversation_id', 'TEXT');
      addColumnIfMissing(db, 'messages', 'quote_id', 'INTEGER');
      addColumnIfMissing(db, 'messages', 'quote_name', 'TEXT');
      addColumnIfMissing(db, 'messages', 'quote_content', 'TEXT');
      addColumnIfMissing(db, 'messages', 'recalled', 'INTEGER DEFAULT 0');
      addColumnIfMissing(db, 'messages', 'ext', 'TEXT');
      createIndex(db, 'CREATE INDEX IF NOT EXISTS idx_messages_conv_id ON messages(conversation_id, id DESC)');
    },
  },
  {
    id: 4,
    name: 'moments_visibility_comments',
    up(db) {
      addColumnIfMissing(db, 'moment_comments', 'reply_to_id', 'INTEGER');
      addColumnIfMissing(db, 'moment_comments', 'reply_to_name', 'TEXT');
      addColumnIfMissing(db, 'moment_comments', 'persona_key', 'TEXT');
      addColumnIfMissing(db, 'moment_likes', 'persona_key', 'TEXT');
      addColumnIfMissing(db, 'moments', 'visibility', "TEXT DEFAULT 'public'");
      addColumnIfMissing(db, 'moments', 'visible_to', 'TEXT');
    },
  },
  {
    id: 5,
    name: 'friends_and_chat_prefs',
    up(db) {
      addColumnIfMissing(db, 'friends', 'remark', 'TEXT');
      addColumnIfMissing(db, 'friends', 'blacklisted', 'INTEGER DEFAULT 0');
      addColumnIfMissing(db, 'friends', 'permission', 'TEXT');
      addColumnIfMissing(db, 'chat_prefs', 'extra', 'TEXT');
      addColumnIfMissing(db, 'chat_prefs', 'cleared_before', 'INTEGER NOT NULL DEFAULT 0');
      addColumnIfMissing(db, 'groups', 'notice', "TEXT NOT NULL DEFAULT ''");
      addColumnIfMissing(db, 'transfers', 'to_user_id', 'INTEGER');
    },
  },
  {
    id: 6,
    name: 'red_packet_details',
    up(db) {
      addColumnIfMissing(db, 'red_packets', 'rp_type', "TEXT DEFAULT 'exclusive'");
      addColumnIfMissing(db, 'red_packets', 'total_amount', 'REAL');
      addColumnIfMissing(db, 'red_packets', 'total_count', 'INTEGER DEFAULT 1');
      addColumnIfMissing(db, 'red_packets', 'claimed_count', 'INTEGER DEFAULT 0');
      addColumnIfMissing(db, 'red_packets', 'remaining', 'REAL');
      addColumnIfMissing(db, 'red_packets', 'cover', "TEXT DEFAULT 'classic'");
      addColumnIfMissing(db, 'red_packets', 'expired_at', 'INTEGER');
      addColumnIfMissing(db, 'red_packets', 'best_amount', 'REAL');
      addColumnIfMissing(db, 'red_packets', 'best_user_id', 'INTEGER');
      db.exec(`
        CREATE TABLE IF NOT EXISTS red_packet_claims (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          packet_id  INTEGER NOT NULL,
          user_id    INTEGER NOT NULL,
          nickname   TEXT NOT NULL DEFAULT '',
          amount     REAL NOT NULL,
          is_best    INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL
        )
      `);
      createIndex(db, 'CREATE INDEX IF NOT EXISTS idx_rp_claims_packet ON red_packet_claims(packet_id, id)');
    },
  },
  {
    id: 7,
    name: 'wallet_look_and_indexes',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS wallet_tx (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id       INTEGER NOT NULL,
          type          TEXT NOT NULL,
          amount        REAL NOT NULL,
          balance_after REAL NOT NULL,
          note          TEXT NOT NULL DEFAULT '',
          peer_id       INTEGER,
          ref_type      TEXT,
          ref_id        INTEGER,
          created_at    INTEGER NOT NULL
        )
      `);
      createIndex(db, 'CREATE INDEX IF NOT EXISTS idx_wallet_tx_user ON wallet_tx(user_id, id DESC)');
      db.exec(`
        CREATE TABLE IF NOT EXISTS look_posts (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id    INTEGER NOT NULL,
          title      TEXT NOT NULL DEFAULT '',
          media_url  TEXT NOT NULL,
          cover_url  TEXT NOT NULL DEFAULT '',
          author     TEXT NOT NULL DEFAULT '',
          likes      INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL
        )
      `);
      createIndex(db, 'CREATE INDEX IF NOT EXISTS idx_look_posts_user ON look_posts(user_id, id DESC)');
      createIndex(db, 'CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)');
      createIndex(db, 'CREATE INDEX IF NOT EXISTS idx_friend_requests_to ON friend_requests(to_id, status)');
    },
  },
];

export function runMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    )
  `);
  const applied = new Set(
    db.prepare('SELECT id FROM schema_migrations').all().map((r) => r.id)
  );
  const ran = [];
  for (const m of migrations) {
    if (applied.has(m.id)) continue;
    db.exec('BEGIN');
    try {
      m.up(db);
      db.prepare('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)')
        .run(m.id, m.name, Date.now());
      db.exec('COMMIT');
      ran.push(m.name);
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch { /* ignore */ }
      throw new Error(`migration ${m.id} (${m.name}) failed: ${err.message}`);
    }
  }
  return ran;
}

export function appliedMigrations(db) {
  try {
    return db.prepare('SELECT id, name, applied_at FROM schema_migrations ORDER BY id').all();
  } catch {
    return [];
  }
}
