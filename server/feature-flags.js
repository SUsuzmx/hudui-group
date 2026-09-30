// 功能开关：可随时关闭新增能力，避免上线后无法回退
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './db.js';

const FLAGS_FILE = path.join(ROOT, 'data', 'feature-flags.json');

export const DEFAULT_FLAGS = {
  accountSecurity: true,   // 找回密码 / 登录记录 / 注销
  groupGovernance: true,   // 群管理员 / 入群验证 / 公告已读 / 群相册
  momentsSafety: true,     // 访客 / 举报 / 敏感词
  backupCloud: true,       // 导出 / 云端备份
  feedbackFaq: true,       // 反馈 / FAQ / 举报进度
  searchEnhanced: true,    // 搜索筛选 / 收藏分类
  adminPanel: true,        // 运营后台
};

function load() {
  try {
    return { ...DEFAULT_FLAGS, ...JSON.parse(fs.readFileSync(FLAGS_FILE, 'utf8')) };
  } catch {
    return { ...DEFAULT_FLAGS };
  }
}

export function getFlags() {
  return load();
}

export function isFeatureEnabled(name) {
  const f = load();
  return f[name] !== false;
}

export function setFlags(patch) {
  const next = { ...load() };
  for (const [k, v] of Object.entries(patch || {})) {
    if (k in DEFAULT_FLAGS) next[k] = Boolean(v);
  }
  try {
    fs.mkdirSync(path.dirname(FLAGS_FILE), { recursive: true });
    fs.writeFileSync(FLAGS_FILE, JSON.stringify(next, null, 2));
  } catch (e) {
    return { error: e.message };
  }
  return { ok: true, flags: next };
}

/** Express 中间件：对应功能关闭时返回 503 */
export function requireFeature(name) {
  return (req, res, next) => {
    if (!isFeatureEnabled(name)) {
      res.status(503).json({ error: '该功能已暂时关闭', feature: name });
      return;
    }
    next();
  };
}
