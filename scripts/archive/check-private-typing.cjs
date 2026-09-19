const fs = require('fs');
const s = fs.readFileSync('C:/perry/server/chat.js', 'utf8');
const i = s.indexOf("socket.on('private:typing'");
console.log('typing at', i);
console.log(JSON.stringify(s.slice(Math.max(0, i - 80), i + 200)));
