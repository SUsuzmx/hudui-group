// 验证运营后台独立域名（Host 路由）行为。
// 用法: node scripts/smoke-admin-host.mjs   （BASE 默认 http://127.0.0.1:3010）
import http from 'node:http';

const BASE = process.env.BASE || 'http://127.0.0.1:3010';
const ADMIN_HOST = process.env.ADMIN_HOST || 'admin.supeiji.top';
const SITE_HOST = process.env.SITE_HOST || 'chat.supeiji.top';
const url = new URL(BASE);

let pass = 0;
let fail = 0;
function ok(name, cond, extra = '') {
  if (cond) { pass += 1; console.log(`  ✓ ${name}${extra ? ` — ${extra}` : ''}`); }
  else { fail += 1; console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
}

/** 发请求并显式指定 Host 头（模拟 Cloudflare Tunnel 透传原始域名） */
function request(method, path, host, payload) {
  return new Promise((resolve, reject) => {
    const body = payload ? JSON.stringify(payload) : null;
    const req = http.request({
      hostname: url.hostname,
      port: url.port || 80,
      path,
      method,
      headers: {
        Host: host,
        ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}),
      },
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { text += d; });
      res.on('end', () => resolve({ status: res.statusCode, body: text, headers: res.headers }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('timeout')));
    if (body) req.write(body);
    req.end();
  });
}

const get = (path, host) => request('GET', path, host);
const post = (path, host, payload) => request('POST', path, host, payload);

function kind(body) {
  if (/运营后台/.test(body)) return 'ADMIN-SPA';
  if (/boot-splash/.test(body)) return 'USER-SPA';
  if (/"error"/.test(body)) return 'JSON-API';
  return 'OTHER';
}

console.log(`\n运营后台独立域名路由验证 → ${BASE}\n`);
console.log(`  后台域名: ${ADMIN_HOST}`);
console.log(`  主站域名: ${SITE_HOST}\n`);

console.log('[1] 后台独立域名：根路径即后台登录页');
{
  const r = await get('/', ADMIN_HOST);
  ok('GET / 返回后台 SPA', r.status === 200 && kind(r.body) === 'ADMIN-SPA', `HTTP ${r.status} ${kind(r.body)}`);
  ok('HTML 标题为运营后台', /<title>运营后台<\/title>/.test(r.body));
  ok('HTML 不可缓存（避免旧壳）', /no-store/.test(r.headers['cache-control'] || ''));
}

console.log('\n[2] 后台独立域名：SPA 深链回退');
{
  const r = await get('/users', ADMIN_HOST);
  ok('/users 回退到后台 SPA', r.status === 200 && kind(r.body) === 'ADMIN-SPA', `HTTP ${r.status}`);
  const deep = await get('/a/b/c', ADMIN_HOST);
  ok('/a/b/c 回退到后台 SPA', deep.status === 200 && kind(deep.body) === 'ADMIN-SPA', `HTTP ${deep.status}`);
}

console.log('\n[3] 后台独立域名：静态资源');
{
  // 从 index.html 中解析真实的入口资源路径
  const home = await get('/', ADMIN_HOST);
  const jsMatch = home.body.match(/src="([^"]+\.js)"/);
  const cssMatch = home.body.match(/href="([^"]+\.css)"/);
  ok('index.html 引用入口 JS', Boolean(jsMatch), jsMatch ? jsMatch[1] : '未找到');
  if (jsMatch) {
    const js = await get(jsMatch[1], ADMIN_HOST);
    ok(`资源可加载 ${jsMatch[1]}`, js.status === 200 && /javascript/.test(js.headers['content-type'] || ''),
      `HTTP ${js.status}`);
    ok('入口资源长缓存', /immutable/.test(js.headers['cache-control'] || ''));
  }
  if (cssMatch) {
    const css = await get(cssMatch[1], ADMIN_HOST);
    ok(`样式可加载 ${cssMatch[1]}`, css.status === 200, `HTTP ${css.status}`);
  }
  // 根路径下的 /assets/*（构建 base 为 /admin/ 时的兜底）
  const rootAsset = await get('/assets/does-not-exist.js', ADMIN_HOST);
  ok('不存在的资源回退为 SPA 而非 404 页面', kind(rootAsset.body) === 'ADMIN-SPA', `HTTP ${rootAsset.status}`);
}

console.log('\n[4] 后台独立域名：API 不被 SPA 吞掉');
{
  const me = await get('/api/admin/auth/me', ADMIN_HOST);
  ok('/api/admin/* 返回 JSON 而非 HTML', kind(me.body) === 'JSON-API', `HTTP ${me.status} ${kind(me.body)}`);
  ok('未登录返回 401', me.status === 401, `HTTP ${me.status}`);

  const login = await post('/api/admin/auth/login', ADMIN_HOST, { username: '__nobody__', password: 'x' });
  ok('后台登录接口可达（POST 返回 JSON）', kind(login.body) === 'JSON-API', `HTTP ${login.status} ${kind(login.body)}`);
  ok('错误凭据返回 401', login.status === 401, `HTTP ${login.status}`);
}

console.log('\n[5] 主站域名：用户端不受影响');
{
  const r = await get('/', SITE_HOST);
  ok('主站 / 仍为用户端', kind(r.body) === 'USER-SPA', `HTTP ${r.status} ${kind(r.body)}`);

  const admin = await get('/admin', SITE_HOST);
  ok('主站 /admin 备用入口仍可用', admin.status === 200 && kind(admin.body) === 'ADMIN-SPA', `HTTP ${admin.status}`);

  const games = await get('/api/games', SITE_HOST);
  ok('主站 API 正常', games.status === 200, `HTTP ${games.status}`);
}

console.log('\n[6] 其他/未知域名回退到用户端');
{
  const r = await get('/', 'localhost');
  ok('未知域名 / 走用户端', kind(r.body) === 'USER-SPA', `HTTP ${r.status} ${kind(r.body)}`);
  const a = await get('/admin', 'localhost');
  ok('未知域名 /admin 走后台', kind(a.body) === 'ADMIN-SPA', `HTTP ${a.status}`);
}

console.log('\n[7] 带端口与大小写的主机名');
{
  const r = await get('/', `${ADMIN_HOST}:3010`);
  ok('Host 带端口仍识别为后台', kind(r.body) === 'ADMIN-SPA', `HTTP ${r.status} ${kind(r.body)}`);
  const up = await get('/', ADMIN_HOST.toUpperCase());
  ok('Host 大写仍识别为后台', kind(up.body) === 'ADMIN-SPA', `HTTP ${up.status} ${kind(up.body)}`);
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
