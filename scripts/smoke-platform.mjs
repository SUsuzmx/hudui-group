// 冒烟：账号安全 / 群治理 / 备份 / 反馈 / 管理
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = process.env.PORT || '3105';
const BASE = `http://127.0.0.1:${PORT}`;

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function req(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERT: ' + msg);
  console.log('  ✓', msg);
}

async function main() {
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', (d) => process.stderr.write(d));

  let ready = false;
  for (let i = 0; i < 40; i++) {
    await wait(250);
    try {
      const r = await fetch(BASE + '/api/faq');
      if (r.ok) {
        ready = true;
        break;
      }
    } catch { /* not up */ }
  }
  if (!ready) {
    child.kill();
    throw new Error('server not ready');
  }
  console.log('server ready on', BASE);

  try {
    // FAQ 公开
    const faq = await req('/api/faq');
    assert(faq.status === 200 && Array.isArray(faq.data.faq) && faq.data.faq.length > 0, 'FAQ 可访问');

    // 注册 + 登录
    const nick = 'Smoke' + Math.random().toString(36).slice(2, 8);
    const reg = await req('/api/register', {
      method: 'POST',
      body: { nickname: nick, password: 'secret99' },
    });
    assert(reg.status === 200 && reg.data.token, '注册成功');
    const token = reg.data.token;

    // 登录记录
    const hist = await req('/api/auth/login-history', { token });
    assert(hist.status === 200 && Array.isArray(hist.data.items) && hist.data.items.length >= 1, '登录记录已写入');

    // 找回码
    const codeRes = await req('/api/auth/recovery-code', { method: 'POST', token, body: {} });
    assert(codeRes.status === 200 && codeRes.data.recoveryCode, '生成找回码');
    const newPwd = 'newpass123';
    const reset = await req('/api/auth/reset-password', {
      method: 'POST',
      body: { nickname: nick, code: codeRes.data.recoveryCode, newPassword: newPwd },
    });
    assert(reset.status === 200, '找回码重置密码');

    // 重新登录
    const login = await req('/api/login', {
      method: 'POST',
      body: { nickname: nick, password: newPwd },
    });
    assert(login.status === 200 && login.data.token, '新密码登录');
    const t2 = login.data.token;

    // 反馈
    const fb = await req('/api/feedback', {
      method: 'POST',
      token: t2,
      body: { category: 'bug', content: '登录页按钮偶尔点不动' },
    });
    assert(fb.status === 200 && fb.data.id, '提交反馈');
    const myFb = await req('/api/feedback/mine', { token: t2 });
    assert(myFb.status === 200 && myFb.data.feedbacks.length >= 1, '我的反馈列表');

    // 举报
    const rep = await req('/api/reports', {
      method: 'POST',
      token: t2,
      body: { targetType: 'user', targetId: '999', category: 'spam', detail: '疑似广告' },
    });
    assert(rep.status === 200 && rep.data.id, '提交举报');
    const myRep = await req('/api/reports/mine', { token: t2 });
    assert(myRep.status === 200 && myRep.data.reports.length >= 1, '举报进度可查');

    // 敏感内容
    const bad = await req('/api/content/check', {
      method: 'POST',
      token: t2,
      body: { text: '这里有赌博广告' },
    });
    assert(bad.status === 200 && bad.data.blocked, '敏感词检测');

    // 备份导出
    const exp = await req('/api/backup/export?limit=50', { token: t2 });
    assert(exp.status === 200 && exp.data.payload, '聊天记录导出');
    const cloud = await req('/api/backup/cloud', { method: 'POST', token: t2, body: { limit: 50 } });
    assert(cloud.status === 200 && cloud.data.ok, '云端备份');
    const backups = await req('/api/backup/cloud', { token: t2 });
    assert(backups.status === 200 && backups.data.backups.length >= 1, '云端备份列表');

    // 搜索
    const search = await req('/api/search/messages?q=&mediaType=image', { token: t2 });
    assert(search.status === 200 && Array.isArray(search.data.messages), '聊天搜索筛选');

    // 收藏
    const favs = await req('/api/favorites/by-type?type=all', { token: t2 });
    assert(favs.status === 200 && Array.isArray(favs.data.favorites), '收藏分类');

    // 管理后台（首个用户可能不是 admin，用 settings 或 id=1）
    const admin = await req('/api/admin/overview', { token: t2 });
    // 可能 403
    console.log('  · admin overview status', admin.status);
    assert(admin.status === 200 || admin.status === 403, '管理后台权限闸门');

    // 群相册（对默认群）
    const album = await req('/api/groups/1/album', { token: t2 });
    assert(album.status === 200 || album.status === 403, '群相册接口');
    console.log('  · album', album.status, album.data?.count ?? '');

    // 群角色
    const role = await req('/api/groups/1/my-role', { token: t2 });
    assert(role.status === 200, '群角色查询');

    // 公告已读
    const read = await req('/api/groups/1/announcement/read', { method: 'POST', token: t2, body: {} });
    assert(read.status === 200, '公告已读标记');

    console.log('\nALL SMOKE PASSED');
  } finally {
    try { child.kill(); } catch { /* ignore */ }
  }
}

main().catch((e) => {
  console.error('SMOKE FAILED:', e);
  process.exit(1);
});
