import fs from 'node:fs';

const p = 'server/index.js';
let c = fs.readFileSync(p, 'utf8');
const before = c;

c = c.replace(
  "import { register, login, verifyToken, publicUser, listAvatars, updateProfile, IMG_DIR, loginRateLimited, registerRateLimited, publicProfile, parseUserStatus, changePassword, keepOnlyCurrentSession } from './auth.js';",
  "import { register, login, verifyToken, publicUser, listAvatars, updateProfile, IMG_DIR, loginRateLimited, registerRateLimited, publicProfile, parseUserStatus, changePassword, keepOnlyCurrentSession, requireAuth, userFromRequest, extractBearerToken } from './auth.js';"
);

c = c.replace(
  /function requireUser\(req, res\) \{\r?\n  const user = verifyToken\(req\.get\('Authorization'\)\?\.replace\(\/\^Bearer \/, ''\)\);\r?\n  if \(!user\) \{\r?\n    res\.status\(401\)\.json\(\{ error: '未登录' \}\);\r?\n    return null;\r?\n  \}\r?\n  return user;\r?\n\}/,
  'const requireUser = userFromRequest;'
);

c = c.replace(/createMetaRouter\(\{\r?\n  verifyToken,\r?\n/, 'createMetaRouter({\n');
c = c.replace('createFriendsRouter({ verifyToken })', 'createFriendsRouter()');
c = c.replace(/createMomentsRouter\(\{\r?\n  verifyToken,\r?\n/, 'createMomentsRouter({\n');

c = c.split('friendsApi.requireAuth').join('requireAuth');
c = c.split('metaApi.requireAuth').join('requireAuth');
c = c.split('momentsApi.requireAuth').join('requireAuth');

c = c.replace(
  /function mediaAuth\(req, res, next\) \{\r?\n  const user = verifyToken\(req\.get\('Authorization'\)\?\.replace\(\/\^Bearer \/, ''\)\);\r?\n  if \(!user\) return res\.status\(401\)\.json\(\{ error: '未登录' \}\);\r?\n  req\.user = user;\r?\n  next\(\);\r?\n\}\r?\n/,
  ''
);
c = c.split('requireAuth: mediaAuth').join('requireAuth');
c = c.split('mediaAuth').join('requireAuth');

c = c.split("verifyToken(req.get('Authorization')?.replace(/^Bearer /, ''))").join('userFromRequest(req, res)');

if (c === before) {
  console.log('NO CHANGES — patterns not matched');
  process.exit(1);
}
fs.writeFileSync(p, c, 'utf8');
console.log('replacements done, length', before.length, '->', c.length);
