// Web Push：应用关闭后仍可收到新消息（需 HTTPS/localhost + 用户授权）
import fs from 'node:fs';
import path from 'node:path';
import webpush from 'web-push';
import { ROOT, db } from './db.js';

const DATA_DIR = path.join(ROOT, 'data');
const VAPID_FILE = path.join(DATA_DIR, 'vapid.json');
const SUB_FILE = path.join(DATA_DIR, 'push-subscriptions.json');

function ensureTables() {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        endpoint TEXT NOT NULL UNIQUE,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        user_agent TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  } catch { /* ignore */ }
}
ensureTables();

function loadOrCreateVapid() {
  try {
    if (fs.existsSync(VAPID_FILE)) {
      const j = JSON.parse(fs.readFileSync(VAPID_FILE, 'utf8'));
      if (j?.publicKey && j?.privateKey) return j;
    }
  } catch { /* regenerate */ }
  const keys = webpush.generateVAPIDKeys();
  const pair = {
    publicKey: keys.publicKey,
    privateKey: keys.privateKey,
    subject: 'mailto:hudui@localhost',
  };
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(VAPID_FILE, JSON.stringify(pair, null, 2));
  } catch { /* ignore */ }
  return pair;
}

const vapid = loadOrCreateVapid();
try {
  webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
} catch { /* ignore */ }

/** 公钥给前端订阅用 */
export function pushPublicKey() {
  return vapid.publicKey;
}

export function isPushReady() {
  return Boolean(vapid?.publicKey && vapid?.privateKey);
}

function saveSubFallback(userId, sub) {
  // 数据库不可用时退到文件，避免推送订阅丢失
  try {
    let all = [];
    if (fs.existsSync(SUB_FILE)) all = JSON.parse(fs.readFileSync(SUB_FILE, 'utf8'));
    if (!Array.isArray(all)) all = [];
    all = all.filter((s) => s.endpoint !== sub.endpoint);
    all.push({ userId, ...sub, updatedAt: Date.now() });
    fs.writeFileSync(SUB_FILE, JSON.stringify(all.slice(-200), null, 2));
  } catch { /* ignore */ }
}

export function saveSubscription(userId, subscription) {
  const endpoint = String(subscription?.endpoint || '').slice(0, 500);
  const p256dh = String(subscription?.keys?.p256dh || '').slice(0, 200);
  const auth = String(subscription?.keys?.auth || '').slice(0, 200);
  if (!endpoint || !p256dh || !auth) return { error: '订阅数据不完整' };
  const now = Date.now();
  try {
    db.prepare(`
      INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET
        user_id = excluded.user_id,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        user_agent = excluded.user_agent,
        updated_at = excluded.updated_at
    `).run(Number(userId), endpoint, p256dh, auth, null, now, now);
    return { ok: true };
  } catch {
    saveSubFallback(userId, { endpoint, keys: { p256dh, auth } });
    return { ok: true, fallback: true };
  }
}

export function removeSubscription(endpoint) {
  const ep = String(endpoint || '').slice(0, 500);
  if (!ep) return { ok: false };
  try {
    db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(ep);
  } catch { /* ignore */ }
  try {
    if (fs.existsSync(SUB_FILE)) {
      const all = JSON.parse(fs.readFileSync(SUB_FILE, 'utf8'));
      fs.writeFileSync(SUB_FILE, JSON.stringify((all || []).filter((s) => s.endpoint !== ep), null, 2));
    }
  } catch { /* ignore */ }
  return { ok: true };
}

function listSubsForUser(userId) {
  const rows = [];
  try {
    rows.push(...(db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(Number(userId)) || []));
  } catch { /* ignore */ }
  try {
    if (fs.existsSync(SUB_FILE)) {
      const all = JSON.parse(fs.readFileSync(SUB_FILE, 'utf8')) || [];
      for (const s of all) {
        if (Number(s.userId) === Number(userId)) {
          rows.push({
            endpoint: s.endpoint,
            p256dh: s.keys?.p256dh || s.p256dh,
            auth: s.keys?.auth || s.auth,
          });
        }
      }
    }
  } catch { /* ignore */ }
  const seen = new Set();
  return rows.filter((r) => {
    if (!r?.endpoint || seen.has(r.endpoint)) return false;
    seen.add(r.endpoint);
    return true;
  });
}

/**
 * 向用户所有订阅设备推送
 * payload: { title, body, tag, url, conversationId, kind }
 */
export async function pushToUser(userId, payload = {}) {
  if (!isPushReady() || !userId) return { sent: 0 };
  const subs = listSubsForUser(userId);
  if (!subs.length) return { sent: 0 };
  const body = JSON.stringify({
    title: payload.title || '微信',
    body: payload.body || '',
    tag: payload.tag || `msg-${payload.conversationId || 'default'}`,
    url: payload.url || '/',
    conversationId: payload.conversationId || null,
    kind: payload.kind || 'message',
    at: Date.now(),
  });
  let sent = 0;
  await Promise.all(subs.map(async (row) => {
    const sub = {
      endpoint: row.endpoint,
      keys: { p256dh: row.p256dh, auth: row.auth },
    };
    try {
      const res = await webpush.sendNotification(sub, body, {
        TTL: 3600,
        urgency: 'normal',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res?.statusCode === 201 || res?.statusCode === 200) sent += 1;
    } catch (e) {
      const code = e?.statusCode || e?.status;
      if (code === 404 || code === 410) {
        removeSubscription(row.endpoint);
      }
    }
  }));
  return { sent };
}

/** 探测：是否已配置 Web Push */
export function pushStatus() {
  return {
    ready: isPushReady(),
    publicKey: pushPublicKey(),
  };
}
