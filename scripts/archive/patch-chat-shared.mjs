import fs from 'node:fs';

function patchFile(path, pairs) {
  let c = fs.readFileSync(path, 'utf8');
  // 统一到 LF 做替换，写回时保留原换行风格
  const crlf = c.includes('\r\n');
  if (crlf) c = c.replace(/\r\n/g, '\n');
  let n = 0;
  for (const [from, to] of pairs) {
    if (c.includes(from)) {
      c = c.replace(from, to);
      n++;
    } else {
      console.log('  MISS:', from.slice(0, 60).replace(/\n/g, ' | '));
    }
  }
  if (crlf) c = c.replace(/\n/g, '\r\n');
  fs.writeFileSync(path, c, 'utf8');
  console.log(path, 'applied', n, '/', pairs.length);
}

const chatViewPairs = [
  [
    `function avatarProps(m) {
  if (m.senderType === 'ai') {
    const a = aiAvatarMap.value[m.senderName];
    return { name: m.senderName, avatar: a?.avatar ?? null, emoji: a?.emoji ?? '😊', color: '#07c160', size: 40 };
  }
  const av = m.avatar;
  const isFile = av && (av.startsWith('/') || /\\.(png|jpe?g|webp|gif)$/i.test(av));
  return {
    name: m.senderName,
    avatar: isFile ? av : null,
    emoji: null,
    color: isFile ? '#4f6ef7' : (av || '#4f6ef7'),
    size: 40,
  };
}

function fmtTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const hm = \`\${String(d.getHours()).padStart(2, '0')}:\${String(d.getMinutes()).padStart(2, '0')}\`;
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return hm;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return \`昨天 \${hm}\`;
  return \`\${d.getFullYear()}年\${d.getMonth() + 1}月\${d.getDate()}日 \${hm}\`;
}

function showTime(i) {
  if (i === 0) return true;
  const prev = messages.value[i - 1];
  const cur = messages.value[i];
  if (!prev?.createdAt || !cur?.createdAt) return false;
  return cur.createdAt - prev.createdAt > 5 * 60_000;
}

function sameSenderAsPrev(i) {
  if (i === 0) return false;
  const prev = messages.value[i - 1];
  const cur = messages.value[i];
  if (prev.senderType === 'system' || cur.senderType === 'system') return false;
  if (showTime(i)) return false;
  return prev.senderName === cur.senderName && prev.senderType === cur.senderType;
}

function isMine(m) {
  if (m?.localPending) return true;
  return m.senderType === 'user' && m.senderName === props.me.nickname;
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
    `function avatarProps(m) {
  return avatarFromMessage(m, aiAvatarMap.value);
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

function isMine(m) {
  return isMineMessage(m, props.me.nickname);
}

const { scrollToBottom, autoSizeInput, onScroll: onScrollViewport } = useChatViewport({
  listEl,
  textareaRef,
  messages,
  noMoreHistory,
  loadOlder: (beforeId) => loadHistoryNow(beforeId),
});`,
  ],
  [
    `function onScroll() {
  const el = listEl.value;
  if (!el) return;
  if (el.scrollTop < 60 && !noMoreHistory.value && messages.value.length) {
    loadHistoryNow(messages.value[0].id);
  }
}`,
    `function onScroll() {
  onScrollViewport();
}`,
  ],
  [
    `function fmtDayLabel(ts) {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return '今天';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return '昨天';
  return \`\${d.getFullYear()}年\${d.getMonth() + 1}月\${d.getDate()}日\`;
}

function showDateSep(i) {
  if (i === 0) return true;
  const prev = messages.value[i - 1];
  const cur = messages.value[i];
  if (!prev?.createdAt || !cur?.createdAt) return false;
  // 只比日历日，避免 toDateString 分配
  const a = new Date(prev.createdAt);
  const b = new Date(cur.createdAt);
  return a.getFullYear() !== b.getFullYear()
    || a.getMonth() !== b.getMonth()
    || a.getDate() !== b.getDate();
}`,
    `function fmtDayLabel(ts) {
  return fmtDayLabelShared(ts);
}

function showDateSep(i) {
  return shouldShowDateSepShared(messages.value, i);
}`,
  ],
  [
    `function parseExt(m) {
  if (!m) return {};
  if (m.ext && typeof m.ext === 'object') return m.ext;
  if (typeof m.ext === 'string') {
    try { return JSON.parse(m.ext) || {}; } catch { return {}; }
  }
  return {};
}

function isMineMsg(m) {
  return m?.senderType === 'user' && m?.senderName === props.me?.nickname;
}`,
    `function parseExt(m) {
  return parseExtShared(m);
}

function isMineMsg(m) {
  return isMineMessage(m, props.me?.nickname);
}`,
  ],
];

patchFile('client/src/components/ChatView.vue', chatViewPairs);
