import fs from 'node:fs';
const checks = [
  ['server/listen-together.js', 'initListenTogether'],
  ['client/src/listen-together.js', 'createRoom'],
  ['client/src/music-player.js', 'setListenMode'],
  ['server/chat.js', 'listentogether'],
  ['server/index.js', 'initListenTogether'],
];
for (const [f, needle] of checks) {
  const c = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
  console.log(c.includes(needle) ? 'OK  ' : 'MISS', f, 'has', needle);
}
const comps = fs.readdirSync('client/src/components').filter((x) => /Listen/i.test(x));
console.log('Listen* components:', comps.join(', ') || '(none)');
