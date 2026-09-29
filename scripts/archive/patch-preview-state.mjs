import fs from 'node:fs';

function patchFile(path, pairs) {
  let c = fs.readFileSync(path, 'utf8');
  const crlf = c.includes('\r\n');
  if (crlf) c = c.replace(/\r\n/g, '\n');
  let n = 0;
  for (const [from, to] of pairs) {
    if (c.includes(from)) {
      c = c.replace(from, to);
      n++;
    } else {
      console.log('  MISS:', JSON.stringify(from.slice(0, 50)));
    }
  }
  if (crlf) c = c.replace(/\n/g, '\r\n');
  fs.writeFileSync(path, c, 'utf8');
  console.log(path, 'applied', n, '/', pairs.length);
}

const stateBlock = `const {
  previewSrc,
  filePreview,
  previewImages,
  previewIndex,
  showImagePreview,
} = useChatPreview();`;

// ChatView
patchFile('client/src/components/ChatView.vue', [
  ['const previewSrc = ref(null);', stateBlock],
  ['const filePreview = ref(null); // { name, url, sender }', '// filePreview 由 useChatPreview 提供'],
  ['const previewImages = ref([]);', '// previewImages 由 useChatPreview 提供'],
  ['const previewIndex = ref(0);', '// previewIndex 由 useChatPreview 提供'],
  ['const showImagePreview = ref(false);', '// showImagePreview 由 useChatPreview 提供'],
]);

// PrivateChatView
patchFile('client/src/components/PrivateChatView.vue', [
  ['const previewSrc = ref(null);', stateBlock],
  ['const filePreview = ref(null);', '// filePreview 由 useChatPreview 提供'],
  ['const previewImages = ref([]);', '// previewImages 由 useChatPreview 提供'],
  ['const previewIndex = ref(0);', '// previewIndex 由 useChatPreview 提供'],
  ['const showImagePreview = ref(false);', '// showImagePreview 由 useChatPreview 提供'],
]);
