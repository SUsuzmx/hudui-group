import fs from 'node:fs';
const p = 'C:/perry/games/tower_game/dist/main.js';
let s = fs.readFileSync(p, 'utf8');
const from = 'getImg(t){return this.assetsObj.image[t]}';
const to = 'getImg(t){const v=this.assetsObj.image[t];if(v)return v;const c=document.createElement("canvas");c.width=1;c.height=1;return c}';
if (s.includes(from)) {
  s = s.split(from).join(to);
  fs.writeFileSync(p, s);
  console.log('getImg patched');
} else if (s.includes('c.width=1')) {
  console.log('already patched');
} else {
  console.log('pattern not found');
}
