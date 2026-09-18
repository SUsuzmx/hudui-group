const TOKEN_KEY = 'hudui_token';
import { dataUrlToBlob } from './chat-shared.js';
import { toast } from './toast.js';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

/** 图片压缩到约 1MB 内, 返回 dataURL */
export async function compressImage(file, maxEdge = 1600, quality = 0.82) {
  if (!file) throw new Error('未选择图片');
  if (!file.type?.startsWith('image/')) throw new Error('请选择图片文件');
  // 小图直接读
  if (file.size <= 800 * 1024) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('读取图片失败'));
      reader.readAsDataURL(file);
    });
  }
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('读取图片失败'));
      reader.readAsDataURL(file);
    });
  }
  let { width, height } = bitmap;
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  width = Math.max(1, Math.round(width * scale));
  height = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  // jpeg 压缩更稳
  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  return dataUrl.startsWith('data:image/') ? dataUrl : canvas.toDataURL('image/png');
}

async function request(path, { method = 'POST', body, query } = {}) {
  let url = path;
  if (query) {
    const qs = new URLSearchParams(
      Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '')
    ).toString();
    if (qs) url += (url.includes('?') ? '&' : '?') + qs;
  }
  const res = await fetch(url, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '网络异常, 请稍后再试');
  return data;
}

async function uploadBinary(path, blob, kind, filename = '') {
  const fd = new FormData();
  const name = filename || (kind === 'voice' ? 'voice.webm' : kind === 'file' ? 'file.bin' : 'image.jpg');
  fd.append('kind', kind || 'image');
  fd.append('file', blob, name);
  const res = await fetch(path, {
    method: 'POST',
    headers: {
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
    },
    body: fd,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '上传失败, 请稍后再试');
  return data;
}

/** dataURL / Blob / File -> 服务端媒体 URL */
async function uploadMedia(path, data, kind) {
  if (data instanceof Blob || (typeof File !== 'undefined' && data instanceof File)) {
    return uploadBinary(path, data, kind, data.name || '');
  }
  if (typeof data === 'string' && data.startsWith('data:')) {
    const blob = dataUrlToBlob(data);
    if (blob) {
      try {
        return await uploadBinary(path, blob, kind);
      } catch (e) {
        // 回退旧 JSON base64 通道
        console.warn('multipart upload failed, fallback json', e);
      }
    }
    return request(path, { body: { data, kind } });
  }
  return request(path, { body: { data, kind } });
}

export const api = {
  register: (nickname, password, avatar) => request('/api/register', { body: { nickname, password, avatar } }),
  login: (nickname, password) => request('/api/login', { body: { nickname, password } }),
  me: () => request('/api/me', { method: 'GET' }),
  updateMe: (payload) => request('/api/me', { method: 'PUT', body: payload }),
  avatars: () => request('/api/avatars', { method: 'GET' }),
  chats: () => request('/api/chats', { method: 'GET' }),
  user: (id) => request(`/api/users/${id}`, { method: 'GET' }),
  friends: () => request('/api/friends', { method: 'GET' }),
  addFriend: (friendId) => request('/api/friends', { body: { friendId } }),
  removeFriend: (friendId) => request(`/api/friends/${friendId}`, { method: 'DELETE' }),
  searchFriends: (q) => request('/api/friends/search', { method: 'GET', query: { q } }),
  setFriendRemark: (friendId, remark) => request('/api/friends/remark', { body: { friendId, remark } }),
  setFriendBlacklist: (friendId, blacklisted) => request('/api/friends/blacklist', { body: { friendId, blacklisted } }),
  setFriendPermission: (friendId, permission) => request('/api/friends/permission', { body: { friendId, permission } }),
  privateRead: (conversationId) => request('/api/chat/private-read', { body: { conversationId } }),
  privatePeerRead: (conversationId) => request('/api/chat/private-peer-read', { method: 'GET', query: { conversationId } }),
  groupRead: (conversationId) => request('/api/chat/group-read', { body: { conversationId } }),
  groupPeerRead: (conversationId) => request('/api/chat/group-peer-read', { method: 'GET', query: { conversationId } }),
  friendRequests: () => request('/api/friends/requests', { method: 'GET' }),
  sendFriendRequest: (userId, message) => request('/api/friends/request', { body: { userId, message } }),
  handleFriendRequest: (id, action) => request('/api/friends/request/handle', { body: { id, action } }),

  chatPref: (payload) => request('/api/chat/pref', { body: payload }),
  getChatPref: (conversationId) => request('/api/chat/pref', { method: 'GET', query: { conversationId } }),
  chatRead: (conversationId) => request('/api/chat/read', { body: { conversationId } }),
  chatClear: (conversationId) => request('/api/chat/clear', { body: { conversationId } }),

  tags: () => request('/api/tags', { method: 'GET' }),
  createTag: (name) => request('/api/tags', { body: { name } }),
  deleteTag: (id) => request('/api/tags/delete', { body: { id } }),
  setTagMembers: (id, members) => request('/api/tags/members', { body: { id, members } }),

  favorites: () => request('/api/favorites', { method: 'GET' }),
  addFavorite: (payload) => request('/api/favorites', { body: payload }),
  removeFavorite: (id) => request('/api/favorites/delete', { body: { id } }),

  official: () => request('/api/official', { method: 'GET' }),
  followOfficial: (id) => request('/api/official/follow', { body: { id } }),
  unfollowOfficial: (id) => request('/api/official/unfollow', { body: { id } }),
  moments: (beforeId) => request('/api/moments', { method: 'GET', query: { beforeId } }),
  myMoments: () => request('/api/moments/mine', { method: 'GET' }),
  createMoment: (content, images, visibility, visibleTo) =>
    request('/api/moments', { body: { content, images, visibility, visibleTo: visibleTo || [] } }),
  deleteMoment: (id) => request(`/api/moments/${id}`, { method: 'DELETE' }),
  likeMoment: (id) => request('/api/moments/like', { body: { id } }),
  unlikeMoment: (id) => request('/api/moments/unlike', { body: { id } }),
  commentMoment: (id, content, replyToId) =>
    request('/api/moments/comment', { body: { id, content, replyToId } }),
  deleteMomentComment: (commentId) =>
    request('/api/moments/comment/delete', { body: { commentId } }),
  uploadMomentImage: (data) => uploadMedia('/api/moments/upload', data, 'image'),
  uploadChatMedia: (data, kind) => uploadMedia('/api/chat/upload', data, kind || 'image'),
  searchChat: (q, conversationId) =>
    request('/api/chat/search', { method: 'GET', query: { q, conversationId } }),
  searchGlobal: (q) => request('/api/search/global', { body: { q } }),
  groupNotice: (groupId, notice) =>
    request(`/api/groups/${groupId}/notice`, { body: { notice } }),
  groupInfo: (groupId) => request(`/api/groups/${groupId}`, { method: 'GET' }),
  createGroup: (name, memberIds, aiMembers) =>
    request('/api/groups', { body: { name, memberIds, aiMembers } }),
  groupMembers: (id) => request(`/api/groups/${id}/members`, { method: 'GET' }),
  inviteGroupMembers: (id, userIds, aiNames) =>
    request(`/api/groups/${id}/members`, { body: { userIds, aiNames } }),
  leaveGroup: (id) => request(`/api/groups/${id}/leave`, { body: {} }),
  renameGroup: (id, name) => request(`/api/groups/${id}/rename`, { body: { name } }),
  removeGroupMember: (id, key) =>
    request(`/api/groups/${id}/members/remove`, { body: { key } }),
  userCards: () => request('/api/cards', { method: 'GET' }),
  addUserCard: (payload) => request('/api/cards', { body: payload }),
  removeUserCard: (id) => request('/api/cards/delete', { body: { id } }),
  wallet: () => request('/api/wallet', { method: 'GET' }),
  walletPay: (amount, note) => request('/api/wallet/pay', { body: { amount, note } }),
  resolveUser: (code) => request('/api/users/resolve', { method: 'GET', query: { code } }),
  aiContacts: () => request('/api/ai-contacts', { method: 'GET' }),
};
