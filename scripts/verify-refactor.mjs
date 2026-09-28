import fs from 'node:fs';

function ok(cond, label) {
  console.log(cond ? ' OK ' : 'FAIL', label);
  return cond ? 0 : 1;
}

let fails = 0;

for (const f of [
  'client/src/components/ChatView.vue',
  'client/src/components/PrivateChatView.vue',
]) {
  const c = fs.readFileSync(f, 'utf8');
  console.log('---', f);
  fails += ok(c.includes("from '../chat-format.js'"), 'imports chat-format');
  fails += ok(c.includes('useChatViewport('), 'uses useChatViewport');
  fails += ok(c.includes('useChatPreview()'), 'uses useChatPreview');
  fails += ok(c.includes('fmtTimeShared'), 'uses fmtTimeShared');
  fails += ok(!/const previewSrc = ref/.test(c), 'no local previewSrc ref');
  fails += ok(c.includes('function openPreview'), 'keeps local openPreview (messages-aware)');
}

const m = fs.readFileSync('client/src/music-player.js', 'utf8');
console.log('--- music-player.js');
fails += ok(m.includes('function stopAllPlayback'), 'stopAllPlayback defined');
fails += ok(m.includes('stopAll: stopAllPlayback'), 'exported as stopAll');
fails += ok(m.includes('stop: safe(() => stopAllPlayback())'), 'mediaSession uses stopAllPlayback');

const fsv = fs.readFileSync('client/src/components/FriendSettingsView.vue', 'utf8');
console.log('--- FriendSettingsView.vue');
fails += ok(
  /import \{[^}]*saveFriendExtras[^}]*\} from '\.\.\/profile-extras\.js'/.test(fsv),
  'imports saveFriendExtras'
);

const idx = fs.readFileSync('server/index.js', 'utf8');
console.log('--- server/index.js');
fails += ok(idx.includes('requireAuth, userFromRequest'), 'imports unified auth');
fails += ok(!idx.includes('mediaAuth'), 'no leftover mediaAuth');
fails += ok(!idx.includes('friendsApi.requireAuth'), 'no friendsApi.requireAuth');
fails += ok(idx.includes('const requireUser = userFromRequest'), 'requireUser aliases userFromRequest');
// 不能出现双 401 模式
fails += ok(
  !/userFromRequest\(req, res\);[\s\S]{0,80}res\.status\(401\)/.test(idx),
  'no double-401 after userFromRequest'
);

const friends = fs.readFileSync('server/friends.js', 'utf8');
console.log('--- friends/meta/moments');
fails += ok(friends.includes('requireAuth,'), 'friends re-exports requireAuth');
fails += ok(!friends.includes('function requireAuth'), 'friends has no local requireAuth');

const db = fs.readFileSync('server/db.js', 'utf8');
console.log('--- server/db.js');
fails += ok(db.includes("import { runMigrations } from './migrate.js'"), 'imports runMigrations');
fails += ok(db.includes('runMigrations(db)'), 'calls runMigrations');
fails += ok(!db.includes('ALTER TABLE users ADD COLUMN avatar'), 'no legacy try/catch ALTERs');

const mig = fs.readFileSync('server/migrate.js', 'utf8');
console.log('--- server/migrate.js');
fails += ok(mig.includes('schema_migrations'), 'has schema_migrations');
fails += ok(mig.includes('addColumnIfMissing'), 'uses addColumnIfMissing');
fails += ok(mig.includes('export function runMigrations'), 'exports runMigrations');

console.log('\n' + (fails ? `FAILED ${fails} checks` : 'ALL CHECKS PASSED'));
process.exit(fails ? 1 : 0);
