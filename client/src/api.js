const TOKEN_KEY = 'hudui_token';
import { dataUrlToBlob } from './chat-shared.js';
import { toast } from './toast.js';
import { uploadWithProgress, dataUrlToBlobSync, dataUrlToBlobAsync } from './upload-progress.js';
import { compressToBlob, IMAGE_PRESETS } from './image-pipeline.js';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export { uploadWithProgress, dataUrlToBlobSync, dataUrlToBlobAsync, compressToBlob, IMAGE_PRESETS };

/** 图片压缩（按场景预设），返回 Blob */
export async function compressImage(file, maxEdge = 1280, quality = 0.82) {
  const preset = maxEdge <= 480 ? 'sticker'
    : maxEdge <= 512 ? 'avatar'
      : maxEdge >= 1600 ? 'cover'
        : 'chat';
  return compressToBlob(file, preset, { maxEdge, quality });
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
  if (res.status === 401) {
    try {
      const had = getToken();
      setToken(null);
      if (had && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('hudui:logout', {
          detail: { reason: data?.reason || 'session_expired' },
        }));
      }
    } catch { /* ignore */ }
  }
  if (!res.ok) {
    const msg = data?.error || data?.message
      || (res.status === 401 ? '未登录，请先登录' : '')
      || `请求失败 HTTP ${res.status}`;
    throw new Error(msg);
  }
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
  friendBlacklist: () => request('/api/friends/blacklist', { method: 'GET' }),
  setFriendTags: (friendId, tagIds) => request('/api/friends/tags', { body: { friendId, tagIds } }),
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
  chatUnread: (conversationId) => request('/api/chat/unread', { body: { conversationId } }),
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
  userMoments: (userId) => request(`/api/moments/user/${Number(userId)}`, { method: 'GET' }),
  createMoment: (content, images, visibility, visibleTo) =>
    request('/api/moments', { body: { content, images, visibility, visibleTo: visibleTo || [] } }),
  friendStatuses: () => request('/api/status/friends', { method: 'GET' }),
  deleteMoment: (id) => request(`/api/moments/${id}`, { method: 'DELETE' }),
  updateMomentVisibility: (id, visibility, visibleTo) =>
    request('/api/moments/visibility', { body: { id, visibility, visibleTo: visibleTo || [] } }),
  likeMoment: (id) => request('/api/moments/like', { body: { id } }),
  unlikeMoment: (id) => request('/api/moments/unlike', { body: { id } }),
  commentMoment: (id, content, replyToId) =>
    request('/api/moments/comment', { body: { id, content, replyToId } }),
  deleteMomentComment: (commentId) =>
    request('/api/moments/comment/delete', { body: { commentId } }),
  uploadMomentImage: (data) => uploadMedia('/api/moments/upload', data, 'image'),
  /** 带进度的图片上传，data 为 Blob 或 dataURL */
  uploadMomentImageWithProgress: async (data, onProgress, preset = 'moment') => {
    onProgress?.(2);
    const blob = data instanceof Blob ? data : await compressToBlob(data, preset);
    if (!blob) throw new Error('图片数据无效');
    onProgress?.(8);
    return uploadWithProgress('/api/moments/upload', blob, { kind: 'image', filename: 'image.jpg', onProgress });
  },
  uploadChatMedia: (data, kind) => uploadMedia('/api/chat/upload', data, kind || 'image'),
  uploadChatMediaWithProgress: async (data, kind, onProgress) => {
    onProgress?.(2);
    const isImg = (kind || 'image') === 'image';
    let blob = data instanceof Blob ? data : null;
    if (!blob) {
      blob = isImg
        ? await compressToBlob(data, 'chat')
        : (await dataUrlToBlobAsync(data) || dataUrlToBlobSync(data) || dataUrlToBlob(data));
    }
    if (!blob) throw new Error('文件数据无效');
    onProgress?.(8);
    return uploadWithProgress('/api/chat/upload', blob, { kind: kind || 'image', filename: 'file.bin', onProgress });
  },
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
  redpacketCovers: () => request('/api/redpacket/covers', { method: 'GET' }),
  redpacketDetail: (id) => request(`/api/redpacket/${Number(id)}`, { method: 'GET' }),
  settings: () => request('/api/settings', { method: 'GET' }),
  updateSettings: (settings) => request('/api/settings', { method: 'PUT', body: { settings } }),

  // 发现页: 听一听 — 网易云 / QQ / 酷狗
  musicList: ({ q = '', source = 'qq', limit = 30 } = {}) =>
    request('/api/music/list', { method: 'GET', query: { q, source, limit } }),
  musicStreamInfo: (source, id, extra = {}) =>
    request(`/api/music/stream/${encodeURIComponent(source)}/${encodeURIComponent(id)}`, {
      method: 'GET',
      query: extra,
    }),
  musicProxyUrl: (source, id, extra = {}) => {
    const qs = new URLSearchParams({
      source: String(source),
      id: String(id),
      ...Object.fromEntries(Object.entries(extra || {}).filter(([, v]) => v !== undefined && v !== null && v !== '')),
    });
    return `/api/music/proxy?${qs.toString()}`;
  },
  musicProviderSearch: (provider, { q = '', limit = 20 } = {}) =>
    request(`/${''}api/${provider}/search`, { method: 'GET', query: { q, limit } }),
  musicProviderSongUrl: (provider, params = {}) =>
    request(`/api/${provider}/song/url`, { method: 'GET', query: params }),
  musicProviderLyric: (provider, params = {}) =>
    request(`/api/${provider}/lyric`, { method: 'GET', query: params }),
  musicProviderLoginCookie: (provider, cookie) =>
    request(`/api/${provider}/login/cookie`, { method: 'POST', body: { cookie } }),
  musicProviderLoginStatus: (provider) =>
    request(`/api/${provider}/login/status`, { method: 'GET' }),
  musicProviderLogout: (provider) =>
    request(`/api/${provider}/logout`, { method: 'POST', body: {} }),
  musicProviderPlaylists: (provider) =>
    request(`/api/${provider}/playlists`, { method: 'GET' }),
  musicProviderPlaylistTracks: (provider, id, limit = 100) =>
    request(`/api/${provider}/playlist/tracks`, { method: 'GET', query: { id, limit } }),
  musicProviderLikes: (provider) =>
    request(`/api/${provider}/likes`, { method: 'GET' }),
  lookFeed: ({ refresh = false, source = 'local' } = {}) =>
    request('/api/videos/look', {
      method: 'GET',
      query: {
        ...(refresh ? { refresh: '1' } : {}),
        source,
      },
    }),
  lookPosts: () => request('/api/look/posts', { method: 'GET' }),
  lookPublish: (payload) => request('/api/look/posts', { body: payload }),
  lookDelete: (id) => request(`/api/look/posts/${Number(id)}`, { method: 'DELETE' }),
  lookUploadVideo: async (file, onProgress) => {
    if (!file) throw new Error('请选择视频文件');
    return uploadWithProgress('/api/look/upload', file, {
      kind: 'video',
      filename: file.name || 'video.mp4',
      onProgress,
    });
  },
  changePassword: (oldPassword, newPassword) =>
    request('/api/password', { method: 'PUT', body: { oldPassword, newPassword } }),
  kickOtherDevices: () => request('/api/auth/kick-others', { method: 'POST', body: {} }),
};
