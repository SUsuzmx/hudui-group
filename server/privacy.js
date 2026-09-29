// 隐私策略：把「设置 / 朋友权限」真正落到朋友圈、状态等展示场景
import { stmts } from './db.js';
import { isBlockedEither } from './friends.js';

/** 任一方向好友关系 */
export function areFriends(a, b) {
  const idA = Number(a);
  const idB = Number(b);
  if (!idA || !idB || idA === idB) return true;
  try {
    return Boolean(stmts.getFriend.get(idA, idB) || stmts.getFriend.get(idB, idA));
  } catch {
    return false;
  }
}

function parseIdList(raw) {
  if (!raw) return [];
  try {
    const arr = Array.isArray(raw) ? raw : JSON.parse(raw);
    return Array.isArray(arr) ? arr.map(Number).filter(Boolean) : [];
  } catch {
    return [];
  }
}

/** 读取用户隐私设置（settings JSON） */
export function privacySettingsOf(userId) {
  try {
    const r = stmts.getUserSettingsRaw.get(userId);
    const s = r?.settings ? JSON.parse(r.settings) : {};
    return {
      momentsPublic: s.momentsPublic !== false,
      strangerSee10: s.strangerSee10 === true,
      momentsRange: s.momentsRange || 'all',
      momentsHideFrom: parseIdList(s.momentsHideFrom),
      momentsHideThem: parseIdList(s.momentsHideThem),
    };
  } catch {
    return {
      momentsPublic: true,
      strangerSee10: false,
      momentsRange: 'all',
      momentsHideFrom: [],
      momentsHideThem: [],
    };
  }
}

/** 作者对「这个观看者」是否设置了「不让他看 / 仅聊天」 */
export function authorHidesFrom(authorId, viewerId) {
  const a = Number(authorId);
  const v = Number(viewerId);
  if (!a || !v || a === v) return false;
  try {
    const row = stmts.getFriend.get(a, v);
    if (row?.permission === 'hide-moments' || row?.permission === 'chat') return true;
    if (row?.permission === 'block' || row?.blacklisted) return true;
  } catch { /* ignore */ }
  const settings = privacySettingsOf(a);
  return settings.momentsHideFrom.includes(v);
}

/** 观看者是否主动屏蔽了作者（不看他） */
export function viewerHidesThem(viewerId, authorId) {
  const settings = privacySettingsOf(viewerId);
  return settings.momentsHideThem.includes(Number(authorId));
}

/** 朋友圈权限：陌生人是否允许查看（受 strangerSee10 / momentsPublic 约束） */
export function strangerCanSeeAuthorMoments(authorId) {
  const s = privacySettingsOf(authorId);
  if (!s.momentsPublic) return false;
  return s.strangerSee10;
}

/** 好友可见的时间范围（momentsRange: all | 3days | halfyear） */
export function withinMomentsRange(authorId, createdAt) {
  const s = privacySettingsOf(authorId);
  const range = s.momentsRange || 'all';
  if (range === 'all') return true;
  const at = Number(createdAt) || 0;
  if (!at) return true;
  const now = Date.now();
  if (range === '3days') return now - at <= 3 * 24 * 3600_000;
  if (range === 'halfyear') return now - at <= 180 * 24 * 3600_000;
  return true;
}

/**
 * 状态（心情/状态墙）是否可对 viewer 展示
 * private: 仅自己；friends: 仅好友；public: 好友+（陌生人可见范围另议）
 */
export function canViewStatus(ownerId, status, viewerId) {
  const owner = Number(ownerId);
  const viewer = Number(viewerId);
  if (!status) return false;
  if (owner === viewer) return true;
  if (isBlockedEither(owner, viewer)) return false;
  if (authorHidesFrom(owner, viewer)) return false;
  const vis = status.visibility === 'friends' || status.visibility === 'private'
    ? status.visibility
    : 'public';
  if (vis === 'private') return false;
  if (vis === 'friends') return areFriends(owner, viewer);
  // public：非好友时仍受作者隐私开关约束
  if (!areFriends(owner, viewer)) {
    const s = privacySettingsOf(owner);
    return s.momentsPublic && s.strangerSee10;
  }
  return true;
}

/** 对外吐出状态前按观看者过滤；不可见则返回 null */
export function filterStatusForViewer(ownerId, status, viewerId) {
  if (!status) return null;
  return canViewStatus(ownerId, status, viewerId) ? status : null;
}
