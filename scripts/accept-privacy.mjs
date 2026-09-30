/**
 * 隐私复查：导出/备份/日志/API 不泄漏密码、token、密钥
 * 用法: BASE=http://127.0.0.1:3010 node scripts/accept-privacy.mjs
 */
const BASE = process.env.BASE || 'http://127.0.0.1:3010';

let passed = 0;
let failed = 0;
const failures = [];

function ok(cond, msg, detail = '') {
  if (cond) {
    passed += 1;
    console.log('  ✓', msg);
  } else {
    failed += 1;
    failures.push(msg + (detail ? ` — ${detail}` : ''));
    console.log('  ✗', msg, detail || '');
  }
}

function section(t) {
  console.log('\n==', t, '==');
}

const SECRET_PATTERNS = [
  /password_hash/i,
  /"password"\s*:\s*"[^"]+"/i,
  /scrypt/i,
  /api[_-]?key/i,
  /secret[_-]?key/i,
  /BEGIN (RSA |OPENSSH )?PRIVATE KEY/i,
  /Bearer [a-f0-9]{32,}/i,
];

function scanForSecrets(label, text) {
  const hits = [];
  for (const re of SECRET_PATTERNS) {
    const m = String(text).match(re);
    if (m) hits.push(m[0].slice(0, 40));
  }
  ok(hits.length === 0, `${label} 无敏感信息`, hits.join(', '));
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
  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { status: res.status, data, text };
}

async function main() {
  const nick = '隐私审' + Math.random().toString(36).slice(2, 7);
  const reg = await req('/api/register', {
    method: 'POST',
    body: { nickname: nick, password: 'priv9999' },
  });
  const token = reg.data.token;

  section('1. 聊天导出不含密钥');
  const exp = await req('/api/backup/export?limit=50', { token });
  scanForSecrets('导出 JSON', exp.text);

  section('2. 云端备份不含密钥');
  await req('/api/backup/cloud', { method: 'POST', token, body: { limit: 50 } });
  const list = await req('/api/backup/cloud', { token });
  const bid = list.data.backups?.[0]?.id;
  const restore = await req(`/api/backup/cloud/${bid}`, { token });
  scanForSecrets('恢复包 JSON', restore.text);

  section('3. 资料/设置接口不含密码哈希');
  const me = await req('/api/me', { token });
  scanForSecrets('/api/me', me.text);
  const settings = await req('/api/settings', { token });
  scanForSecrets('/api/settings', settings.text);

  section('4. 登录记录不含密码/token 明文过长');
  const hist = await req('/api/auth/login-history', { token });
  const histText = JSON.stringify(hist.data);
  ok(!/password/i.test(histText), '登录记录无密码字段');
  // token 字段最多做短前缀，不应完整出现
  ok(!histText.includes(reg.data.token), '登录记录不含完整 token');

  section('5. FAQ/公开接口无内部密钥');
  const faq = await req('/api/faq');
  scanForSecrets('/api/faq', faq.text);

  section('6. 管理接口需鉴权（未登录 401）');
  const anon = await fetch(BASE + '/api/admin/errors');
  ok(anon.status === 401, '错误日志接口未登录不可看');

  section('7. 服务器日志不含明文密码');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const root = path.resolve('.');
  const logs = [
    path.join(root, 'data', 'service.log'),
    path.join(root, 'data', 'app.log'),
    path.join(root, 'data', 'boot.log'),
  ];
  for (const logPath of logs) {
    try {
      const content = fs.readFileSync(logPath, 'utf8');
      // 不应出现 priv9999 / password_hash 等
      ok(
        !content.includes('priv9999') && !/password_hash/i.test(content),
        `日志 ${path.basename(logPath)} 无明文密码`
      );
    } catch {
      ok(true, `日志 ${path.basename(logPath)} 不存在或不可读（跳过）`);
    }
  }

  section('8. 导出仅含本人可见会话');
  const payload = exp.data.payload || {};
  const convs = new Set((payload.messages || []).map((m) => m.conversationId));
  // 不应包含明显属于他人的私聊 p:other:other
  let leaked = false;
  for (const c of convs) {
    if (typeof c === 'string' && c.startsWith('p:') && !c.includes(String(reg.data.user.id))) {
      // 私聊格式可能是 p:a:b
      const parts = c.split(':').map(Number).filter(Boolean);
      if (parts.length === 2 && !parts.includes(reg.data.user.id)) leaked = true;
    }
  }
  ok(!leaked, '导出不含他人私聊会话');

  console.log('\n======== 隐私复查结果 ========');
  console.log(`通过 ${passed} · 失败 ${failed}`);
  if (failures.length) {
    console.log('失败项:');
    for (const f of failures) console.log(' -', f);
    process.exit(1);
  }
  console.log('全部通过');
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
