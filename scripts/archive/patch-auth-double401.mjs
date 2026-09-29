import fs from 'node:fs';

const p = 'server/index.js';
let c = fs.readFileSync(p, 'utf8');
const before = c;

// userFromRequest 已写 401，handler 里再写会双响应
c = c.split("if (!user) return res.status(401).json({ error: '未登录' });").join('if (!user) return;');
c = c.split("if (!session) return res.status(401).json({ error: '未登录' });").join('if (!session) return;');

fs.writeFileSync(p, c, 'utf8');
console.log('fixed double-401, changed:', before !== c);
