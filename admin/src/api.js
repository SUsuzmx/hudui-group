// 运营后台 API 客户端：与用户端 api.js 完全独立，使用独立的 token 存储键。
const TOKEN_KEY = 'hudui_admin_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

let onUnauthorized = null;
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

async function request(path, { method = 'GET', body, query } = {}) {
  let url = `/api/admin${path}`;
  if (query) {
    const qs = new URLSearchParams(
      Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '')
    ).toString();
    if (qs) url += (url.includes('?') ? '&' : '?') + qs;
  }
  const token = getToken();
  const res = await fetch(url, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    setToken(null);
    if (onUnauthorized) onUnauthorized(data?.error || '登录已失效');
  }
  if (!res.ok) {
    const err = new Error(data?.error || data?.message || `请求失败 HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  // 元信息 / 会话
  meta: () => request('/meta'),
  login: (username, password) => request('/auth/login', { method: 'POST', body: { username, password } }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  me: () => request('/auth/me'),
  changePassword: (oldPassword, newPassword) =>
    request('/auth/password', { method: 'POST', body: { oldPassword, newPassword } }),
  sessions: () => request('/auth/sessions'),

  // 概览
  dashboard: (days) => request('/dashboard', { query: { days } }),

  // 用户
  users: (params) => request('/users', { query: params }),
  user: (id) => request(`/users/${id}`),
  banUser: (id, reason) => request(`/users/${id}/ban`, { method: 'POST', body: { reason } }),
  unbanUser: (id) => request(`/users/${id}/unban`, { method: 'POST' }),
  resetUserPassword: (id, password) => request(`/users/${id}/password`, { method: 'POST', body: { password } }),
  setPlatformAdmin: (id, isAdmin) => request(`/users/${id}/platform-admin`, { method: 'POST', body: { isAdmin } }),
  logoutUserAll: (id) => request(`/users/${id}/logout-all`, { method: 'POST' }),
  deleteUser: (id, confirm) => request(`/users/${id}`, { method: 'DELETE', body: { confirm } }),
  bulkUsers: (payload) => request('/users/bulk', { method: 'POST', body: payload }),

  // 设备封禁
  devices: (params) => request('/devices', { query: params }),
  banDevice: (deviceId, reason, sig = '') => request('/devices/ban', { method: 'POST', body: { deviceId, reason, sig } }),
  unbanDevice: (deviceId) => request('/devices/unban', { method: 'POST', body: { deviceId } }),
  bulkBanDevices: (deviceIds, reason) => request('/devices/bulk-ban', { method: 'POST', body: { deviceIds, reason } }),

  // 举报
  reports: (params) => request('/reports', { query: params }),
  report: (id) => request(`/reports/${id}`),
  handleReport: (id, payload) => request(`/reports/${id}`, { method: 'POST', body: payload }),
  bulkReports: (payload) => request('/reports/bulk', { method: 'POST', body: payload }),

  // 反馈
  feedback: (params) => request('/feedback', { query: params }),
  replyFeedback: (id, reply) => request(`/feedback/${id}/reply`, { method: 'POST', body: { reply } }),
  closeFeedback: (id) => request(`/feedback/${id}/close`, { method: 'POST' }),
  reopenFeedback: (id) => request(`/feedback/${id}/reopen`, { method: 'POST' }),

  // 错误
  errors: (params) => request('/errors', { query: params }),
  errorStats: (days) => request('/errors/stats', { query: { days } }),
  deleteError: (id) => request(`/errors/${id}`, { method: 'DELETE' }),
  purgeErrors: (payload) => request('/errors/purge', { method: 'POST', body: payload }),

  // 开关
  flags: () => request('/flags'),
  setFlags: (flags) => request('/flags', { method: 'POST', body: { flags } }),

  // 审计
  audit: (params) => request('/audit', { query: params }),
  auditModules: () => request('/audit/modules'),

  // 系统设置
  settings: () => request('/settings'),
  setSettings: (settings) => request('/settings', { method: 'POST', body: { settings } }),

  // 内容治理
  contentMessages: (params) => request('/content/messages', { query: params }),
  deleteMessage: (id, hard) => request(`/content/messages/${id}`, { method: 'DELETE', body: { hard } }),
  contentMoments: (params) => request('/content/moments', { query: params }),
  deleteMoment: (id) => request(`/content/moments/${id}`, { method: 'DELETE' }),
  contentGroups: (params) => request('/content/groups', { query: params }),
  deleteGroup: (id, confirm) => request(`/content/groups/${id}`, { method: 'DELETE', body: { confirm } }),
  bulkContent: (payload) => request('/content/bulk', { method: 'POST', body: payload }),

  // 管理员
  admins: () => request('/admins'),
  createAdmin: (payload) => request('/admins', { method: 'POST', body: payload }),
  updateAdmin: (id, payload) => request(`/admins/${id}`, { method: 'PATCH', body: payload }),
  resetAdminPassword: (id, password) => request(`/admins/${id}/password`, { method: 'POST', body: { password } }),
  deleteAdmin: (id) => request(`/admins/${id}`, { method: 'DELETE' }),
  revokeAdminSessions: (id) => request(`/admins/${id}/revoke-sessions`, { method: 'POST' }),
};
