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
      console.log('  MISS:', from.slice(0, 70).replace(/\n/g, ' | '));
    }
  }
  if (crlf) c = c.replace(/\n/g, '\r\n');
  fs.writeFileSync(path, c, 'utf8');
  console.log(path, 'applied', n, '/', pairs.length);
}

patchFile('client/src/components/PrivateChatView.vue', [
  [
    "import { EMOJI_LIST, renderContent } from '../chat-shared.js';",
    `import { EMOJI_LIST, renderContent } from '../chat-shared.js';
import {
  fmtTime as fmtTimeShared,
  fmtDayLabel as fmtDayLabelShared,
  parseExt as parseExtShared,
  isMineMessage,
  shouldShowTime as shouldShowTimeShared,
  isSameSenderAsPrev as isSameSenderShared,
  shouldShowDateSep as shouldShowDateSepShared,
} from '../chat-format.js';
import { useChatViewport } from '../composables/useChatViewport.js';
import { useChatPreview } from '../composables/useChatPreview.js';`,
  ],
  [
    `function isMine(m) {
  if (m?.localPending) return true;
  return m.senderType === 'user' && m.senderName === props.me.nickname;
}

function fmtTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const hm = \`\${String(d.getHours()).padStart(2, '0')}:\${String(d.getMinutes()).padStart(2, '0')}\`;
  if (d.toDateString() === now.toDateString()) return hm;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return \`昨天 \${hm}\`;
  return \`\${d.getFullYear()}年\${d.getMonth() + 1}月\${d.getDate()}日 \${hm}\`;
}

function showTime(i) {
  if (i === 0) return true;
  return (messages.value[i]?.createdAt ?? 0) - (messages.value[i - 1]?.createdAt ?? 0) > 5 * 60_000;
}

function sameSenderAsPrev(i) {
  if (i === 0 || showTime(i)) return false;
  const prev = messages.value[i - 1];
  const cur = messages.value[i];
  if (prev.senderType === 'system' || cur.senderType === 'system') return false;
  return prev.senderName === cur.senderName && prev.senderType === cur.senderType;
}

function scrollToBottom(smooth = true) {
  nextTick(() => {
    const el = listEl.value;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  });
}

function autoSizeInput() {
  const ta = textareaRef.value;
  if (!ta) return;
  ta.style.height = 'auto';
  ta.style.height = Math.min(96, Math.max(22, ta.scrollHeight)) + 'px';
}`,
    `function isMine(m) {
  return isMineMessage(m, props.me.nickname);
}

function fmtTime(ts) {
  return fmtTimeShared(ts);
}

function showTime(i) {
  return shouldShowTimeShared(messages.value, i);
}

function sameSenderAsPrev(i) {
  return isSameSenderShared(messages.value, i);
}

const { scrollToBottom, autoSizeInput, onScroll: onScrollViewport } = useChatViewport({
  listEl,
  textareaRef,
  messages,
  noMoreHistory,
  loadOlder: (beforeId) => loadHistory(beforeId),
});`,
  ],
  [
    `function onScroll() {
  const el = listEl.value;
  if (!el) return;
  if (el.scrollTop < 60 && !noMoreHistory.value && messages.value.length) {
    loadHistory(messages.value[0].id);
  }
}`,
    `function onScroll() {
  onScrollViewport();
}`,
  ],
  [
    `function showDateSep(i) {
  if (i === 0) return true;
  const prev = messages.value[i - 1];
  const cur = messages.value[i];
  if (!prev?.createdAt || !cur?.createdAt) return false;
  return new Date(prev.createdAt).toDateString() !== new Date(cur.createdAt).toDateString();
}

function fmtDayLabel(ts) {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return '今天';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return '昨天';
  return \`\${d.getFullYear()}年\${d.getMonth() + 1}月\${d.getDate()}日\`;
}`,
    `function showDateSep(i) {
  return shouldShowDateSepShared(messages.value, i);
}

function fmtDayLabel(ts) {
  return fmtDayLabelShared(ts);
}`,
  ],
  [
    `function parseExt(m) {
  if (!m) return {};
  if (m.ext && typeof m.ext === 'object') return m.ext;
  if (typeof m.ext === 'string') {
    try { return JSON.parse(m.ext) || {}; } catch { /* ignore */ }
  }
  const c = String(m.content || '');
  const amt = /¥\\s*([0-9]+(?:\\.[0-9]{1,2})?)/.exec(c);
  return { amount: amt ? Number(amt[1]) : undefined, note: /红包/.test(c) ? '恭喜发财' : '' };
}`,
    `function parseExt(m) {
  const ext = parseExtShared(m);
  if (ext && Object.keys(ext).length) return ext;
  const c = String(m?.content || '');
  const amt = /¥\\s*([0-9]+(?:\\.[0-9]{1,2})?)/.exec(c);
  return { amount: amt ? Number(amt[1]) : undefined, note: /红包/.test(c) ? '恭喜发财' : '' };
}`,
  ],
]);
