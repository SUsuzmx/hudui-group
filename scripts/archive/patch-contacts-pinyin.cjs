const fs = require('fs');
const p = 'C:/perry/client/src/components/MainView.vue';
let s = fs.readFileSync(p, 'utf8');
const start = s.indexOf('function alphaOf(name)');
const end = s.indexOf('function toggleMore()');
if (start < 0 || end < 0 || end < start) {
  console.log('markers', start, end);
  process.exit(1);
}
const repl = [
  'function alphaOf(name) {',
  '  return pinyinInitial(name);',
  '}',
  '',
  'const contactGroups = computed(() => groupContactsByLetter(contactPeople()));',
  'const contactCount = computed(() => contactGroups.value.reduce((s, g) => s + g.people.length, 0));',
  '',
  '',
].join('\n');
s = s.slice(0, start) + repl + s.slice(end);
s = s.replace(
  'const aiMembers = members.value.aiMembers || [];',
  'const aiMembers = (members.value.aiMembers?.length ? members.value.aiMembers : extraAi.value) || [];'
);
fs.writeFileSync(p, s);
console.log('patched ok');
