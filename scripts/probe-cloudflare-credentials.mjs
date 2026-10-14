// 判定本机现有的 Cloudflare 凭据到底能不能用于 API（DNS / 隧道配置）。
// 只做只读探测，不做任何写操作。
import fs from 'node:fs';

const TOKEN_FILE = 'C:/ProgramData/cloudflared/token';
const raw = fs.readFileSync(TOKEN_FILE, 'utf8').trim();

// 1) 解码隧道 token
let decoded = null;
try {
  const b64 = raw + '='.repeat((4 - (raw.length % 4)) % 4);
  decoded = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
} catch (e) {
  decoded = { error: e.message };
}
console.log('隧道 token 解码:', JSON.stringify({
  account: decoded?.a, tunnel: decoded?.t, secretLen: decoded?.s?.length,
}, null, 1));

async function probe(label, headers) {
  try {
    const res = await fetch('https://api.cloudflare.com/client/v4/user/tokens/verify', {
      headers,
      signal: AbortSignal.timeout(15000),
    });
    const json = await res.json().catch(() => ({}));
    console.log(`\n[${label}] HTTP ${res.status} success=${json.success}`);
    console.log('  ', JSON.stringify(json.errors || json.result || {}).slice(0, 220));
    return json.success === true;
  } catch (e) {
    console.log(`\n[${label}] 请求失败: ${e.message}`);
    return false;
  }
}

console.log('\n=== 用「隧道 token」当 API Token 调用 /user/tokens/verify ===');
await probe('隧道 token 作 Bearer', { Authorization: `Bearer ${raw}` });

console.log('\n=== 用「隧道 secret」当 API Token ===');
if (decoded?.s) {
  await probe('隧道 secret 作 Bearer', { Authorization: `Bearer ${decoded.s}` });
}

console.log('\n=== 试列 zone（需要 Zone:Read 权限）===');
try {
  const res = await fetch('https://api.cloudflare.com/client/v4/zones?name=supeiji.top', {
    headers: { Authorization: `Bearer ${raw}` },
    signal: AbortSignal.timeout(15000),
  });
  const json = await res.json().catch(() => ({}));
  console.log(`HTTP ${res.status} success=${json.success}`);
  console.log('  ', JSON.stringify(json.errors || []).slice(0, 220));
} catch (e) {
  console.log('请求失败:', e.message);
}

console.log('\n结论：若以上 success 均为 false，则隧道 token 仅能用于运行隧道，');
console.log('      无法创建 DNS 记录或修改远程托管的 ingress。');
