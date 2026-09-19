const fs = require('fs');
const p = 'C:/perry/client/src/App.vue';
let s = fs.readFileSync(p, 'utf8');
const bad = `  transitionName.value = 'page-push';
  view.value = 'private-chat';
}
  transitionName.value = 'page-push';
  view.value = 'private-chat';
}

function openSub(payload) {`;
const good = `  transitionName.value = 'page-push';
  view.value = 'private-chat';
}

function openSub(payload) {`;
if (!s.includes(bad)) {
  console.log('pattern not found');
  process.exit(1);
}
s = s.replace(bad, good);
fs.writeFileSync(p, s);
console.log('fixed App.vue');
