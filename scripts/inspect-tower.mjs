import fs from 'node:fs';
const js = fs.readFileSync('C:/perry/games/tower_game/dist/main.js', 'utf8');
console.log('defines $ ?', /\$\s*=/.test(js.slice(0, 500)));
console.log('window.$', js.includes('window.$'));
console.log('TowerGame', js.includes('TowerGame'));
// find getImg usage and draw when missing
let i = 0, c = 0;
while ((i = js.indexOf('getImg', i)) >= 0 && c < 8) {
  console.log('==== getImg', i);
  console.log(js.slice(Math.max(0, i - 50), i + 120));
  i += 6; c++;
}
