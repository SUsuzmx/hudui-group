// 运营后台独立域名接入助手（Cloudflare Tunnel）。
//
// 本项目的隧道是「远程托管」模式（cloudflared tunnel run --token-file），
// 因此 ingress 与 DNS 都配置在 Cloudflare 侧，本地 config.yml 不生效。
//
// 用法：
//   node scripts/admin-domain-setup.mjs                    # 检查现状 + 打印手动步骤（安全，只读）
//   CLOUDFLARE_API_TOKEN=xxx node scripts/admin-domain-setup.mjs --apply
//                                                          # 用 API 自动加 hostname + DNS
// 可选环境变量：
//   ADMIN_HOST   默认 admin.supeiji.top
//   SITE_HOST    默认 chat.supeiji.top（用于读取现有 ingress 规则）
//   TUNNEL_NAME  默认 werewolf
//   ACCOUNT_ID / ZONE_ID  已知时可直接指定，省一次查询
import dns from 'node:dns/promises';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const HOME = os.homedir();

const ADMIN_HOST = process.env.ADMIN_HOST || 'admin.supeiji.top';
const SITE_HOST = process.env.SITE_HOST || 'chat.supeiji.top';
const TUNNEL_NAME = process.env.TUNNEL_NAME || 'werewolf';
const SERVICE = process.env.SERVICE || 'http://localhost:3010';
const APPLY = process.argv.includes('--apply');

const API = 'https://api.cloudflare.com/client/v4';

/**
 * 按优先级从多个位置发现 Cloudflare 凭据：
 *  1) 环境变量 CLOUDFLARE_API_TOKEN
 *  2) 环境变量 CLOUDFLARE_EMAIL + CLOUDFLARE_API_KEY（Global API Key）
 *  3) 项目根 .env / .env.local
 *  4) data/cloudflare-api-token.txt（单行 token，最省事）
 *  5) ~/.cloudflare-api-token
 * 返回 { headers, source } 或 null。
 */
function loadCredentials() {
  const candidates = [];

  if (process.env.CLOUDFLARE_API_TOKEN) {
    candidates.push({ token: process.env.CLOUDFLARE_API_TOKEN, source: '环境变量 CLOUDFLARE_API_TOKEN' });
  }
  if (process.env.CLOUDFLARE_EMAIL && process.env.CLOUDFLARE_API_KEY) {
    candidates.push({
      email: process.env.CLOUDFLARE_EMAIL,
      key: process.env.CLOUDFLARE_API_KEY,
      source: '环境变量 CLOUDFLARE_EMAIL + CLOUDFLARE_API_KEY',
    });
  }

  // .env / .env.local
  for (const name of ['.env.local', '.env']) {
    try {
      const text = fs.readFileSync(path.join(ROOT, name), 'utf8');
      const env = {};
      for (const line of text.split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
        if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
      if (env.CLOUDFLARE_API_TOKEN) {
        candidates.push({ token: env.CLOUDFLARE_API_TOKEN, source: `${name} 的 CLOUDFLARE_API_TOKEN` });
      }
      if (env.CLOUDFLARE_EMAIL && env.CLOUDFLARE_API_KEY) {
        candidates.push({
          email: env.CLOUDFLARE_EMAIL,
          key: env.CLOUDFLARE_API_KEY,
          source: `${name} 的 CLOUDFLARE_EMAIL + CLOUDFLARE_API_KEY`,
        });
      }
    } catch { /* 文件不存在时忽略 */ }
  }

  // 专用小文件
  for (const file of [path.join(ROOT, 'data', 'cloudflare-api-token.txt'), path.join(HOME, '.cloudflare-api-token')]) {
    try {
      const token = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/)[0].trim();
      if (token) candidates.push({ token, source: file });
    } catch { /* 不存在时忽略 */ }
  }

  for (const c of candidates) {
    if (c.token) {
      return { headers: { Authorization: `Bearer ${c.token}` }, kind: 'API Token', source: c.source };
    }
    if (c.email && c.key) {
      return {
        headers: { 'X-Auth-Email': c.email, 'X-Auth-Key': c.key },
        kind: 'Global API Key',
        source: c.source,
      };
    }
  }
  return null;
}

const CREDS = loadCredentials();

const c = {
  reset: '\u001b[0m', bold: '\u001b[1m', dim: '\u001b[2m',
  green: '\u001b[32m', red: '\u001b[31m', yellow: '\u001b[33m', cyan: '\u001b[36m',
};
const head = (s) => console.log(`\n${c.bold}${s}${c.reset}`);
const ok = (s) => console.log(`  ${c.green}✓${c.reset} ${s}`);
const bad = (s) => console.log(`  ${c.red}✗${c.reset} ${s}`);
const warn = (s) => console.log(`  ${c.yellow}!${c.reset} ${s}`);
const info = (s) => console.log(`  ${c.dim}${s}${c.reset}`);

async function cf(path, init = {}) {
  const res = await fetch(API + path, {
    ...init,
    headers: {
      ...(CREDS?.headers || {}),
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!json.success) {
    const msg = (json.errors || []).map((e) => `${e.code} ${e.message}`).join('; ') || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json.result;
}

async function resolves(host) {
  try {
    const r = await dns.resolve4(host);
    return r;
  } catch {
    return null;
  }
}

// ---------- 1. 现状检查 ----------
head('1. 当前状态检查');

const adminIps = await resolves(ADMIN_HOST);
const siteIps = await resolves(SITE_HOST);

if (siteIps) ok(`${SITE_HOST} 已解析 → ${siteIps.join(', ')}`);
else warn(`${SITE_HOST} 未解析（本机 DNS 可能受限，不影响线上）`);

const adminResolved = Boolean(adminIps);
if (adminResolved) ok(`${ADMIN_HOST} 已解析 → ${adminIps.join(', ')}`);
else bad(`${ADMIN_HOST} 尚未解析（缺少 DNS 记录）`);

// 验证本地服务是否已按 Host 路由就绪
// 注意：Node 的 fetch/undici 会静默丢弃 Host 头（forbidden header），必须用 http 模块。
const port = (() => {
  try { return new URL(SERVICE).port || '80'; } catch { return '3010'; }
})();
try {
  const probe = await new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port, path: '/', method: 'GET', headers: { Host: ADMIN_HOST } },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (d) => { body += d; });
        res.on('end', () => resolve({ status: res.statusCode, body }));
      }
    );
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('timeout')));
    req.end();
  });
  if (/运营后台/.test(probe.body)) {
    ok(`本地服务已就绪：Host=${ADMIN_HOST} 返回后台登录页（HTTP ${probe.status}）`);
  } else {
    bad(`本地服务未按 Host 路由后台（HTTP ${probe.status}）——请确认已重启服务`);
  }
} catch (e) {
  warn(`本地服务探测失败（${e.message}）——服务未启动时属正常`);
}

if (adminResolved) {
  head('已经解析，无需再配置');
  info(`直接访问 https://${ADMIN_HOST}/ 即可；若打不开，检查隧道 public hostname 是否已添加。`);
  process.exit(0);
}

// ---------- 2. 手动步骤 ----------
head('2. 手动配置步骤（Cloudflare Zero Trust）');
info('本项目隧道为远程托管模式，ingress/DNS 在 Cloudflare 侧配置，改本地 config.yml 无效。');
console.log(`
  ${c.bold}A. 添加隧道 Public Hostname${c.reset}
     1) 打开 https://one.dash.cloudflare.com/
     2) Networks → Tunnels → 选择隧道 ${c.cyan}${TUNNEL_NAME}${c.reset}
     3) 切到 ${c.bold}Public Hostname${c.reset} 标签 → Add a public hostname
        · Subdomain : ${c.cyan}admin${c.reset}
        · Domain    : ${c.cyan}supeiji.top${c.reset}
        · Path      : 留空
        · Type      : ${c.cyan}HTTP${c.reset}
        · URL       : ${c.cyan}localhost:3010${c.reset}
     4) Save —— Cloudflare 会自动创建 ${c.cyan}${ADMIN_HOST}${c.reset} 的 CNAME（Proxied）

  ${c.bold}B. 验证${c.reset}
     curl -I https://${ADMIN_HOST}/
     curl -s https://${ADMIN_HOST}/ | findstr 运营后台
`);

// ---------- 3. API 自动配置 ----------
head('3. 自动配置（可选）');

if (!CREDS) {
  warn('未发现可用的 Cloudflare API 凭据，跳过自动配置。');
  console.log('');
  info('本项目当前只存在「隧道 token」（data/tunnel-config.json 的隧道凭据）：');
  info('  · 位置：C:\\ProgramData\\cloudflared\\token');
  info('  · 作用：仅能启动隧道，不能创建 DNS 记录或改 ingress');
  info('  · 已实测：当作 API Token 调用会被拒（Invalid format for Authorization header）');
  console.log('');
  info('需要另外提供一个 API 凭据，四选一：');
  info('  A. 环境变量   CLOUDFLARE_API_TOKEN=xxx');
  info('  B. .env 文件  CLOUDFLARE_API_TOKEN=xxx');
  info(`  C. 单行文件   ${path.join(ROOT, 'data', 'cloudflare-api-token.txt')}`);
  info('  D. Global Key  CLOUDFLARE_EMAIL=you@x.com CLOUDFLARE_API_KEY=xxx');
  console.log('');
  info('Token 权限需要：Account → Cloudflare Tunnel → Edit，Zone → DNS → Edit');
  console.log('');
  info('放好凭据后执行：');
  console.log(`  ${c.cyan}npm run admin:domain -- --apply${c.reset}`);
  process.exit(0);
}

ok(`已发现凭据：${CREDS.kind}（来自 ${CREDS.source}）`);

if (!APPLY) {
  warn('当前为只读模式（未加 --apply），不会写入任何变更。');
  console.log('');
  info('加 --apply 执行实际写入：');
  console.log(`  ${c.cyan}npm run admin:domain -- --apply${c.reset}`);
  process.exit(0);
}

// 解析 account / zone / tunnel
const zoneName = ADMIN_HOST.split('.').slice(-2).join('.');
const subdomain = ADMIN_HOST.split('.')[0];

let accountId = process.env.ACCOUNT_ID || '';
let zoneId = process.env.ZONE_ID || '';

if (!zoneId) {
  const zones = await cf(`/zones?name=${encodeURIComponent(zoneName)}`);
  if (!zones.length) throw new Error(`找不到 zone: ${zoneName}`);
  zoneId = zones[0].id;
  ok(`zone ${zoneName} → ${zoneId}`);
} else {
  ok(`zone ${zoneName} → ${zoneId}（来自环境变量）`);
}

if (!accountId) {
  const accounts = await cf('/accounts');
  if (!accounts.length) throw new Error('找不到任何 account');
  accountId = accounts[0].id;
  ok(`account → ${accountId}`);
} else {
  ok(`account → ${accountId}（来自环境变量）`);
}

const tunnels = await cf(`/accounts/${accountId}/cfd_tunnel?name=${encodeURIComponent(TUNNEL_NAME)}&is_deleted=false`);
if (!tunnels.length) throw new Error(`找不到隧道: ${TUNNEL_NAME}`);
const tunnel = tunnels[0];
ok(`隧道 ${TUNNEL_NAME} → ${tunnel.id}`);

// 读取现有 ingress，保留已有规则，仅追加
const current = await cf(`/accounts/${accountId}/cfd_tunnel/${tunnel.id}/configurations`);
const ingress = Array.isArray(current?.config?.ingress) ? [...current.config.ingress] : [];
info(`现有 ingress 规则 ${ingress.length} 条：${ingress.map((r) => r.hostname || '(catch-all)').join(', ') || '无'}`);

const already = ingress.some((r) => String(r.hostname || '').toLowerCase() === ADMIN_HOST.toLowerCase());
if (already) {
  ok(`ingress 已包含 ${ADMIN_HOST}`);
} else {
  // 去掉末尾 catch-all，插入新规则后再补回
  const catchAll = ingress.filter((r) => !r.hostname);
  const hosts = ingress.filter((r) => r.hostname);
  hosts.push({ hostname: ADMIN_HOST, service: SERVICE });
  const next = [...hosts, ...(catchAll.length ? catchAll : [{ service: 'http_status:503' }])];

  await cf(`/accounts/${accountId}/cfd_tunnel/${tunnel.id}/configurations`, {
    method: 'PUT',
    body: JSON.stringify({ config: { ...(current?.config || {}), ingress: next } }),
  });
  ok(`已追加 public hostname：${ADMIN_HOST} → ${SERVICE}`);
}

// DNS CNAME（已存在则跳过）
const target = `${tunnel.id}.cfargotunnel.com`;
const existingDns = await cf(`/zones/${zoneId}/dns_records?name=${encodeURIComponent(ADMIN_HOST)}`);
if (existingDns.length) {
  const rec = existingDns[0];
  if (rec.type === 'CNAME' && String(rec.content).includes(tunnel.id)) {
    ok(`DNS 已存在：${ADMIN_HOST} → ${rec.content}`);
  } else {
    warn(`DNS 已存在但指向不同：${rec.type} ${rec.content}（未修改，请自行确认）`);
  }
} else {
  const rec = await cf(`/zones/${zoneId}/dns_records`, {
    method: 'POST',
    body: JSON.stringify({
      type: 'CNAME',
      name: subdomain,
      content: target,
      proxied: true,
      comment: 'HuduiGroup 运营后台',
    }),
  });
  ok(`已创建 DNS：${ADMIN_HOST} → ${target}（Proxied）`);
  info(`record id: ${rec.id}`);
}

head('完成');
ok(`请等待 1–2 分钟 DNS 生效，然后访问 https://${ADMIN_HOST}/`);
info('验证：node scripts/smoke-admin-host.mjs  （配合 BASE 指向本地端口）');
