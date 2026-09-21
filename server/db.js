import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DATA_DIR = path.join(ROOT, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'chat.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
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
    user_id         INTEGER NOT NULL,
    conversation_id TEXT NOT NULL,
    last_read_id    INTEGER NOT NULL DEFAULT 0,
    unread          INTEGER NOT NULL DEFAULT 0,
    updated_at      INTEGER NOT NULL,
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
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    intro       TEXT NOT NULL DEFAULT '',
    avatar      TEXT,
    created_at  INTEGER NOT NULL
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

// 增量迁移: 已有库补新列
try { db.exec('ALTER TABLE users ADD COLUMN avatar TEXT'); } catch { /* 列已存在 */ }
try { db.exec('ALTER TABLE users ADD COLUMN wxid TEXT'); } catch { /* 列已存在 */ }
try { db.exec('ALTER TABLE users ADD COLUMN region TEXT'); } catch { /* 列已存在 */ }
try { db.exec('ALTER TABLE users ADD COLUMN signature TEXT'); } catch { /* 列已存在 */ }
try { db.exec("ALTER TABLE users ADD COLUMN moments_cover TEXT"); } catch { /* 列已存在 */ }
try { db.exec("ALTER TABLE users ADD COLUMN gender TEXT DEFAULT ''"); } catch { /* 列已存在 */ }
try { db.exec("ALTER TABLE users ADD COLUMN settings TEXT DEFAULT '{}'"); } catch { /* 列已存在 */ }
try { db.exec("ALTER TABLE users ADD COLUMN status_json TEXT"); } catch { /* 列已存在 */ }
try { db.exec("ALTER TABLE chat_prefs ADD COLUMN extra TEXT"); } catch { /* 列已存在 */ }
try { db.exec('ALTER TABLE messages ADD COLUMN media_type TEXT'); } catch { /* 列已存在 */ }
try { db.exec('ALTER TABLE messages ADD COLUMN media_url TEXT'); } catch { /* 列已存在 */ }
try { db.exec('ALTER TABLE messages ADD COLUMN conversation_id TEXT'); } catch { /* 列已存在 */ }
try { db.exec('ALTER TABLE messages ADD COLUMN quote_id INTEGER'); } catch { /* 列已存在 */ }
try { db.exec('ALTER TABLE messages ADD COLUMN quote_name TEXT'); } catch { /* 列已存在 */ }
try { db.exec('ALTER TABLE messages ADD COLUMN quote_content TEXT'); } catch { /* 列已存在 */ }
try { db.exec('ALTER TABLE messages ADD COLUMN recalled INTEGER DEFAULT 0'); } catch { /* 列已存在 */ }
try { db.exec('ALTER TABLE messages ADD COLUMN ext TEXT'); } catch { /* 列已存在 */ }
try { db.exec('ALTER TABLE moment_comments ADD COLUMN reply_to_id INTEGER'); } catch { /* 列已存在 */ }
try { db.exec('ALTER TABLE moment_comments ADD COLUMN reply_to_name TEXT'); } catch { /* 列已存在 */ }
try { db.exec('ALTER TABLE moments ADD COLUMN visibility TEXT DEFAULT \'public\''); } catch { /* 列已存在 */ }
try { db.exec('ALTER TABLE moments ADD COLUMN visible_to TEXT'); } catch { /* 列已存在 */ }
try { db.exec('ALTER TABLE friends ADD COLUMN remark TEXT'); } catch { /* 列已存在 */ }
try { db.exec('ALTER TABLE friends ADD COLUMN blacklisted INTEGER DEFAULT 0'); } catch { /* 列已存在 */ }
try { db.exec('ALTER TABLE friends ADD COLUMN permission TEXT'); } catch { /* 列已存在 */ }
try { db.exec('ALTER TABLE chat_prefs ADD COLUMN cleared_before INTEGER NOT NULL DEFAULT 0'); } catch { /* 列已存在 */ }
try { db.exec('ALTER TABLE groups ADD COLUMN notice TEXT NOT NULL DEFAULT \'\''); } catch { /* 列已存在 */ }
try { db.exec('ALTER TABLE transfers ADD COLUMN to_user_id INTEGER'); } catch { /* 列已存在 */ }
try { db.exec("ALTER TABLE moment_comments ADD COLUMN persona_key TEXT"); } catch { /* 列已存在 */ }
try { db.exec("ALTER TABLE moment_likes ADD COLUMN persona_key TEXT"); } catch { /* 列已存在 */ }
try { db.exec('ALTER TABLE users ADD COLUMN balance REAL NOT NULL DEFAULT 100'); } catch { /* 列已存在 */ }
// 红包细节字段
try { db.exec("ALTER TABLE red_packets ADD COLUMN rp_type TEXT DEFAULT 'exclusive'"); } catch { /* 列已存在 */ }
try { db.exec('ALTER TABLE red_packets ADD COLUMN total_amount REAL'); } catch { /* 列已存在 */ }
try { db.exec('ALTER TABLE red_packets ADD COLUMN total_count INTEGER DEFAULT 1'); } catch { /* 列已存在 */ }
try { db.exec('ALTER TABLE red_packets ADD COLUMN claimed_count INTEGER DEFAULT 0'); } catch { /* 列已存在 */ }
try { db.exec('ALTER TABLE red_packets ADD COLUMN remaining REAL'); } catch { /* 列已存在 */ }
try { db.exec("ALTER TABLE red_packets ADD COLUMN cover TEXT DEFAULT 'classic'"); } catch { /* 列已存在 */ }
try { db.exec('ALTER TABLE red_packets ADD COLUMN expired_at INTEGER'); } catch { /* 列已存在 */ }
try { db.exec('ALTER TABLE red_packets ADD COLUMN best_amount REAL'); } catch { /* 列已存在 */ }
try { db.exec('ALTER TABLE red_packets ADD COLUMN best_user_id INTEGER'); } catch { /* 列已存在 */ }
try { db.exec(`
  CREATE TABLE IF NOT EXISTS red_packet_claims (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    packet_id  INTEGER NOT NULL,
    user_id    INTEGER NOT NULL,
    nickname   TEXT NOT NULL DEFAULT '',
    amount     REAL NOT NULL,
    is_best    INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )
`); } catch { /* ignore */ }
try { db.exec('CREATE INDEX IF NOT EXISTS idx_rp_claims_packet ON red_packet_claims(packet_id, id)'); } catch { /* ignore */ }
try { db.exec(`
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
`); } catch { /* ignore */ }
try { db.exec('CREATE INDEX IF NOT EXISTS idx_wallet_tx_user ON wallet_tx(user_id, id DESC)'); } catch { /* ignore */ }
try { db.exec(`
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
`); } catch { /* ignore */ }
try { db.exec('CREATE INDEX IF NOT EXISTS idx_look_posts_user ON look_posts(user_id, id DESC)'); } catch { /* ignore */ }
try { db.exec('CREATE INDEX IF NOT EXISTS idx_messages_conv_id ON messages(conversation_id, id DESC)'); } catch { /* ignore */ }
try { db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)'); } catch { /* ignore */ }
try { db.exec('CREATE INDEX IF NOT EXISTS idx_friend_requests_to ON friend_requests(to_id, status)'); } catch { /* ignore */ }

export const stmts = {
  insertUser: db.prepare(
    'INSERT INTO users (nickname, password_hash, avatar_color, created_at, avatar, wxid, region, signature) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ),
  userByName: db.prepare('SELECT * FROM users WHERE nickname = ? COLLATE NOCASE'),
  userById: db.prepare('SELECT * FROM users WHERE id = ?'),
  setUserAvatar: db.prepare('UPDATE users SET avatar = ? WHERE id = ?'),
  setUserPassword: db.prepare('UPDATE users SET password_hash = ? WHERE id = ?'),
  setUserProfile: db.prepare(
    'UPDATE users SET nickname = ?, avatar = ?, wxid = ?, region = ?, signature = ? WHERE id = ?'
  ),
  searchUsers: db.prepare(
    'SELECT id, nickname, avatar_color, avatar, wxid FROM users WHERE nickname LIKE ? OR wxid LIKE ? LIMIT 20'
  ),
  insertSession: db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'),
  sessionByToken: db.prepare(
    `SELECT s.token, s.expires_at, u.id, u.nickname, u.avatar_color, u.avatar, u.wxid, u.region, u.signature,
            u.gender, u.moments_cover, u.status_json
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`
  ),
  deleteSession: db.prepare('DELETE FROM sessions WHERE token = ?'),
  listUserSessions: db.prepare('SELECT token FROM sessions WHERE user_id = ?'),
  deleteUserSessionsExcept: db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?'),
  deleteUserSessions: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
  insertMessage: db.prepare(
    'INSERT INTO messages (sender_type, sender_id, sender_name, avatar, content, created_at, media_type, media_url, conversation_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ),
  insertMessageQuote: db.prepare(
    'INSERT INTO messages (sender_type, sender_id, sender_name, avatar, content, created_at, media_type, media_url, conversation_id, quote_id, quote_name, quote_content) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ),
  recallMessage: db.prepare(
    "UPDATE messages SET sender_type='system', content=?, recalled=1, media_type=NULL, media_url=NULL, quote_id=NULL, quote_name=NULL, quote_content=NULL WHERE id=? AND sender_id=? AND sender_type='user'"
  ),
  messageById: db.prepare('SELECT * FROM messages WHERE id = ?'),
  recentMessages: db.prepare(
    'SELECT * FROM messages WHERE id < ? AND conversation_id IS NULL ORDER BY id DESC LIMIT ?'
  ),
  lastMessages: db.prepare(
    'SELECT * FROM messages WHERE conversation_id IS NULL ORDER BY id DESC LIMIT ?'
  ),
  lastMessage: db.prepare('SELECT * FROM messages WHERE conversation_id IS NULL ORDER BY id DESC LIMIT 1'),
  countMessages: db.prepare('SELECT COUNT(*) AS n FROM messages WHERE conversation_id IS NULL'),
  allUsers: db.prepare('SELECT id, nickname, avatar_color, avatar, wxid FROM users ORDER BY id'),
  privateMessages: db.prepare(
    'SELECT * FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?'
  ),
  privateMessagesBefore: db.prepare(
    'SELECT * FROM messages WHERE conversation_id = ? AND id < ? ORDER BY id DESC LIMIT ?'
  ),
  lastPrivateMessage: db.prepare(
    `SELECT conversation_id, MAX(created_at) as last_time,
      (SELECT id FROM messages m2 WHERE m2.conversation_id = messages.conversation_id ORDER BY id DESC LIMIT 1) as last_id,
      (SELECT content FROM messages m2 WHERE m2.conversation_id = messages.conversation_id ORDER BY id DESC LIMIT 1) as last_content,
      (SELECT media_type FROM messages m3 WHERE m3.conversation_id = messages.conversation_id ORDER BY id DESC LIMIT 1) as last_media
     FROM messages WHERE conversation_id LIKE ? ESCAPE '\\' GROUP BY conversation_id ORDER BY last_time DESC`
  ),
  // 好友
  getFriend: db.prepare('SELECT * FROM friends WHERE user_id = ? AND friend_id = ?'),
  addFriend: db.prepare('INSERT OR IGNORE INTO friends (user_id, friend_id, created_at) VALUES (?, ?, ?)'),
  removeFriend: db.prepare('DELETE FROM friends WHERE user_id = ? AND friend_id = ?'),
  setFriendRemark: db.prepare('UPDATE friends SET remark = ? WHERE user_id = ? AND friend_id = ?'),
  setFriendBlack: db.prepare('UPDATE friends SET blacklisted = ? WHERE user_id = ? AND friend_id = ?'),
  setFriendPermission: db.prepare('UPDATE friends SET permission = ? WHERE user_id = ? AND friend_id = ?'),
  listFriends: db.prepare(
    `SELECT u.id, u.nickname, u.avatar_color, u.avatar, u.wxid, f.created_at, f.remark, f.blacklisted, f.permission
     FROM friends f JOIN users u ON u.id = f.friend_id
     WHERE f.user_id = ? ORDER BY COALESCE(NULLIF(f.remark,''), u.nickname) COLLATE NOCASE`
  ),
  // 朋友圈
  insertMoment: db.prepare(
    'INSERT INTO moments (user_id, content, images, created_at) VALUES (?, ?, ?, ?)'
  ),
  momentById: db.prepare('SELECT * FROM moments WHERE id = ?'),
  deleteMoment: db.prepare('DELETE FROM moments WHERE id = ? AND user_id = ?'),
  listMoments: db.prepare(
    `SELECT m.*, u.nickname, u.avatar_color, u.avatar
     FROM moments m JOIN users u ON u.id = m.user_id
     ORDER BY m.id DESC LIMIT ?`
  ),
  listMomentsBefore: db.prepare(
    `SELECT m.*, u.nickname, u.avatar_color, u.avatar
     FROM moments m JOIN users u ON u.id = m.user_id
     WHERE m.id < ? ORDER BY m.id DESC LIMIT ?`
  ),
  listUserMoments: db.prepare(
    `SELECT m.*, u.nickname, u.avatar_color, u.avatar
     FROM moments m JOIN users u ON u.id = m.user_id
     WHERE m.user_id = ? ORDER BY m.id DESC LIMIT ?`
  ),
  // 多群
  allGroups: db.prepare('SELECT * FROM groups ORDER BY id'),
  groupById: db.prepare('SELECT * FROM groups WHERE id = ?'),
  groupByKind: db.prepare('SELECT * FROM groups WHERE kind = ? LIMIT 1'),
  insertGroup: db.prepare(
    'INSERT INTO groups (name, kind, avatars, created_at) VALUES (?, ?, ?, ?)'
  ),
  setGroupName: db.prepare('UPDATE groups SET name = ? WHERE id = ?'),
  insertGroupMember: db.prepare(`
    INSERT OR IGNORE INTO group_members (group_id, user_id, persona_key, nickname, role, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `),
  listGroupMembers: db.prepare(
    'SELECT * FROM group_members WHERE group_id = ? ORDER BY role DESC, nickname COLLATE NOCASE'
  ),
  deleteGroupMember: db.prepare(
    'DELETE FROM group_members WHERE group_id = ? AND ((user_id IS NOT NULL AND user_id = ?) OR (persona_key IS NOT NULL AND persona_key = ?))'
  ),
  deleteGroupMemberByUser: db.prepare(
    'DELETE FROM group_members WHERE group_id = ? AND user_id = ?'
  ),
  listUserCards: db.prepare(
    'SELECT * FROM user_cards WHERE user_id = ? ORDER BY id DESC'
  ),
  insertUserCard: db.prepare(
    'INSERT INTO user_cards (user_id, kind, title, subtitle, color, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ),
  deleteUserCard: db.prepare('DELETE FROM user_cards WHERE id = ? AND user_id = ?'),
  groupMessages: db.prepare(
    'SELECT * FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?'
  ),
  groupMessagesBefore: db.prepare(
    'SELECT * FROM messages WHERE conversation_id = ? AND id < ? ORDER BY id DESC LIMIT ?'
  ),
  lastGroupMessage: db.prepare(
    'SELECT * FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1'
  ),
  // 会话偏好 / 未读
  getChatPref: db.prepare(
    'SELECT * FROM chat_prefs WHERE user_id = ? AND conversation_id = ?'
  ),
  setClearedBefore: db.prepare(`
    INSERT INTO chat_prefs (user_id, conversation_id, muted, pinned, folded, draft, bg_key, cleared_before, updated_at)
    VALUES (?, ?, 0, 0, 0, '', NULL, ?, ?)
    ON CONFLICT(user_id, conversation_id) DO UPDATE SET
      cleared_before = excluded.cleared_before,
      updated_at = excluded.updated_at
  `),
  searchMessagesScoped: db.prepare(`
    SELECT m.* FROM messages m
    LEFT JOIN chat_prefs p
      ON p.conversation_id = m.conversation_id AND p.user_id = ?
    WHERE m.content LIKE ? AND m.recalled = 0
      AND (p.cleared_before IS NULL OR m.id > p.cleared_before)
      AND (
        m.conversation_id IS NULL
        OR m.conversation_id LIKE 'grp\\_%' ESCAPE '\\'
        OR m.conversation_id LIKE ? ESCAPE '\\'
        OR m.conversation_id LIKE ? ESCAPE '\\'
        OR m.conversation_id LIKE ? ESCAPE '\\'
      )
    ORDER BY m.id DESC LIMIT 30
  `),
  searchMessagesConv: db.prepare(`
    SELECT m.* FROM messages m
    LEFT JOIN chat_prefs p
      ON p.conversation_id = m.conversation_id AND p.user_id = ?
    WHERE m.conversation_id = ? AND m.content LIKE ? AND m.recalled = 0
      AND (p.cleared_before IS NULL OR m.id > p.cleared_before)
    ORDER BY m.id DESC LIMIT 30
  `),
  upsertChatPref: db.prepare(`
    INSERT INTO chat_prefs (user_id, conversation_id, muted, pinned, folded, draft, bg_key, extra, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, conversation_id) DO UPDATE SET
      muted = COALESCE(?, muted),
      pinned = COALESCE(?, pinned),
      folded = COALESCE(?, folded),
      draft = COALESCE(?, draft),
      bg_key = COALESCE(?, bg_key),
      extra = COALESCE(?, extra),
      updated_at = excluded.updated_at
  `),
  setUserSettings: db.prepare('UPDATE users SET settings = ? WHERE id = ?'),
  getUserSettingsRaw: db.prepare('SELECT settings FROM users WHERE id = ?'),
  getChatRead: db.prepare(
    'SELECT * FROM chat_reads WHERE user_id = ? AND conversation_id = ?'
  ),
  upsertChatRead: db.prepare(`
    INSERT INTO chat_reads (user_id, conversation_id, last_read_id, unread, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id, conversation_id) DO UPDATE SET
      last_read_id = excluded.last_read_id,
      unread = excluded.unread,
      updated_at = excluded.updated_at
  `),
  incrChatUnread: db.prepare(`
    INSERT INTO chat_reads (user_id, conversation_id, last_read_id, unread, updated_at)
    VALUES (?, ?, 0, 1, ?)
    ON CONFLICT(user_id, conversation_id) DO UPDATE SET
      unread = unread + 1,
      updated_at = excluded.updated_at
  `),
  incrChatUnreadAll: db.prepare(`
    INSERT INTO chat_reads (user_id, conversation_id, last_read_id, unread, updated_at)
    SELECT id, ?, 0, 1, ? FROM users WHERE id != ?
    ON CONFLICT(user_id, conversation_id) DO UPDATE SET
      unread = unread + 1,
      updated_at = excluded.updated_at
  `),
  clearConvMessages: db.prepare(
    'DELETE FROM messages WHERE conversation_id = ?'
  ),
  clearConvMessagesNull: db.prepare(
    'DELETE FROM messages WHERE conversation_id IS NULL'
  ),
  maxMessageId: db.prepare(
    'SELECT MAX(id) AS mid FROM messages WHERE conversation_id = ?'
  ),
  maxMessageIdNull: db.prepare(
    'SELECT MAX(id) AS mid FROM messages WHERE conversation_id IS NULL'
  ),
  maxCountableMessage: db.prepare(
    `SELECT MAX(id) AS mid FROM messages
     WHERE conversation_id = ? AND sender_type IN ('user','ai') AND COALESCE(recalled,0)=0`
  ),
  maxCountableMessageNull: db.prepare(
    `SELECT MAX(id) AS mid FROM messages
     WHERE conversation_id IS NULL AND sender_type IN ('user','ai') AND COALESCE(recalled,0)=0`
  ),
  countUnread: db.prepare(
    `SELECT COUNT(*) AS n FROM messages
     WHERE conversation_id = ? AND id > ? AND sender_type IN ('user','ai') AND COALESCE(recalled,0)=0`
  ),
  countUnreadNull: db.prepare(
    `SELECT COUNT(*) AS n FROM messages
     WHERE conversation_id IS NULL AND id > ? AND sender_type IN ('user','ai') AND COALESCE(recalled,0)=0`
  ),
  // 好友申请
  insertFriendRequest: db.prepare(
    'INSERT INTO friend_requests (from_id, to_id, message, status, created_at) VALUES (?, ?, ?, ?, ?)'
  ),
  listFriendRequestsTo: db.prepare(
    `SELECT r.*, u.nickname, u.avatar, u.avatar_color, u.wxid
     FROM friend_requests r JOIN users u ON u.id = r.from_id
     WHERE r.to_id = ? ORDER BY r.id DESC LIMIT 50`
  ),
  listFriendRequestsFrom: db.prepare(
    `SELECT r.*, u.nickname, u.avatar, u.avatar_color, u.wxid
     FROM friend_requests r JOIN users u ON u.id = r.to_id
     WHERE r.from_id = ? ORDER BY r.id DESC LIMIT 50`
  ),
  updateFriendRequest: db.prepare(
    'UPDATE friend_requests SET status = ? WHERE id = ? AND to_id = ?'
  ),
  getFriendRequest: db.prepare(
    'SELECT * FROM friend_requests WHERE id = ?'
  ),
  // 标签
  insertTag: db.prepare('INSERT INTO tags (user_id, name, created_at) VALUES (?, ?, ?)'),
  listTags: db.prepare('SELECT * FROM tags WHERE user_id = ? ORDER BY id'),
  deleteTag: db.prepare('DELETE FROM tags WHERE id = ? AND user_id = ?'),
  insertTagMember: db.prepare('INSERT OR IGNORE INTO tag_members (tag_id, user_id) VALUES (?, ?)'),
  listTagMembers: db.prepare('SELECT user_id FROM tag_members WHERE tag_id = ?'),
  deleteTagMember: db.prepare('DELETE FROM tag_members WHERE tag_id = ? AND user_id = ?'),
  // 收藏
  insertFavorite: db.prepare(
    'INSERT INTO favorites (user_id, kind, content, media_url, from_name, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ),
  listFavorites: db.prepare(
    'SELECT * FROM favorites WHERE user_id = ? ORDER BY id DESC LIMIT 100'
  ),
  deleteFavorite: db.prepare('DELETE FROM favorites WHERE id = ? AND user_id = ?'),
  // 公众号
  listOfficial: db.prepare('SELECT * FROM official_accounts ORDER BY id'),
  insertOfficial: db.prepare(
    'INSERT INTO official_accounts (name, intro, avatar, created_at) VALUES (?, ?, ?, ?)'
  ),
  followOfficial: db.prepare(
    'INSERT OR IGNORE INTO oa_follows (user_id, oa_id, created_at) VALUES (?, ?, ?)'
  ),
  unfollowOfficial: db.prepare(
    'DELETE FROM oa_follows WHERE user_id = ? AND oa_id = ?'
  ),
  listOaFollows: db.prepare(
    `SELECT o.* FROM official_accounts o
     JOIN oa_follows f ON f.oa_id = o.id
     WHERE f.user_id = ? ORDER BY o.id`
  ),
  // 朋友圈互动已有 like/comment 语句
  likeMoment: db.prepare(
    'INSERT OR IGNORE INTO moment_likes (moment_id, user_id, created_at) VALUES (?, ?, ?)'
  ),
  unlikeMoment: db.prepare(
    'DELETE FROM moment_likes WHERE moment_id = ? AND user_id = ?'
  ),
  listMomentLikes: db.prepare(
    `SELECT l.user_id, l.created_at, u.nickname as uname
     FROM moment_likes l LEFT JOIN users u ON u.id = l.user_id
     WHERE l.moment_id = ? ORDER BY l.created_at ASC`
  ),
  insertMomentComment: db.prepare(
    'INSERT INTO moment_comments (moment_id, user_id, content, created_at, reply_to_id, reply_to_name, persona_key) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ),
  listMomentComments: db.prepare(
    `SELECT c.*, u.nickname as uname, u.avatar as uavatar, u.avatar_color as ucolor
     FROM moment_comments c LEFT JOIN users u ON u.id = c.user_id
     WHERE c.moment_id = ? ORDER BY c.id ASC`
  ),
  deleteMomentComment: db.prepare(
    'DELETE FROM moment_comments WHERE id = ? AND user_id = ?'
  ),
  getMomentComment: db.prepare('SELECT * FROM moment_comments WHERE id = ?'),
  insertMomentFull: db.prepare(
    'INSERT INTO moments (user_id, content, images, created_at, visibility, visible_to) VALUES (?, ?, ?, ?, ?, ?)'
  ),
  // 红包 / 转账
  insertRedPacket: db.prepare(
    `INSERT INTO red_packets
      (message_id, from_id, to_conv, amount, note, created_at,
       rp_type, total_amount, total_count, claimed_count, remaining, cover, expired_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
  ),
  getRedPacket: db.prepare('SELECT * FROM red_packets WHERE id = ?'),
  claimRedPacket: db.prepare(
    "UPDATE red_packets SET status='claimed', claimed_by=?, claimed_at=? WHERE id=? AND status='pending' AND from_id != ?"
  ),
  claimRedPacketLucky: db.prepare(
    `UPDATE red_packets SET
       claimed_count = claimed_count + 1,
       remaining = MAX(0, COALESCE(remaining, amount) - ?),
       status = CASE WHEN claimed_count + 1 >= COALESCE(total_count, 1) THEN 'claimed' ELSE status END,
       claimed_by = ?,
       claimed_at = ?
     WHERE id=? AND status='pending' AND from_id != ?`
  ),
  expireRedPacket: db.prepare(
    `UPDATE red_packets SET status = CASE
       WHEN COALESCE(claimed_count,0) >= COALESCE(total_count,1) THEN 'claimed'
       ELSE 'expired'
     END
     WHERE id=? AND status='pending'`
  ),
  insertRedPacketClaim: db.prepare(
    `INSERT INTO red_packet_claims (packet_id, user_id, nickname, amount, is_best, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ),
  listRedPacketClaims: db.prepare(
    `SELECT * FROM red_packet_claims WHERE packet_id = ? ORDER BY amount DESC, id ASC`
  ),
  hasRedPacketClaim: db.prepare(
    'SELECT * FROM red_packet_claims WHERE packet_id = ? AND user_id = ?'
  ),
  setRedPacketBest: db.prepare(
    'UPDATE red_packets SET best_amount=?, best_user_id=? WHERE id=?'
  ),
  listPendingPackets: db.prepare(
    "SELECT * FROM red_packets WHERE status='pending' AND expired_at IS NOT NULL AND expired_at < ? LIMIT 50"
  ),
  listPendingTransfers: db.prepare(
    "SELECT * FROM transfers WHERE status='pending' AND created_at < ? LIMIT 50"
  ),
  expireTransfer: db.prepare(
    "UPDATE transfers SET status='expired' WHERE id=? AND status='pending'"
  ),
  insertTransfer: db.prepare(
    'INSERT INTO transfers (message_id, from_id, to_conv, amount, note, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ),
  getTransfer: db.prepare('SELECT * FROM transfers WHERE id = ?'),
  updateMessageExt: db.prepare('UPDATE messages SET ext = ? WHERE id = ?'),
  setGroupNotice: db.prepare('UPDATE groups SET notice = ? WHERE id = ?'),
  getGroupNotice: db.prepare('SELECT notice FROM groups WHERE id = ?'),
  getUserBalance: db.prepare('SELECT balance FROM users WHERE id = ?'),
  setUserBalance: db.prepare('UPDATE users SET balance = ? WHERE id = ?'),
  insertWalletTx: db.prepare(
    'INSERT INTO wallet_tx (user_id, type, amount, balance_after, note, peer_id, ref_type, ref_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ),
  listWalletTx: db.prepare(
    'SELECT * FROM wallet_tx WHERE user_id = ? ORDER BY id DESC LIMIT 50'
  ),
  listMyRedPackets: db.prepare(
    `SELECT r.*, m.sender_name, m.conversation_id FROM red_packets r
     LEFT JOIN messages m ON m.id = r.message_id
     WHERE r.from_id = ? OR r.claimed_by = ?
     ORDER BY r.id DESC LIMIT 30`
  ),
  listMyTransfers: db.prepare(
    `SELECT t.*, m.sender_name, m.conversation_id FROM transfers t
     LEFT JOIN messages m ON m.id = t.message_id
     WHERE t.from_id = ? OR t.to_user_id = ?
     ORDER BY t.id DESC LIMIT 30`
  ),
  updateTransferTarget: db.prepare('UPDATE transfers SET to_user_id = ?, status = ? WHERE id = ?'),
  claimTransfer: db.prepare(
    "UPDATE transfers SET status='claimed', to_user_id=? WHERE id=? AND status='pending' AND from_id != ?"
  ),
  // 看一看 UGC
  insertLookPost: db.prepare(
    'INSERT INTO look_posts (user_id, title, media_url, cover_url, author, likes, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)'
  ),
  listLookPosts: db.prepare(`
    SELECT lp.*, u.nickname as uname, u.avatar as uavatar, u.avatar_color as ucolor
    FROM look_posts lp LEFT JOIN users u ON u.id = lp.user_id
    ORDER BY lp.id DESC LIMIT 80
  `),
  getLookPost: db.prepare('SELECT * FROM look_posts WHERE id = ?'),
  deleteLookPost: db.prepare('DELETE FROM look_posts WHERE id = ? AND user_id = ?'),
};
