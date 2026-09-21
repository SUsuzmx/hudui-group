<script setup>
import { ref, nextTick, onMounted, onBeforeUnmount, computed } from 'vue';
import { api, compressImage } from '../api.js';
import { EMOJI_LIST, EMOJI_PACKS, loadRecentEmojis, pushRecentEmoji, renderContent } from '../chat-shared.js';
import FilePreview from './FilePreview.vue';
import { useVoicePlayer } from '../voice-player.js';
import { ensureNotifyPermission, notifyMessage, playMsgSound, playSendSound } from '../notify.js';
import { makeLocalMsg, patchLocalMsg, dropLocalEcho } from '../chat-send-status.js';
import { toast } from '../toast.js';
import { createDraftSync } from '../draft-sync.js';
import { getSocket, bindSocket } from '../socket-store.js';
import { saveMsgCache, loadMsgCache } from '../chat-cache.js';
import UserAvatar from './UserAvatar.vue';
import ForwardSheet from './ForwardSheet.vue';
import ImagePreview from './ImagePreview.vue';
import WxPayCard from './WxPayCard.vue';
import WxPayOverlay from './WxPayOverlay.vue';

const props = defineProps({
  me: { type: Object, required: true },
  justRegistered: { type: Boolean, default: false },
  chat: { type: Object, default: null },
  pendingSearch: { type: Boolean, default: false },
});
const emit = defineEmits(['back', 'open-chat-info', 'members', 'search-used', 'open-video-call', 'open-profile']);

const conversationId = computed(() => props.chat?.conversationId || null);
const chatTitle = computed(() => props.chat?.name || members.value.groupName || 'WeChat');
const isDefaultChat = computed(() => props.chat?.isDefault !== false);
const groupKind = computed(() => props.chat?.kind || (isDefaultChat.value ? 'main' : null));

// 仅本群相关人设 + 真人成员; 私聊不走本组件
const GROUP_PERSONA_IDS = {
  main: ['siqi', 'perry', 'niunai', 'xiaolajiao', 'aqiang'],
  product: ['siqi', 'perry', 'xiaolajiao', 'fangyuan'],
  family: ['mama', 'baba'],
  climb: ['wangye', 'yezi'],
  work: ['fangyuan', 'siqi'],
  game: ['yezi', 'aqiang', 'perry'],
};

const messages = ref([]);
const members = ref({ groupName: 'WeChat', onlineUsers: [], aiMembers: [], allUsers: [] });
const draft = ref('');
const connected = ref(false);
const everConnected = ref(false);
const booting = ref(true);
const loadingHistory = ref(false);
const noMoreHistory = ref(false);
const showMentionPicker = ref(false);
const mentionFilter = ref('');
const mentionStartPos = ref(-1);
const listEl = ref(null);
const textareaRef = ref(null);

// 0=none 1=emoji 2=plus 3=voice
const dockMode = ref(0);
const showChatMore = ref(false);
const previewSrc = ref(null);
const actionMsg = ref(null);
const actionPressed = ref(false);
const actionMenuEl = ref(null);
const quoteMsg = ref(null);
const typingNames = ref([]);
const sendState = ref('idle'); // idle | sending | failed
const lastFailed = ref(null);
const multiMode = ref(false);
const selectedIds = ref([]);
const pullY = ref(0);
let typingTimer = null;
let avatarTap = { id: null, ts: 0 };

const emojiList = EMOJI_LIST;
const emojiPackKey = ref('face');
const recentEmojis = ref(loadRecentEmojis());
const favEmojis = (() => {
  try { return JSON.parse(localStorage.getItem('hudui_stickers') || '[]'); }
  catch { return []; }
})();
const filePreview = ref(null); // { name, url, sender }

const emojiTabs = computed(() => [
  { key: 'recent', label: '最近', icons: recentEmojis.value },
  ...EMOJI_PACKS.map((p) => ({ key: p.key, label: p.name, icons: p.icons })),
  { key: 'fav', label: '收藏', icons: favEmojis.value },
]);

const displayEmojis = computed(() => {
  const hit = emojiTabs.value.find((t) => t.key === emojiPackKey.value);
  return hit?.icons || emojiList;
});

function pickEmojiTab(key) {
  emojiPackKey.value = key;
}

function insertEmojiTracked(e) {
  recentEmojis.value = pushRecentEmoji(e);
  insertEmoji(e);
}
const mergeExpand = ref(null);
const showJieleng = ref(false);
const jielengTitle = ref('');
const jielengItems = ref('');
const showCollect = ref(false);
const collectAmount = ref('');
const collectNote = ref('');
const collectingIds = ref({});
const noticeShown = ref(false);
const { playingKey, voiceProgress, playVoice, stopVoice, disposeVoice, parseVoiceSeconds } = useVoicePlayer();
const previewImages = ref([]);
const previewIndex = ref(0);
const showImagePreview = ref(false);
const groupNotice = ref('');
const groupReadCount = ref(0);
const groupMemberCount = ref(0);

let socket = null;
let longPressTimer = null;
let groupReadTimer = null;
let composing = false;
let unbinders = [];

const showConnHint = computed(() => everConnected.value && !connected.value);
const cacheKey = computed(() => conversationId.value || 'default');

function persistMessages() {
  saveMsgCache(cacheKey.value, messages.value);
}

function seedSeenIds(rows) {
  for (const r of rows || []) {
    if (r?.id != null) seenMsgIds.add(r.id);
  }
}

function onCompositionStart() { composing = true; draftSync.setComposing(true); }
function onCompositionEnd() {
  composing = false;
  draftSync.setComposing(false);
  draftSync.onLocalChange();
  if (typeof onDraftInput === 'function') onDraftInput();
}

function onKeyDown(e) {
  if (e.key !== 'Enter') return;
  if (e.shiftKey) return;
  if (composing || e.isComposing) return;
  if (localStorage.getItem('wx_enter_send') === '0') return; // 设置里关了回车发送
  e.preventDefault();
  send();
}

const aiAvatarMap = computed(() => {
  const m = {};
  for (const a of members.value.aiMembers) {
    m[a.nickname] = a.avatarUrl ? { avatar: a.avatarUrl, emoji: null } : { avatar: null, emoji: a.avatarEmoji };
  }
  return m;
});

const mentionableMembers = computed(() => {
  const kind = groupKind.value || 'main';
  const allow = new Set(GROUP_PERSONA_IDS[kind] || GROUP_PERSONA_IDS.main);
  const list = [];
  list.push({
    nickname: '所有人',
    avatar: null,
    emoji: '📢',
    color: '#fa9d3b',
    isAll: true,
  });
  for (const a of members.value.aiMembers || []) {
    if (!isDefaultChat.value && !allow.has(a.id)) continue;
    list.push({
      nickname: a.nickname,
      avatar: a.avatarUrl,
      emoji: a.avatarUrl ? null : a.avatarEmoji,
      color: '#07c160',
    });
  }
  if (isDefaultChat.value) {
    for (const u of members.value.allUsers || []) {
      if (u.nickname === props.me.nickname) continue;
      list.push({
        nickname: u.nickname,
        avatar: u.avatar,
        emoji: null,
        color: u.avatarColor,
        online: u.online,
      });
    }
  }
  return list;
});

const filteredMentions = computed(() => {
  const q = mentionFilter.value.toLowerCase();
  if (!q) return mentionableMembers.value;
  return mentionableMembers.value.filter((m) => m.nickname.toLowerCase().includes(q));
});

function avatarProps(m) {
  if (m.senderType === 'ai') {
    const a = aiAvatarMap.value[m.senderName];
    return { name: m.senderName, avatar: a?.avatar ?? null, emoji: a?.emoji ?? '😊', color: '#07c160', size: 40 };
  }
  const av = m.avatar;
  const isFile = av && (av.startsWith('/') || /\.(png|jpe?g|webp|gif)$/i.test(av));
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
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return hm;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `昨天 ${hm}`;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
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
}

async function loadHistory(beforeId = null) {
  return loadHistoryNow(beforeId);
}

function onScroll() {
  const el = listEl.value;
  if (!el) return;
  if (el.scrollTop < 60 && !noMoreHistory.value && messages.value.length) {
    loadHistoryNow(messages.value[0].id);
  }
}

function onDraftInput() {
  autoSizeInput();
  onDraftInputTyping();
  draftSync.onLocalChange();
  lastLocalDraft = draft.value.slice(0, 500);
  const val = draft.value;
  const pos = textareaRef.value?.selectionStart ?? val.length;
  const beforeCursor = val.slice(0, pos);
  const atIdx = beforeCursor.lastIndexOf('@');

  if (atIdx === -1 || (atIdx > 0 && beforeCursor[atIdx - 1] !== ' ' && beforeCursor[atIdx - 1] !== '\n' && atIdx !== 0)) {
    showMentionPicker.value = false;
    return;
  }
  const afterAt = beforeCursor.slice(atIdx + 1);
  if (/\s/.test(afterAt) && afterAt.length > 0 && !afterAt.includes('\n')) {
    showMentionPicker.value = false;
    return;
  }
  mentionStartPos.value = atIdx;
  mentionFilter.value = afterAt;
  showMentionPicker.value = filteredMentions.value.length > 0;
}

function selectMention(member) {
  const val = draft.value;
  const pos = mentionStartPos.value;
  if (pos === -1) return;
  const before = val.slice(0, pos);
  const cursorPos = textareaRef.value?.selectionStart ?? val.length;
  const after = val.slice(cursorPos);
  draft.value = `${before}@${member.nickname} ${after}`;
  showMentionPicker.value = false;
  mentionStartPos.value = -1;
  mentionFilter.value = '';
  nextTick(() => {
    autoSizeInput();
    const ta = textareaRef.value;
    if (ta) {
      const newPos = before.length + member.nickname.length + 2;
      ta.setSelectionRange(newPos, newPos);
      ta.focus();
    }
  });
}

function insertAt() {
  const ta = textareaRef.value;
  if (!ta) return;
  dockMode.value = 0;
  const pos = ta.selectionStart ?? draft.value.length;
  const val = draft.value;
  const needSpace = pos > 0 && val[pos - 1] !== ' ' && val[pos - 1] !== '\n';
  const insert = `${needSpace ? ' ' : ''}@`;
  draft.value = val.slice(0, pos) + insert + val.slice(pos);
  mentionStartPos.value = pos + (needSpace ? 1 : 0);
  mentionFilter.value = '';
  showMentionPicker.value = filteredMentions.value.length > 0;
  nextTick(() => {
    autoSizeInput();
    const newPos = pos + insert.length;
    ta.setSelectionRange(newPos, newPos);
    ta.focus();
  });
}

function setDock(mode) {
  if (dockMode.value === mode) {
    dockMode.value = 0;
  } else {
    dockMode.value = mode;
    showMentionPicker.value = false;
  }
  if (dockMode.value !== 3) nextTick(() => autoSizeInput());
}

function insertEmoji(emoji) {
  const ta = textareaRef.value;
  if (!ta) {
    draft.value += emoji;
    return;
  }
  const pos = ta.selectionStart ?? draft.value.length;
  const val = draft.value;
  draft.value = val.slice(0, pos) + emoji + val.slice(pos);
  nextTick(() => {
    autoSizeInput();
    const newPos = pos + emoji.length;
    ta.setSelectionRange(newPos, newPos);
    ta.focus();
  });
}

function deleteEmoji() {
  const chars = [...draft.value];
  chars.pop();
  draft.value = chars.join('');
  nextTick(autoSizeInput);
}

function onInputFocus() {
  draftSync.setFocused(true);
  if (dockMode.value === 1 || dockMode.value === 2) dockMode.value = 0;
  setTimeout(() => scrollToBottom(false), 80);
}
function onInputBlur() {
  draftSync.setFocused(false);
}

function send() {
  const content = draft.value.trim();
  if (!content) return;
  if (!socket?.connected) {
    showToast('网络连接中，发送可能稍延迟');
  }
  const payload = {
    content,
    conversationId: conversationId.value,
    quote: quoteMsg.value
      ? {
          id: quoteMsg.value.id,
          name: quoteMsg.value.senderName,
          content: (quoteMsg.value.content || '[图片]').slice(0, 80),
        }
      : null,
  };
  const local = makeLocalMsg({
    me: props.me,
    conversationId: conversationId.value,
    content,
    quote: payload.quote,
  });
  messages.value.push(local);
  sendState.value = 'sending';
  socket.emit('message:send', payload, (res) => {
    if (res?.error) {
      sendState.value = 'failed';
      lastFailed.value = payload;
      patchLocalMsg(messages.value, local.id, { sendStatus: 'failed' });
      messages.value = [...messages.value];
      return;
    }
    sendState.value = 'idle';
    lastFailed.value = null;
    playSendSound();
    // 服务端回声通常很快；若尚未到达则先标已发送
    const still = messages.value.find((m) => m.id === local.id);
    if (still) patchLocalMsg(messages.value, local.id, { sendStatus: 'sent', localPending: false });
    messages.value = [...messages.value];
  });
  draft.value = '';
  quoteMsg.value = null;
  showMentionPicker.value = false;
  dockMode.value = 0;
  draftSync.clearLocal();
  stopTyping();
  api.chatPref({ conversationId: conversationId.value || 'default', draft: '' }).catch(() => {});
  api.chatRead(conversationId.value || 'default').catch(() => {});
  nextTick(() => {
    autoSizeInput();
    scrollToBottom();
  });
}

function retrySend() {
  if (!lastFailed.value) return;
  const payload = lastFailed.value;
  lastFailed.value = null;
  sendState.value = 'sending';
  const failedLocal = [...messages.value].reverse().find((m) => m.localPending && m.sendStatus === 'failed');
  if (failedLocal) {
    patchLocalMsg(messages.value, failedLocal.id, { sendStatus: 'sending' });
    messages.value = [...messages.value];
  }
  socket.emit('message:send', payload, (res) => {
    if (res?.error) {
      sendState.value = 'failed';
      lastFailed.value = payload;
      if (failedLocal) {
        patchLocalMsg(messages.value, failedLocal.id, { sendStatus: 'failed' });
        messages.value = [...messages.value];
      }
    } else {
      sendState.value = 'idle';
      playSendSound();
      if (failedLocal) {
        messages.value = messages.value.filter((m) => m.id !== failedLocal.id);
      }
    }
  });
}

function onBubbleRetry(m) {
  if (!m?.localPending || m.sendStatus !== 'failed') return;
  lastFailed.value = {
    content: m.content,
    conversationId: conversationId.value,
    quote: m.quote || null,
    mediaType: m.mediaType || null,
    mediaUrl: m.mediaUrl || null,
  };
  retrySend();
}

function onPasteChat(e) {
  const items = e.clipboardData?.items || [];
  for (const item of items) {
    if (item.type?.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) {
        e.preventDefault();
        sendImageFile(file);
        return;
      }
    }
  }
}

async function sendImageFile(file) {
  try {
    const data = await compressImage(file);
    const { url, mediaType } = await api.uploadChatMedia(data, 'image');
    if (!url) throw new Error('上传失败');
    const local = makeLocalMsg({
      me: props.me,
      conversationId: conversationId.value,
      content: '[图片]',
      mediaType: mediaType || 'image',
      mediaUrl: url,
    });
    messages.value.push(local);
    scrollToBottom();
    socket.emit('message:send', {
      conversationId: conversationId.value,
      content: '[图片]',
      mediaType: mediaType || 'image',
      mediaUrl: url,
    }, (res) => {
      if (res?.error) {
        patchLocalMsg(messages.value, local.id, { sendStatus: 'failed' });
        messages.value = [...messages.value];
        showToast(res.error);
      } else {
        playSendSound();
      }
    });
  } catch (err) {
    showToast(err.message || '发送图片失败');
  }
}

function setQuote(m) {
  if (!m || m.senderType === 'system' || m.recalled) return;
  quoteMsg.value = m;
  dockMode.value = 0;
  nextTick(() => textareaRef.value?.focus());
}

function clearQuote() {
  quoteMsg.value = null;
}

function startTyping() {
  if (!socket || !conversationId.value) return;
  socket.emit('typing:start', { conversationId: conversationId.value });
}

function stopTyping() {
  if (!socket || !conversationId.value) return;
  socket.emit('typing:stop', { conversationId: conversationId.value });
}

function onDraftInputTyping() {
  startTyping();
  clearTimeout(typingTimer);
  typingTimer = setTimeout(stopTyping, 1500);
}

function doRecall(m) {
  if (!m || !socket) return;
  const lastMine = m.senderType === 'user' && m.senderName === props.me?.nickname
    && Date.now() - m.createdAt < 120_000;
  socket.emit('message:recall', { id: m.id, conversationId: conversationId.value }, (res) => {
    if (res?.error) {
      alert(res.error);
      return;
    }
    // 微信: 撤回后可重新编辑
    if (lastMine && m.content && !m.mediaType) {
      draft.value = m.content;
      toast('已撤回，可重新编辑');
      nextTick(() => textareaRef.value?.focus());
    } else {
      toast('已撤回');
    }
  });
}

function openPreview(url) {
  const imgs = messages.value
    .filter((m) => m.mediaType === 'image' && m.mediaUrl)
    .map((m) => m.mediaUrl);
  if (!imgs.includes(url) && url) imgs.unshift(url);
  previewImages.value = imgs.length ? imgs : [url].filter(Boolean);
  previewIndex.value = Math.max(0, previewImages.value.indexOf(url));
  showImagePreview.value = true;
}

function closePreview() {
  showImagePreview.value = false;
  previewSrc.value = null;
}

function voiceWidth(m) {
  const sec = parseVoiceSeconds(m.content);
  return Math.min(160, 48 + sec * 10) + 'px';
}

function isVoicePlaying(m) {
  return playingKey.value === String(m.id ?? m.mediaUrl);
}

function openChatMore() {
  const gid = conversationId.value?.startsWith('grp_')
    ? Number(conversationId.value.replace(/^grp_/, ''))
    : props.chat?.groupId || null;
  emit('open-chat-info', {
    conversationId: conversationId.value,
    groupId: gid,
    groupName: chatTitle.value,
    isGroup: true,
  });
}

function closeOverlays() {
  showChatMore.value = false;
  actionMsg.value = null;
}

function onChatMoreAction(label) {
  showChatMore.value = false;
  if (label === 'search-history') {
    showSearch.value = true;
    searchQuery.value = '';
    searchResults.value = [];
    return;
  }
  const gid = conversationId.value?.startsWith('grp_')
    ? Number(conversationId.value.replace(/^grp_/, ''))
    : (props.chat?.groupId || null);
  emit('open-chat-info', {
    conversationId: conversationId.value,
    groupId: gid,
    groupName: chatTitle.value,
    isGroup: true,
    action: label,
  });
}

const showSearch = ref(false);
const searchQuery = ref('');
const searchResults = ref([]);
const searching = ref(false);
const photoInput = ref(null);
const recorder = ref(null);
const recording = ref(false);
const recCancel = ref(false);
const recSeconds = ref(0);
let recTimer = null;

function recBarHeight(n) {
  if (recCancel.value) return 4;
  const t = Date.now() / 120 + n;
  const base = 6 + Math.abs(Math.sin(t + n * 0.7)) * (recSeconds.value ? 18 : 10);
  return Math.round(base);
}
const showForward = ref(false);
const forwardIds = ref([]);
const recStartY = ref(0);

async function doSearchHistory() {
  const q = searchQuery.value.trim();
  if (!q) {
    searchResults.value = [];
    return;
  }
  searching.value = true;
  try {
    const data = await api.searchChat(q, conversationId.value);
    searchResults.value = data.messages || [];
  } catch (e) {
    showToast(e.message);
  } finally {
    searching.value = false;
  }
}

function pickChatPhoto() {
  photoInput.value?.click();
}

async function onChatPhoto(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = await compressImage(file);
    const { url, mediaType } = await api.uploadChatMedia(data, 'image');
    if (!url) throw new Error('上传失败');
    socket.emit('message:send', { conversationId: conversationId.value, mediaType: mediaType || 'image', mediaUrl: url }, (res) => {
      if (res?.error) showToast(res.error);
    });
    dockMode.value = 0;
  } catch (err) {
    showToast(err.message || '发送图片失败');
  }
}

async function startRecord(e) {
  if (recording.value) return;
  recStartY.value = e?.clientY ?? 0;
  recCancel.value = false;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mr = new MediaRecorder(stream);
    const chunks = [];
    mr.ondataavailable = (ev) => {
      if (ev.data?.size) chunks.push(ev.data);
    };
    mr.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      clearInterval(recTimer);
      recording.value = false;
      const cancelled = recCancel.value;
      recCancel.value = false;
      const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
      if (cancelled) {
        recSeconds.value = 0;
        showToast('已取消');
        return;
      }
      if (recSeconds.value < 1 || blob.size < 200) {
        showToast('说话时间太短');
        recSeconds.value = 0;
        return;
      }
      const data = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      });
      try {
        const { url, mediaType } = await api.uploadChatMedia(data, 'voice');
        const local = makeLocalMsg({
          me: props.me,
          conversationId: conversationId.value,
          content: `[语音] ${recSeconds.value}"`,
          mediaType: mediaType || 'voice',
          mediaUrl: url,
        });
        messages.value.push(local);
        scrollToBottom();
        socket.emit(
          'message:send',
          {
            conversationId: conversationId.value,
            content: `[语音] ${recSeconds.value}"`,
            mediaType,
            mediaUrl: url,
          },
          (res) => {
            if (res?.error) {
              patchLocalMsg(messages.value, local.id, { sendStatus: 'failed' });
              messages.value = [...messages.value];
              showToast(res.error);
            } else {
              playSendSound();
            }
          }
        );
      } catch (err) {
        showToast(err.message);
      }
      recSeconds.value = 0;
    };
    recorder.value = mr;
    recSeconds.value = 0;
    recording.value = true;
    mr.start();
    recTimer = setInterval(() => {
      recSeconds.value += 1;
      if (recSeconds.value >= 60) stopRecord();
    }, 1000);
  } catch {
    showToast('无法访问麦克风');
  }
}

function onRecordMove(e) {
  if (!recording.value) return;
  const y = e?.clientY ?? e?.touches?.[0]?.clientY ?? recStartY.value;
  recCancel.value = (recStartY.value - y) > 72;
}

function stopRecord() {
  if (!recording.value) return;
  try {
    recorder.value?.stop();
  } catch { /* ignore */ }
}

function onPreviewForward(url) {
  const m = messages.value.find((x) => x.mediaUrl === url);
  if (m?.id) openForward([m.id]);
  else showToast('无法转发该图片');
}

function startLongPress(m, e) {
  if (m.senderType === 'system') return;
  if (multiMode.value) return;
  clearTimeout(longPressTimer);
  longPressTimer = setTimeout(() => {
    actionMsg.value = m;
    actionPressed.value = true;
    // 轻触震动（支持时）
    try { navigator.vibrate?.(12); } catch { /* ignore */ }
  }, 480);
}

function clearLongPress() {
  clearTimeout(longPressTimer);
}

function sysText(m) {
  const t = m.content || '';
  if (t.endsWith('撤回了一条消息')) {
    const nick = t.slice(0, -'撤回了一条消息'.length);
    if (nick && nick === props.me?.nickname) return '你撤回了一条消息';
  }
  return t;
}

function openForward(ids) {
  const list = (ids || []).filter(Boolean);
  if (!list.length) return;
  forwardIds.value = list;
  showForward.value = true;
}

function onForwardDone(payload) {
  showForward.value = false;
  forwardIds.value = [];
  multiMode.value = false;
  selectedIds.value = [];
  showToast(payload?.name ? `已转发到「${payload.name}」` : '已转发');
}

function doAction(kind) {
  const m = actionMsg.value;
  actionMsg.value = null;
  actionPressed.value = false;
  if (!m) return;
  if (kind === 'copy' && m.content) {
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(m.content).catch(() => {});
    showToast('已复制');
    return;
  }
  if (kind === 'quote') {
    setQuote(m);
    return;
  }
  if (kind === 'recall') {
    doRecall(m);
    return;
  }
  if (kind === 'multi') {
    multiMode.value = true;
    selectedIds.value = m.id ? [m.id] : [];
    return;
  }
  if (kind === 'forward') {
    openForward([m.id]);
    return;
  }
  if (kind === 'favorite') {
    api.addFavorite({
      kind: m.mediaType || 'text',
      content: m.content || (m.mediaType === 'image' ? '[图片]' : m.mediaType === 'voice' ? '[语音]' : m.mediaType === 'redpacket' ? '[红包]' : m.mediaType === 'transfer' ? '[转账]' : ''),
      mediaUrl: m.mediaUrl || null,
      fromName: m.senderName || '',
    }).then(() => showToast('已收藏，可在「我 → 收藏」查看')).catch((e) => showToast(e.message || '收藏失败'));
    return;
  }
  if (kind === 'delete') {
    messages.value = messages.value.filter((x) => x.id !== m.id);
  }
}

function toggleSelect(id) {
  if (!multiMode.value) return;
  if (selectedIds.value.includes(id)) {
    selectedIds.value = selectedIds.value.filter((x) => x !== id);
  } else {
    selectedIds.value = [...selectedIds.value, id];
  }
}

function exitMulti() {
  multiMode.value = false;
  selectedIds.value = [];
}

function forwardSelected() {
  if (!selectedIds.value.length) return;
  openForward([...selectedIds.value]);
}

function deleteSelected() {
  if (!selectedIds.value.length) return;
  const set = new Set(selectedIds.value);
  messages.value = messages.value.filter((m) => !set.has(m.id));
  exitMulti();
  showToast('已删除所选');
}

function showToast(msg) {
  toast(msg);
}

function parseMergeItems(m) {
  try {
    if (m?.ext?.mergeItems) return m.ext.mergeItems;
    const raw = typeof m?.ext === 'string' ? JSON.parse(m.ext) : m?.ext;
    if (raw?.mergeItems) return raw.mergeItems;
  } catch { /* ignore */ }
  const lines = String(m?.content || '').split('\n').filter((l) => l && !l.startsWith('「'));
  return lines.map((l) => {
    const i = l.indexOf(': ');
    return i > 0 ? { name: l.slice(0, i), content: l.slice(i + 2) } : { name: '', content: l };
  });
}

function openMergeExpand(m) {
  mergeExpand.value = parseMergeItems(m);
}

function openFileMsg(m) {
  const url = m?.mediaUrl || '';
  const raw = String(m?.ext?.name || m.content || '文件').replace(/^\[文件\]/, '').trim();
  filePreview.value = {
    name: raw || '文件',
    url,
    sender: m?.senderName || '',
  };
}

function jielengLines(m) {
  const ext = parseExt(m);
  const raw = ext.items || String(m?.content || '').split('\n').filter((l) => l && !l.startsWith('接龙') && !l.startsWith('【'));
  return (Array.isArray(raw) ? raw : []).slice(0, 8).map((x, i) => `${i + 1}. ${x}`);
}

function openJielengMsg(m) {
  const ext = parseExt(m);
  const name = props.me?.nickname || '我';
  const list = ext.items ? [...ext.items] : String(m.content || '').split('\n').filter((l) => /^\d+\./.test(l)).map((l) => l.replace(/^\d+\.\s*/, ''));
  if (!list.includes(name)) list.push(name);
  const title = ext.title || '群接龙';
  const content = `【接龙】${title}\n${list.map((x, i) => `${i + 1}. ${x}`).join('\n')}`;
  socket?.emit('message:send', {
    conversationId: conversationId.value,
    content,
    mediaType: 'jielong',
    ext: { jieleng: true, title, items: list, baseId: m.id },
  }, (res) => {
    if (res?.error) showToast(res.error);
    else showToast('已参与接龙');
  });
  mergeExpand.value = null;
}

function openCollect(m) {
  const ext = parseExt(m);
  const amount = Number(ext.amount || 0);
  if (!(amount > 0)) {
    showToast('金额无效');
    return;
  }
  if (isMineMsg(m)) {
    showToast(`群收款单 ¥${amount.toFixed(2)} · ${collectingIds.value[m.id] ? '已收款' : '待成员支付'}`);
    return;
  }
  if (collectingIds.value[m.id]) {
    showToast('你已支付');
    return;
  }
  // 演示: 扣零钱并标记
  api.walletPay(amount, ext.note || '群收款').then(() => {
    collectingIds.value = { ...collectingIds.value, [m.id]: true };
    showToast(`已支付 ¥${amount.toFixed(2)}`);
  }).catch((e) => showToast(e.message || '支付失败'));
}

function sendJieleng() {
  const title = jielengTitle.value.trim() || '群接龙';
  const items = jielengItems.value.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 20);
  const list = items.length ? items : [props.me?.nickname || '我'];
  if (!list.includes(props.me?.nickname)) list.push(props.me?.nickname || '我');
  const content = `【接龙】${title}\n${list.map((x, i) => `${i + 1}. ${x}`).join('\n')}`;
  socket?.emit('message:send', {
    conversationId: conversationId.value,
    content,
    mediaType: 'jielong',
    ext: { jieleng: true, title, items: list },
  }, (res) => {
    if (res?.error) showToast(res.error);
    else showToast('接龙已发送');
  });
  showJieleng.value = false;
  dockMode.value = 0;
}

function sendGroupCollect() {
  const amount = Number(collectAmount.value);
  if (!(amount > 0)) {
    showToast('请输入金额');
    return;
  }
  const note = collectNote.value.trim() || '活动费用';
  const content = `[群收款]${note} ¥${amount.toFixed(2)}`;
  socket?.emit('message:send', {
    conversationId: conversationId.value,
    content,
    mediaType: 'groupcollect',
    ext: { collect: true, amount, note },
  }, (res) => {
    if (res?.error) showToast(res.error);
    else showToast('群收款已发出');
  });
  showCollect.value = false;
  dockMode.value = 0;
}

function joinJielengFromExpand() {
  if (!mergeExpand.value?.length) return;
  // 扩展页仅展示; 参与在气泡上点击
  mergeExpand.value = null;
}

let lastLocalDraft = '';
const CONV_BG = ['#ededed', '#e7e7e7', '#dce9f7', '#e3f0e6', '#f3efe6', '#2a2a2a'];
const convBg = ref('');

const draftSync = createDraftSync({
  getDraft: () => draft.value,
  setDraft: (v) => { draft.value = v; },
  getConversationId: () => conversationId.value || 'default',
  saveDraft: (conv, text) => {
    lastLocalDraft = text;
    return api.chatPref({ conversationId: conv, draft: text });
  },
});

function applyConvBgFromPref(d) {
  const key = Number(d?.pref?.bgKey);
  // 0/缺省跟随全局 --chat-bg；1-5 会话专属背景（作用于气泡所在聊天区）
  convBg.value = Number.isInteger(key) && key > 0 && key < CONV_BG.length ? CONV_BG[key] : '';
}

function loadServerDraft() {
  const conv = conversationId.value || 'default';
  api.getChatPref(conv).then((d) => {
    const serverDraft = d?.pref?.draft || '';
    draftSync.loadInitial(serverDraft);
    lastLocalDraft = draft.value;
    applyConvBgFromPref(d);
  }).catch(() => {});
}

let rpOpenAt = 0;
function openRedPacket(m) {
  const now = Date.now();
  if (now - rpOpenAt < 350) return;
  rpOpenAt = now;
  const ext = parseExt(m);
  rpModal.value = {
    open: true,
    id: m.id,
    amount: ext.amount,
    note: ext.note || '恭喜发财',
    status: ext.status || '',
    packetId: ext.packetId,
    isMine: isMineMsg(m),
  };
}

let tfOpenAt = 0;
function openTransfer(m) {
  const now = Date.now();
  if (now - tfOpenAt < 350) return;
  tfOpenAt = now;
  const ext = parseExt(m);
  tfModal.value = {
    open: true,
    id: m.id,
    amount: ext.amount,
    note: ext.note || '',
    status: ext.status || '',
    transferId: ext.transferId,
    isMine: isMineMsg(m),
  };
}

function confirmRedPacket() {
  const info = rpModal.value;
  if (!info?.open) return;
  if (info.isMine || info.status === 'claimed') {
    rpModal.value = { open: false };
    return;
  }
  if (!socket?.connected) {
    showToast('连接中, 请稍后再试');
    return;
  }
  const mId = info.id;
  socket.emit('redpacket:claim', { messageId: mId, packetId: info.packetId }, (res) => {
    if (res?.ok) {
      showToast(`已领取 ¥${res.amount}`);
      const row = messages.value.find((x) => x.id === mId);
      if (row) row.ext = { ...parseExt(row), status: 'claimed', amount: res.amount };
      rpModal.value = { open: false };
      return;
    }
    showToast(res?.error || '领取失败');
  });
}

function confirmTransfer() {
  const info = tfModal.value;
  if (!info?.open) return;
  if (info.isMine || info.status === 'claimed') {
    tfModal.value = { open: false };
    return;
  }
  if (!socket?.connected) {
    showToast('连接中, 请稍后再试');
    return;
  }
  const mId = info.id;
  socket.emit('transfer:claim', { messageId: mId, transferId: info.transferId }, (res) => {
    if (res?.ok) {
      showToast(`已收款 ¥${res.amount}`);
      const row = messages.value.find((x) => x.id === mId);
      if (row) row.ext = { ...parseExt(row), status: 'claimed' };
      tfModal.value = { open: false };
      return;
    }
    showToast(res?.error || '收款失败');
  });
}

function parseExt(m) {
  if (!m) return {};
  if (m.ext && typeof m.ext === 'object') return m.ext;
  if (typeof m.ext === 'string') {
    try { return JSON.parse(m.ext) || {}; } catch { return {}; }
  }
  return {};
}

function isMineMsg(m) {
  return m?.senderType === 'user' && m?.senderName === props.me?.nickname;
}

const rpModal = ref({ open: false });
const tfModal = ref({ open: false });
const payOverlay = ref({
  open: false, kind: 'redpacket', mode: 'claim', amount: null, note: '', status: '',
  isMine: false, senderName: '', senderAvatar: null, senderEmoji: '🧧',
  packetId: null, transferId: null, messageId: null, tip: '',
});
const createPay = ref({
  kind: 'redpacket',
  amount: 0,
  amountText: '',
  note: '',
  open: false,
  balance: null,
  rpType: 'exclusive',
  rpCount: 5,
  cover: 'classic',
});

function payKindOf(m) {
  if (m?.mediaType === 'redpacket' || /^\[微信红包\]/.test(String(m?.content || ''))) return 'redpacket';
  if (m?.mediaType === 'transfer' || /^\[转账\]/.test(String(m?.content || ''))) return 'transfer';
  return null;
}

function openPayOverlayFromMsg(m) {
  const kind = payKindOf(m);
  if (!kind) return;
  const ext = parseExt(m);
  const mine = isMineMsg(m);
  payOverlay.value = {
    open: true,
    kind,
    mode: 'claim',
    amount: ext.amount ?? ext.totalAmount,
    totalAmount: ext.totalAmount ?? ext.amount,
    remaining: ext.remaining,
    claimedCount: ext.claimedCount,
    totalCount: ext.totalCount,
    leftCount: ext.leftCount,
    rpType: ext.rpType || 'exclusive',
    cover: ext.cover || 'classic',
    coverEmoji: ext.coverEmoji || '🧧',
    coverFrom: ext.coverFrom || '#e8534a',
    coverTo: ext.coverTo || '#c20c0c',
    coverLabel: ext.coverLabel || '经典红包',
    claims: ext.claims || [],
    expired: ext.status === 'expired',
    isBest: false,
    note: ext.note || (kind === 'redpacket' ? '恭喜发财，大吉大利' : ''),
    status: ext.status || '',
    isMine: mine,
    senderName: mine ? (props.me?.nickname || '我') : (m.senderName || '好友'),
    senderAvatar: mine ? props.me?.avatar : null,
    senderEmoji: ext.coverEmoji || '🧧',
    packetId: ext.packetId,
    transferId: ext.transferId,
    messageId: m.id,
    tip: '',
  };
  if (kind === 'redpacket' && ext.packetId) refreshRedpacketDetail(ext.packetId, m.id);
}

async function refreshRedpacketDetail(packetId, messageId) {
  try {
    const d = await api.redpacketDetail(packetId);
    const p = d?.packet;
    if (!p) return;
    payOverlay.value = {
      ...payOverlay.value,
      status: p.status || payOverlay.value.status,
      amount: p.totalAmount ?? p.amount ?? payOverlay.value.amount,
      totalAmount: p.totalAmount ?? payOverlay.value.totalAmount,
      remaining: p.remaining,
      claimedCount: p.claimedCount,
      totalCount: p.totalCount,
      leftCount: p.leftCount,
      claims: p.claims || payOverlay.value.claims,
      rpType: p.rpType || payOverlay.value.rpType,
      note: p.note || payOverlay.value.note,
      expired: p.status === 'expired',
    };
    const row = messages.value.find((x) => x.id === messageId);
    if (row) {
      row.ext = { ...parseExt(row), ...p };
    }
  } catch { /* 明细刷新失败不阻断打开 */ }
}

function onPayConfirmGroup() {
  const info = payOverlay.value;
  if (!info.open || !socket?.connected) {
    showToast('连接中, 请稍后再试');
    return;
  }
  const ev = info.kind === 'redpacket' ? 'redpacket:claim' : 'transfer:claim';
  const payload = info.kind === 'redpacket'
    ? { messageId: info.messageId, packetId: info.packetId }
    : { messageId: info.messageId, transferId: info.transferId };
  socket.emit(ev, payload, (res) => {
    if (res?.ok) {
      const bestTip = res.isBest ? '，手气最佳 👑' : '';
      showToast(info.kind === 'redpacket' ? `已领取 ¥${res.amount}${bestTip}` : `已收款 ¥${res.amount}`);
      const row = messages.value.find((x) => x.id === info.messageId);
      if (row) {
        const p = res.payload || {};
        row.ext = {
          ...parseExt(row),
          ...p,
          status: p.status || 'claimed',
          amount: res.amount ?? p.amount,
          claims: p.claims || parseExt(row).claims || [],
        };
      }
      payOverlay.value = {
        ...payOverlay.value,
        status: res.payload?.status || 'claimed',
        amount: res.amount,
        claims: res.payload?.claims || payOverlay.value.claims,
        claimedCount: res.payload?.claimedCount,
        totalCount: res.payload?.totalCount,
        remaining: res.payload?.remaining,
        leftCount: res.payload?.leftCount,
        isBest: !!res.isBest,
        tip: res.isBest ? '手气最佳！' : '',
        isMine: false,
      };
      // 保持打开展示金额
      return;
    }
    showToast(res?.error || '操作失败');
  });
}

function openCreatePayGroup(kind) {
  createPay.value = {
    kind,
    amount: 0,
    amountText: '',
    note: kind === 'redpacket' ? '' : '',
    open: true,
    balance: createPay.value.balance,
    rpType: 'exclusive',
    rpCount: kind === 'redpacket' ? 5 : 1,
    cover: 'classic',
  };
  api.wallet().then((w) => {
    createPay.value = { ...createPay.value, balance: w.balance };
  }).catch(() => {});
}

function submitCreatePayGroup() {
  const info = createPay.value;
  const amount = Number(info.amountText || info.amount);
  if (!(amount > 0) || !socket?.connected) {
    showToast(!socket?.connected ? '连接中, 请稍后再试' : '请输入金额');
    return;
  }
  const isRP = info.kind === 'redpacket';
  const note = info.note || (isRP ? '恭喜发财，大吉大利' : '');
  const rpType = info.rpType || 'exclusive';
  const rpCount = Number(info.rpCount) || 1;
  if (isRP && rpType === 'lucky' && amount < rpCount * 0.01) {
    showToast(`拼手气总额至少 ¥${(rpCount * 0.01).toFixed(2)}`);
    return;
  }
  const ext = isRP
    ? { amount, note, rpType, rpCount: rpType === 'lucky' ? rpCount : 1, cover: info.cover || 'classic' }
    : { amount, note };
  socket.emit('message:send', {
    conversationId: conversationId.value,
    content: isRP
      ? `[微信红包]${rpType === 'lucky' ? '拼手气' : ''}${note}`
      : `[转账]¥${amount}`,
    mediaType: info.kind,
    ext,
  }, (res) => {
    if (res?.error) {
      showToast(res.error);
      return;
    }
    createPay.value = { ...info, open: false };
  });
}
const showRp = ref(false);
const rpAmount = ref(1);
const rpNote = ref('恭喜发财');
const showTf = ref(false);
const tfAmount = ref(1);
const tfNote = ref('');
const showLoc = ref(false);
const locName = ref('当前位置');
const fileInput2 = ref(null);

function openRedPacketSheet() {
  showRp.value = true;
  dockMode.value = 0;
}

function openTransferSheet() {
  showTf.value = true;
  dockMode.value = 0;
}

function openLocationSheet() {
  showLoc.value = true;
  locName.value = '当前位置';
  dockMode.value = 0;
}

function pickChatFile() {
  fileInput2.value?.click();
}

async function onChatFile(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('读取文件失败'));
      reader.readAsDataURL(file);
    });
    const { url } = await api.uploadChatMedia(data, 'file').catch(async () => {
      // 文件也走 chat upload, 不支持则当图片/二进制
      return api.uploadChatMedia(data, 'image');
    });
    if (!url) throw new Error('上传失败');
    const sizeLabel = file.size > 1024 * 1024
      ? (file.size / 1024 / 1024).toFixed(1) + 'MB'
      : Math.max(1, Math.round(file.size / 1024)) + 'KB';
    socket.emit('message:send', {
      conversationId: conversationId.value,
      content: `[文件]${file.name}`,
      mediaType: 'file',
      mediaUrl: url,
      ext: { name: file.name, sizeLabel },
    }, (res) => {
      if (res?.error) showToast(res.error);
    });
    dockMode.value = 0;
  } catch (err) {
    showToast(err.message || '发送文件失败');
  }
}

async function sendCard() {
  const membersList = members.value.aiMembers || [];
  const target = membersList.find((a) => a.nickname !== props.me.nickname) || membersList[0];
  if (!target) {
    showToast('暂无可推荐名片');
    return;
  }
  socket.emit('message:send', {
    conversationId: conversationId.value,
    content: target.nickname,
    mediaType: 'card',
    ext: {
      nickname: target.nickname,
      personaId: target.id,
      avatar: target.avatarUrl || null,
    },
  }, (res) => {
    if (res?.error) showToast(res.error);
  });
  dockMode.value = 0;
  showToast('已发送名片');
}

function sendRedPacket() {
  const amount = Number(rpAmount.value);
  if (!(amount > 0)) {
    showToast('金额不合法');
    return;
  }
  socket.emit('message:send', {
    conversationId: conversationId.value,
    content: `[微信红包]${rpNote.value}`,
    mediaType: 'redpacket',
    ext: { amount, note: rpNote.value || '恭喜发财' },
  }, (res) => {
    if (res?.error) showToast(res.error);
  });
  showRp.value = false;
  dockMode.value = 0;
}

function sendTransfer() {
  const amount = Number(tfAmount.value);
  if (!(amount > 0)) {
    showToast('金额不合法');
    return;
  }
  socket.emit('message:send', {
    conversationId: conversationId.value,
    content: `[转账]¥${amount}`,
    mediaType: 'transfer',
    ext: { amount, note: tfNote.value },
  }, (res) => {
    if (res?.error) showToast(res.error);
  });
  showTf.value = false;
  dockMode.value = 0;
}

function sendLocation() {
  socket.emit('message:send', {
    conversationId: conversationId.value,
    content: locName.value || '位置',
    mediaType: 'location',
    ext: { name: locName.value || '位置' },
  }, (res) => {
    if (res?.error) showToast(res.error);
  });
  showLoc.value = false;
  dockMode.value = 0;
}

const locDetail = ref(null);
const showNicknames = ref(true);
function openLocDetail(m) {
  locDetail.value = { name: m.ext?.name || m.content || '位置' };
}

function onAvatarDbl(m) {
  if (!m || m.senderType === 'system') return;
  if (isMine(m)) return;
  socket?.emit(
    'message:pat',
    { conversationId: conversationId.value, targetName: m.senderName },
    (res) => {
      if (res?.error) showToast(res.error);
    }
  );
}

function findMemberByName(name) {
  const ai = (members.value.aiMembers || []).find((a) => a.nickname === name || a.name === name);
  if (ai) {
    return {
      id: ai.personaId || ai.id,
      userId: null,
      nickname: ai.nickname || name,
      avatar: ai.avatarUrl || ai.avatar || null,
      emoji: ai.emoji || null,
      color: ai.color || '#07c160',
      avatarColor: ai.color || '#07c160',
      isAI: true,
      personaId: ai.personaId || ai.id,
      isFriend: false,
      local: true,
      wxid: null,
    };
  }
  const human = (members.value.allUsers || members.value.onlineUsers || []).find(
    (u) => u.nickname === name || u.name === name
  );
  if (human) {
    return {
      id: human.id ?? human.userId,
      userId: human.id ?? human.userId,
      nickname: human.nickname || name,
      avatar: human.avatar || null,
      emoji: human.emoji || null,
      color: human.color || human.avatarColor,
      avatarColor: human.avatarColor || human.color,
      isAI: false,
      isFriend: Boolean(human.isFriend ?? true),
      local: false,
      wxid: human.wxid || null,
      signature: human.signature || null,
    };
  }
  return {
    id: null,
    userId: null,
    nickname: name,
    avatar: null,
    emoji: null,
    color: '#888',
    avatarColor: '#888',
    isAI: false,
    isFriend: false,
    local: true,
  };
}

function openMemberProfile(m) {
  if (!m || m.senderType === 'system') return;
  if (isMine(m)) {
    emit('open-profile', {
      id: props.me?.id,
      userId: props.me?.id,
      nickname: props.me?.nickname,
      avatar: props.me?.avatar,
      color: props.me?.avatarColor,
      avatarColor: props.me?.avatarColor,
      isAI: false,
      isSelf: true,
      isFriend: false,
    });
    return;
  }
  emit('open-profile', findMemberByName(m.senderName));
}

function onAvatarTap(m) {
  openMemberProfile(m);
}

function onBodyTouchStart(e) {
  if (dockMode.value === 0 && !showMentionPicker.value) return;
  pullY.value = e.touches?.[0]?.clientY ?? 0;
}

function onBodyTouchEnd(e) {
  if (dockMode.value === 0 && !showMentionPicker.value) return;
  const y = e.changedTouches?.[0]?.clientY ?? 0;
  if (y - pullY.value > 56) {
    dockMode.value = 0;
    showMentionPicker.value = false;
    textareaRef.value?.blur();
  }
  pullY.value = 0;
}

const onlineCount = computed(() => members.value.onlineUsers.length + members.value.aiMembers.length);

const seenMsgIds = new Set();

function appendIncoming(m) {
  if (!m || m.id == null) return;
  const idx = messages.value.findIndex((x) => x.id === m.id);
  if (idx >= 0) {
    messages.value[idx] = m;
    persistMessages();
    return;
  }
  // 去掉乐观本地气泡
  const meNick = props.me?.nickname;
  if (m.senderName === meNick) {
    messages.value = dropLocalEcho(messages.value, m, meNick);
  }
  seenMsgIds.add(m.id);
  messages.value.push(m);
  persistMessages();
  const el = listEl.value;
  const nearBottom = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  if (nearBottom) scrollToBottom();
  if (m.senderType && m.senderType !== 'system' && m.senderName !== props.me?.nickname) {
    const body = m.mediaType === 'image' ? '[图片]'
      : m.mediaType === 'voice' ? '[语音]'
      : (m.content || '').slice(0, 40);
    notifyMessage({
      title: `${chatTitle.value} · ${m.senderName || ''}`,
      body,
      tag: `chat-${conversationId.value || 'default'}`,
    });
    playMsgSound();
  }
}

function loadHistoryNow(beforeId = null) {
  if (!socket) socket = getSocket();
  const run = () => {
    if (loadingHistory.value) return;
    loadingHistory.value = true;
    const el = listEl.value;
    const prevHeight = el?.scrollHeight ?? 0;
    const payload = { beforeId, conversationId: conversationId.value };
    const timer = setTimeout(() => { loadingHistory.value = false; }, 4000);
    socket.emit('history:load', payload, (rows) => {
      clearTimeout(timer);
      const list = Array.isArray(rows) ? rows : [];
      if (!list.length && beforeId) noMoreHistory.value = true;
      seedSeenIds(list);
      const merged = beforeId ? [...list, ...messages.value] : (list.length ? list : messages.value);
      const map = new Map();
      for (const m of merged) if (m?.id != null) map.set(m.id, m);
      messages.value = [...map.values()].sort((a, b) => a.id - b.id);
      persistMessages();
      loadingHistory.value = false;
      booting.value = false;
      if (beforeId) {
        nextTick(() => {
          if (el) el.scrollTop = el.scrollHeight - prevHeight;
        });
      } else if (messages.value.length) {
        scrollToBottom(false);
      }
    });
  };
  if (socket.connected) {
    run();
  } else {
    const onConnect = () => {
      try { socket?.off('connect', onConnect); } catch { /* ignore */ }
      run();
    };
    socket.on('connect', onConnect);
    setTimeout(() => {
      try { socket?.off('connect', onConnect); } catch { /* ignore */ }
      booting.value = false;
    }, 2500);
  }
}

onMounted(() => {
  ensureNotifyPermission().catch(() => {});
  if (props.pendingSearch) {
    showSearch.value = true;
    emit('search-used');
  }

  // 1) 本地缓存立刻绘制
  const cached = loadMsgCache(cacheKey.value);
  if (cached.length) {
    messages.value = cached;
    seedSeenIds(cached);
    booting.value = false;
    nextTick(() => scrollToBottom(false));
  }

  // 2) 历史立刻请求(共享 socket 已连则马上拉)
  loadHistoryNow();
  loadServerDraft();
  const gid = conversationId.value?.startsWith('grp_')
    ? Number(conversationId.value.replace(/^grp_/, ''))
    : (props.chat?.groupId || null);
  if (gid) {
    api.groupInfo(gid).then((d) => {
      const n = d?.group?.notice || '';
      groupNotice.value = n;
      if (n && !noticeShown.value) {
        noticeShown.value = true;
        showToast(`群公告：${String(n).slice(0, 60)}`);
      }
    }).catch(() => {});
  }

  // 3) 共享 socket
  socket = getSocket();
  connected.value = socket.connected;
  const joinRooms = () => {
    if (conversationId.value && String(conversationId.value).startsWith('grp_')) {
      socket.emit('group:join', conversationId.value);
    }
    api.chatRead(conversationId.value || 'default').catch(() => {});
    api.groupRead(conversationId.value || 'default').catch(() => {});
  };
  if (socket.connected) {
    everConnected.value = true;
    joinRooms();
  }

  const onConnect = () => {
    connected.value = true;
    everConnected.value = true;
    joinRooms();
    if (!messages.value.length) loadHistoryNow();
  };
  const onDisconnect = () => { connected.value = false; };
  const onMessageNew = (m) => {
    if (conversationId.value) {
      if (m.conversationId && m.conversationId !== conversationId.value) return;
      if (!m.conversationId && !isDefaultChat.value) return;
    } else if (!isDefaultChat.value) {
      return;
    }
    appendIncoming(m);
  };
  const onGroupMsg = (m) => {
    if (conversationId.value && m.conversationId && m.conversationId !== conversationId.value) return;
    if (conversationId.value && !m.conversationId && !isDefaultChat.value) return;
    appendIncoming(m);
  };
  const onMembers = (data) => {
    members.value = data;
    emit('members', data);
    groupMemberCount.value = (data.onlineUsers?.length || 0) + (data.aiMembers?.length || 0) + (data.allUsers?.length || 0);
  };
  const onTypingStart = (p) => {
    if (p?.conversationId && conversationId.value && p.conversationId !== conversationId.value) return;
    if (p?.name && p.name !== props.me.nickname) {
      typingNames.value = [...new Set([...typingNames.value, p.name])];
    }
  };
  const onTypingStop = (p) => {
    if (p?.name) typingNames.value = typingNames.value.filter((n) => n !== p.name);
  };
  const onChatSync = (p) => {
    if (p?.type !== 'draft') return;
    const conv = conversationId.value || 'default';
    if (p.conversationId !== conv) return;
    draftSync.applyRemote(conv, p.draft || '');
    lastLocalDraft = draft.value;
  };

  const onCallIncoming = (payload) => {
    if (!payload?.from) return;
    emit('open-video-call', {
      role: 'callee',
      callMode: payload.mode || 'video',
      callId: payload.callId,
      incoming: payload,
      target: {
        nickname: payload.from.nickname,
        avatar: payload.from.avatar,
        color: payload.from.avatarColor || '#07c160',
        userId: payload.from.userId,
      },
    });
  };
  unbinders = [
    bindSocket('connect', onConnect),
    bindSocket('disconnect', onDisconnect),
    bindSocket('message:new', onMessageNew),
    bindSocket('group:message', onGroupMsg),
    bindSocket('members:update', onMembers),
    bindSocket('typing:start', onTypingStart),
    bindSocket('typing:stop', onTypingStop),
    bindSocket('chat:sync', onChatSync),
    bindSocket('call:incoming', onCallIncoming),
  ];

  if (groupReadTimer) clearInterval(groupReadTimer);
  groupReadTimer = setInterval(() => {
    api.groupPeerRead(conversationId.value || 'default').then((d) => {
      if (typeof d?.readCount === 'number') {
        groupReadCount.value = d.readCount;
        groupMemberCount.value = d.memberCount || groupMemberCount.value;
      }
    }).catch(() => {});
  }, 5000);
});

onBeforeUnmount(() => {
  persistMessages();
  unbinders.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
  unbinders = [];
  disposeVoice();
  clearTimeout(longPressTimer);
  clearTimeout(typingTimer);
  if (groupReadTimer) clearInterval(groupReadTimer);
  groupReadTimer = null;
});
</script>

<template>
  <div class="chat-page" :style="convBg ? { '--chat-bg': convBg } : undefined">
    <header class="nav-bar">
      <button class="icon-btn nav-back" aria-label="返回" @click="emit('back')">
        <svg viewBox="0 0 24 24" width="24" height="24"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <div class="nav-title">
        <span class="title-text">{{ chatTitle }}</span>
        <span v-if="isDefaultChat" class="member-count">({{ onlineCount }})</span>
        <span v-if="!isDefaultChat && groupReadCount > 0" class="read-count">{{ groupReadCount }}人已读</span>
      </div>
      <button class="icon-btn nav-more" aria-label="更多" @click="openChatMore">
        <svg viewBox="0 0 24 24" width="22" height="22"><circle cx="5" cy="12" r="1.7" fill="currentColor"/><circle cx="12" cy="12" r="1.7" fill="currentColor"/><circle cx="19" cy="12" r="1.7" fill="currentColor"/></svg>
      </button>
    </header>

    <div v-if="showConnHint" class="conn-bar">连接已断开，正在重连…</div>
    <div v-else-if="groupNotice" class="notice-bar" @click="showToast(groupNotice)">
      <span class="notice-tag">公告</span>
      <span class="notice-text">{{ groupNotice }}</span>
    </div>

    <div v-if="multiMode" class="multi-bar">
      <button @click="exitMulti">取消</button>
      <span>已选 {{ selectedIds.length }}</span>
      <button :disabled="!selectedIds.length" @click="forwardSelected">转发</button>
      <button class="danger" :disabled="!selectedIds.length" @click="deleteSelected">删除</button>
    </div>

    <div v-if="typingNames.length" class="typing-bar">
      {{ typingNames.slice(0, 2).join('、') }}{{ typingNames.length > 2 ? '等' : '' }} 正在输入…
    </div>

    <main
      class="chat-body scroll-y"
      ref="listEl"
      :style="convBg ? { '--chat-bg': convBg } : undefined"
      @scroll="onScroll"
      @click="dockMode === 1 || dockMode === 2 ? (dockMode = 0) : null"
      @touchstart.passive="onBodyTouchStart"
      @touchend.passive="onBodyTouchEnd"
    >
      <div v-if="booting && !messages.length" class="history-tip">正在加载聊天记录…</div>
      <div v-else-if="!messages.length" class="history-tip">还没有消息，来说点什么吧</div>
      <div v-else-if="noMoreHistory && messages.length" class="history-tip">没有更多消息了</div>

      <template v-for="(m, i) in messages" :key="m.id">
        <div v-if="showTime(i)" class="time-divider">{{ fmtTime(m.createdAt) }}</div>

        <div v-if="m.senderType === 'system'" class="sys-msg"><span>{{ sysText(m) }}</span></div>

        <div
          v-else
          class="msg-row"
          :class="{
            mine: isMine(m),
            cont: sameSenderAsPrev(i),
            selected: multiMode && selectedIds.includes(m.id),
            'press-flash': actionMsg && actionMsg.id === m.id,
          }"
          @click="multiMode ? toggleSelect(m.id) : null"
          @pointerdown="!multiMode && startLongPress(m, $event)"
          @pointerup="clearLongPress"
          @pointerleave="clearLongPress"
          @pointercancel="clearLongPress"
        >
          <span v-if="multiMode" class="check-box" :class="{ on: selectedIds.includes(m.id) }"></span>
          <div v-if="!sameSenderAsPrev(i)" class="avatar-wrap" @click.stop="openMemberProfile(m)" style="cursor:pointer">
            <UserAvatar v-bind="avatarProps(m)" />
          </div>
          <div v-else class="avatar-spacer"></div>
          <div class="msg-col">
          <div v-if="showNicknames && !isMine(m) && !sameSenderAsPrev(i)" class="sender-name">{{ m.senderName }}</div>
            <div v-if="m.quote" class="quote-box">
              <div class="quote-name">{{ m.quote.name }}</div>
              <div class="quote-text">{{ m.quote.content }}</div>
            </div>
            <img
              v-if="m.mediaType === 'image'"
              class="bubble img-bubble"
              :src="m.mediaUrl"
              alt="图片"
              loading="lazy"
              @click="openPreview(m.mediaUrl)"
            />
            <video
              v-else-if="m.mediaType === 'video'"
              class="bubble media-video"
              :src="m.mediaUrl"
              controls
              preload="metadata"
            ></video>
            <div
              v-else-if="m.mediaType === 'voice'"
              class="bubble voice-bubble"
              :class="{ playing: isVoicePlaying(m), mine: isMine(m) }"
              :style="{ minWidth: voiceWidth(m) }"
              @click="playVoice(m)"
            >
              <span v-if="!isMine(m)" class="voice-wave"><i></i><i></i><i></i></span>
              <span class="voice-dur">{{ parseVoiceSeconds(m.content) }}″</span>
              <span v-if="isMine(m)" class="voice-wave"><i></i><i></i><i></i></span>
              <span
                v-if="isVoicePlaying(m)"
                class="voice-progress"
                :style="{ width: `${Math.round((voiceProgress || 0) * 100)}%` }"
              ></span>
            </div>
            <div v-else-if="m.mediaType === 'card'" class="bubble card-bubble" @click="showToast('名片：' + (m.ext?.nickname || m.content))">
              <div class="card-name">{{ m.ext?.nickname || m.content }}</div>
              <div class="card-sub">个人名片</div>
            </div>
            <WxPayCard
              v-else-if="payKindOf(m)"
              class="bubble"
              :kind="payKindOf(m)"
              :amount="parseExt(m).amount ?? parseExt(m).totalAmount"
              :note="parseExt(m).note"
              :status="parseExt(m).status"
              :is-mine="isMineMsg(m)"
              :content="m.content"
              :rp-type="parseExt(m).rpType || 'exclusive'"
              :claimed-count="parseExt(m).claimedCount"
              :total-count="parseExt(m).totalCount"
              :cover-emoji="parseExt(m).coverEmoji"
              :remaining="parseExt(m).remaining"
              :expired="parseExt(m).status === 'expired'"
              @open="openPayOverlayFromMsg(m)"
            />
            <div v-else-if="m.mediaType === 'location'" class="bubble loc-bubble" @click="openLocDetail(m)">
              <div class="loc-map">
                <div class="loc-grid"></div>
                <div class="loc-pin">📍</div>
              </div>
              <div class="loc-name">{{ m.ext?.name || m.content || '位置' }}</div>
            </div>
            <div
              v-else-if="m.mediaType === 'file'"
              class="bubble file-bubble"
              @click="openFileMsg(m)"
            >
              <div class="file-icon">📄</div>
              <div class="file-main">
                <div class="file-name">{{ String(m.ext?.name || m.content || '文件').replace(/^\[文件\]/, '') }}</div>
                <div class="file-sub">点击预览 / 下载</div>
              </div>
            </div>
            <div
              v-else-if="m.mediaType === 'jielong' || (m.ext && m.ext.jieleng)"
              class="bubble jieleng-bubble"
              @click="openJielengMsg(m)"
            >
              <div class="jl-head">
                <span class="jl-tag">接龙</span>
                <span class="jl-title">{{ parseExt(m).title || '群接龙' }}</span>
              </div>
              <div class="jl-body">
                <div v-for="(line, li) in jielengLines(m)" :key="li" class="jl-line">{{ line }}</div>
              </div>
              <div class="jl-foot">参与接龙 ›</div>
            </div>
            <div
              v-else-if="m.mediaType === 'groupcollect' || (m.ext && m.ext.collect)"
              class="bubble collect-bubble"
              @click="openCollect(m)"
            >
              <div class="gc-icon">💰</div>
              <div class="gc-main">
                <div class="gc-title">群收款</div>
                <div class="gc-amt">¥{{ Number(parseExt(m).amount || 0).toFixed(2) }}</div>
                <div class="gc-note">{{ parseExt(m).note || '活动费用' }}</div>
              </div>
            </div>
            <div
              v-else-if="m.mediaType === 'merge' || (m.ext && m.ext.mergeItems)"
              class="bubble merge-bubble"
              @click="openMergeExpand(m)"
            >
              <div class="merge-title">聊天记录</div>
              <div class="merge-preview">
                <div v-for="(it, mi) in parseMergeItems(m).slice(0, 4)" :key="mi" class="merge-line">
                  {{ it.name }}: {{ it.content }}
                </div>
              </div>
              <div class="merge-foot">{{ parseMergeItems(m).length }} 条聊天记录 ›</div>
            </div>
            <div v-else class="bubble" v-html="renderContent(m.content)"></div>
            <div
              v-if="isMine(m) && (m.sendStatus === 'sending' || m.sendStatus === 'failed')"
              class="msg-status"
              :class="m.sendStatus === 'failed' ? 'st-failed' : 'st-sending'"
              @click="m.sendStatus === 'failed' && onBubbleRetry(m)"
            >
              <span v-if="m.sendStatus === 'sending'" class="st-clock"></span>
              <span v-else class="st-bang">!</span>
            </div>
            <div v-if="isMine(m) && sendState === 'failed' && lastFailed?.content === m.content && !m.localPending" class="send-fail">
              <span>!</span>
              <button @click="retrySend">重发</button>
            </div>
          </div>
        </div>
      </template>
    </main>

    <!-- @成员 -->
    <div v-if="showMentionPicker" class="mention-picker">
      <div
        v-for="m in filteredMentions.slice(0, 8)"
        :key="m.nickname"
        class="mention-item"
        @mousedown.prevent="selectMention(m)"
      >
        <UserAvatar :name="m.nickname" :avatar="m.avatar" :emoji="m.emoji" :color="m.color" :size="32" />
        <span class="mention-name">{{ m.nickname }}</span>
      </div>
    </div>

    <!-- 输入区 -->
    <footer class="chat-dock">
      <div v-if="quoteMsg" class="quote-strip">
        <div class="quote-strip-main">
          <div class="quote-name">回复 {{ quoteMsg.senderName }}</div>
          <div class="quote-text">{{ quoteMsg.content || '[图片]' }}</div>
        </div>
        <button class="quote-close" @click="clearQuote">×</button>
      </div>
      <div v-if="sendState === 'failed'" class="fail-bar">
        发送失败
        <button @click="retrySend">重试</button>
      </div>
      <div class="input-bar">
        <button class="icon-btn" aria-label="语音" @click="setDock(3)">
          <svg viewBox="0 0 24 24" width="24" height="24"><path d="M8 10a4 4 0 0 1 8 0v2a4 4 0 0 1-8 0v-2z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M6 11a6 6 0 0 0 12 0M12 17v3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
        </button>
        <div class="input-wrap">
          <textarea
            v-show="dockMode !== 3"
            ref="textareaRef"
            v-model="draft"
            class="chat-input"
            rows="1"
            placeholder="说点什么…"
            maxlength="2000"
            @keydown="onKeyDown"
            @compositionstart="onCompositionStart"
            @compositionend="onCompositionEnd"
            @input="onDraftInput"
            @focus="onInputFocus"
            @blur="onInputBlur"
            @paste="onPasteChat"
          ></textarea>
          <button v-show="dockMode === 3" class="hold-talk" :class="{ cancel: recording && recCancel }" type="button" @pointerdown.prevent="startRecord" @pointermove="onRecordMove" @pointerup.prevent="stopRecord" @pointerleave="stopRecord">
            {{ recording ? (recCancel ? '松开取消' : `松开结束 ${recSeconds}s`) : '按住 说话' }}
          </button>
        </div>
        <button class="icon-btn" aria-label="表情" @click="setDock(1)">
          <svg viewBox="0 0 24 24" width="24" height="24"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="9" cy="10.5" r="1.1" fill="currentColor"/><circle cx="15" cy="10.5" r="1.1" fill="currentColor"/><path d="M8.5 14c1.2 1.6 2.6 2.3 3.5 2.3s2.3-.7 3.5-2.3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        </button>
        <button class="icon-btn" aria-label="更多功能" @click="setDock(2)">
          <svg viewBox="0 0 24 24" width="24" height="24"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 8.5v7M8.5 12h7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
        </button>
        <button v-if="draft.trim() && dockMode !== 3" class="send-btn" @click="send">发送</button>
        <button v-else class="icon-btn" aria-label="更多" @click="insertAt">@</button>
      </div>

      <div v-if="dockMode === 1" class="dock-panel emoji-panel">
        <div class="emoji-grid">
          <button
            v-for="(e, i) in displayEmojis"
            :key="emojiPackKey + '-' + i + '-' + e"
            class="emoji-item"
            :class="{ fav: emojiPackKey === 'fav' }"
            @click="insertEmojiTracked(e)"
          >{{ e }}</button>
          <div v-if="!displayEmojis.length" class="emoji-empty">
            {{ emojiPackKey === 'recent' ? '暂无最近表情，点几个试试' : emojiPackKey === 'fav' ? '暂无收藏表情' : '暂无表情' }}
          </div>
        </div>
        <div class="emoji-tabs">
          <button
            v-for="t in emojiTabs"
            :key="t.key"
            type="button"
            class="emoji-tab"
            :class="{ on: emojiPackKey === t.key }"
            @click="pickEmojiTab(t.key)"
          >{{ t.label }}</button>
          <button class="emoji-del" type="button" @click="deleteEmoji">⌫</button>
        </div>
      </div>

      <div v-if="dockMode === 2" class="dock-panel plus-panel">
        <div class="plus-grid">
          <button class="plus-item" type="button" @click="pickChatPhoto"><span class="plus-icon">🖼</span><span>相册</span></button>
          <input ref="photoInput" type="file" accept="image/*" hidden @change="onChatPhoto" />
          <input ref="fileInput2" type="file" accept="*" hidden @change="onChatFile" />
          <button class="plus-item" type="button" @click="pickChatPhoto"><span class="plus-icon">📷</span><span>拍摄</span></button>
          <button class="plus-item" type="button" @click="sendCard"><span class="plus-icon">📇</span><span>名片</span></button>
          <button class="plus-item" type="button" @click="pickChatFile"><span class="plus-icon">📄</span><span>文件</span></button>
          <button class="plus-item" type="button" @click="emit('open-video-call', { callMode: 'video', role: 'caller', target: { nickname: chatTitle, color: '#07c160', userId: null } }); showToast('群聊请先打开成员资料再通话')"><span class="plus-icon">📹</span><span>视频通话</span></button>
          <button class="plus-item" type="button" @click="openLocationSheet"><span class="plus-icon">📍</span><span>位置</span></button>
          <button class="plus-item" type="button" @click="openCreatePayGroup('redpacket')"><span class="plus-icon">🧧</span><span>红包</span></button>
          <button class="plus-item" type="button" @click="openCreatePayGroup('transfer')"><span class="plus-icon">💰</span><span>转账</span></button>
          <button class="plus-item" type="button" @click="showJieleng = true; dockMode = 0"><span class="plus-icon">🐉</span><span>接龙</span></button>
          <button class="plus-item" type="button" @click="showCollect = true; dockMode = 0"><span class="plus-icon">🧾</span><span>群收款</span></button>
          <button class="plus-item" type="button" @click="dockMode = 3"><span class="plus-icon">🎤</span><span>语音输入</span></button>
          <button class="plus-item" type="button" @click="insertAt"><span class="plus-icon">@</span><span>提醒</span></button>
        </div>
      </div>
    </footer>

    <!-- 红包面板 -->
    <div v-if="showRp" class="mask" @click.self="showRp = false">
      <div class="pay-panel">
        <div class="pay-title">发红包</div>
        <div class="pay-row"><span>金额</span><input v-model.number="rpAmount" type="number" min="0.01" step="0.01" placeholder="0.00" /></div>
        <div class="pay-row"><span>祝福语</span><input v-model="rpNote" maxlength="20" placeholder="恭喜发财" /></div>
        <button class="pay-btn" @click="sendRedPacket">塞钱进红包</button>
      </div>
    </div>
    <div v-if="showTf" class="mask" @click.self="showTf = false">
      <div class="pay-panel">
        <div class="pay-title">转账</div>
        <div class="pay-row"><span>金额</span><input v-model.number="tfAmount" type="number" min="0.01" step="0.01" placeholder="0.00" /></div>
        <div class="pay-row"><span>备注</span><input v-model="tfNote" maxlength="20" placeholder="转账说明" /></div>
        <button class="pay-btn" @click="sendTransfer">确认转账</button>
      </div>
    </div>
    <div v-if="showLoc" class="mask" @click.self="showLoc = false">
      <div class="pay-panel">
        <div class="pay-title">位置</div>
        <div class="pay-row"><span>地点</span><input v-model="locName" maxlength="40" placeholder="当前位置名称" /></div>
        <button class="pay-btn" @click="sendLocation">发送位置</button>
      </div>
    </div>
    <div v-if="locDetail" class="mask" @click.self="locDetail = null">
      <div class="pay-panel">
        <div class="pay-title">位置</div>
        <div class="pay-row"><span>{{ locDetail.name }}</span></div>
        <button class="pay-btn" @click="navigator.clipboard?.writeText(locDetail.name); locDetail = null; showToast('已复制位置')">复制位置</button>
      </div>
    </div>
    <div v-if="showJieleng" class="mask" @click.self="showJieleng = false">
      <div class="pay-panel">
        <div class="pay-title">群接龙</div>
        <div class="pay-row"><span>主题</span><input v-model="jielengTitle" maxlength="30" placeholder="例如：周末爬山报名" /></div>
        <div class="pay-row col">
          <span>名单（每行一人，可选）</span>
          <textarea v-model="jielengItems" rows="3" placeholder="思琪\nPerry"></textarea>
        </div>
        <button class="pay-btn" @click="sendJieleng">发送接龙</button>
      </div>
    </div>
    <div v-if="showCollect" class="mask" @click.self="showCollect = false">
      <div class="pay-panel">
        <div class="pay-title">群收款</div>
        <div class="pay-row"><span>人均</span><input v-model.number="collectAmount" type="number" min="0.01" step="0.01" placeholder="0.00" /></div>
        <div class="pay-row"><span>说明</span><input v-model="collectNote" maxlength="20" placeholder="活动费用" /></div>
        <button class="pay-btn" @click="sendGroupCollect">发起收款</button>
      </div>
    </div>

    <!-- 合并转发展开 -->
    <div v-if="mergeExpand" class="merge-expand-mask" @click.self="mergeExpand = null">
      <div class="merge-expand">
        <header class="merge-expand-bar">
          <span>聊天记录</span>
          <button type="button" @click="mergeExpand = null">关闭</button>
        </header>
        <div class="merge-expand-body scroll-y">
          <div v-for="(it, i) in mergeExpand" :key="i" class="merge-expand-item">
            <div class="me-name">{{ it.name || '消息' }}</div>
            <div class="me-content">{{ it.content }}</div>
            <div v-if="it.createdAt" class="me-time">{{ fmtTime(it.createdAt) }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 长按菜单（微信黑色圆角浮层） -->
    <div v-if="actionMsg" class="action-sheet" @click.self="actionMsg = null; actionPressed = false">
      <div class="action-menu" ref="actionMenuEl" @click.stop>
        <div class="action-grid">
          <button v-if="actionMsg.content && !actionMsg.mediaType" class="action-item" @click="doAction('copy')">
            <span class="ai-ico">⧉</span><span>复制</span>
          </button>
          <button class="action-item" @click="doAction('forward')">
            <span class="ai-ico">↗</span><span>转发</span>
          </button>
          <button class="action-item" @click="doAction('favorite')">
            <span class="ai-ico">☆</span><span>收藏</span>
          </button>
          <button v-if="actionMsg.content && actionMsg.mediaType !== 'image' && actionMsg.mediaType !== 'voice'" class="action-item" @click="doAction('quote')">
            <span class="ai-ico">❝</span><span>引用</span>
          </button>
          <button class="action-item" @click="doAction('multi')">
            <span class="ai-ico">☑</span><span>多选</span>
          </button>
          <button v-if="isMine(actionMsg) && actionMsg.senderType === 'user'" class="action-item" @click="doAction('recall')">
            <span class="ai-ico">↩</span><span>撤回</span>
          </button>
          <button class="action-item danger" @click="doAction('delete')">
            <span class="ai-ico">🗑</span><span>删除</span>
          </button>
        </div>
      </div>
    </div>

    <!-- 按住说话全屏层（微信录制态） -->
    <div v-if="recording" class="rec-overlay" :class="{ cancel: recCancel }">
      <div class="rec-panel">
        <div class="rec-mic">
          <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.6">
            <rect x="9" y="3" width="6" height="11" rx="3"/>
            <path d="M6 11a6 6 0 0 0 12 0M12 17v3"/>
          </svg>
        </div>
        <div class="rec-bars">
          <i v-for="n in 12" :key="n" :style="{ height: `${recBarHeight(n)}px` }"></i>
        </div>
        <div class="rec-text">{{ recCancel ? '松开手指，取消发送' : `正在说话 ${recSeconds}s` }}</div>
        <div class="rec-hint">{{ recCancel ? '上滑取消' : '手指上滑，取消发送' }}</div>
      </div>
    </div>

    <!-- 图片预览 -->
    <ImagePreview
      v-if="showImagePreview && previewImages.length"
      :images="previewImages"
      :index="previewIndex"
      @close="closePreview"
      @change="(i) => (previewIndex = i)"
      @forward="onPreviewForward"
    />

    <WxPayOverlay
      :open="payOverlay.open"
      :kind="payOverlay.kind"
      mode="claim"
      :amount="payOverlay.amount"
      :total-amount="payOverlay.totalAmount"
      :remaining="payOverlay.remaining"
      :claimed-count="payOverlay.claimedCount"
      :total-count="payOverlay.totalCount"
      :left-count="payOverlay.leftCount"
      :rp-type="payOverlay.rpType"
      :cover="payOverlay.cover"
      :cover-emoji="payOverlay.coverEmoji"
      :cover-from="payOverlay.coverFrom"
      :cover-to="payOverlay.coverTo"
      :cover-label="payOverlay.coverLabel"
      :claims="payOverlay.claims"
      :is-best="payOverlay.isBest"
      :expired="payOverlay.expired"
      :tip="payOverlay.tip"
      :note="payOverlay.note"
      :status="payOverlay.status"
      :is-mine="payOverlay.isMine"
      :sender-name="payOverlay.senderName"
      :sender-avatar="payOverlay.senderAvatar"
      :sender-emoji="payOverlay.senderEmoji"
      @close="payOverlay = { ...payOverlay, open: false }"
      @confirm="onPayConfirmGroup"
    />
    <WxPayOverlay
      :open="createPay.open"
      :kind="createPay.kind"
      mode="create"
      :create-amount-text="createPay.amountText"
      :create-note="createPay.note"
      :rp-type="createPay.rpType"
      :rp-count="createPay.rpCount"
      :cover="createPay.cover"
      :is-group="true"
      :sender-name="chatTitle"
      :balance="createPay.balance"
      @close="createPay = { ...createPay, open: false }"
      @update:create-amount-text="(v) => (createPay.amountText = v)"
      @update:create-note="(v) => (createPay.note = v)"
      @update:rp-type="(v) => (createPay.rpType = v)"
      @update:rp-count="(v) => (createPay.rpCount = v)"
      @update:cover="(v) => (createPay.cover = v)"
      @submit="submitCreatePayGroup"
    />

    <ForwardSheet
      v-if="showForward"
      :me="me"
      :ids="forwardIds"
      @close="showForward = false; forwardIds = []"
      @done="onForwardDone"
    />

    <!-- 聊天记录搜索 -->
    <div v-if="showSearch" class="hist-search">
      <header class="hist-nav">
        <div class="hist-field">
          <span class="search-entry-icon"></span>
          <input v-model="searchQuery" type="search" placeholder="查找聊天记录" @input="doSearchHistory" />
        </div>
        <button class="text-btn" @click="showSearch = false">取消</button>
      </header>
      <div class="hist-body scroll-y">
        <div v-if="!searchQuery.trim()" class="hist-hint">输入关键词搜索本会话</div>
        <div v-else-if="searching" class="hist-hint">搜索中…</div>
        <div v-else-if="!searchResults.length" class="hist-hint">无结果</div>
        <button
          v-for="m in searchResults"
          :key="m.id"
          class="hist-item"
          @click="showSearch = false; scrollToBottom(false)"
        >
          <div class="hist-name">{{ m.senderName }}</div>
          <div class="hist-text">{{ m.content }}</div>
          <div class="hist-time">{{ fmtTime(m.createdAt) }}</div>
        </button>
      </div>
    </div>
    <FilePreview
      :open="!!filePreview"
      :name="filePreview?.name"
      :url="filePreview?.url"
      :sender="filePreview?.sender"
      @close="filePreview = null"
    />
  </div>
</template>

<style scoped>
.chat-page {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--chat-bg, var(--bg));
  position: relative;
  animation: slideIn var(--dur) var(--ease);
}

.nav-bar {
  height: var(--nav-h);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  background: var(--bg);
  border-bottom: 0.5px solid var(--divider);
  padding: 0 8px;
}
.nav-back { position: absolute; left: 0; top: 0; bottom: 0; margin: auto 0; }
.nav-more { position: absolute; right: 0; top: 0; bottom: 0; margin: auto 0; }
.nav-title {
  display: flex; flex-direction: column; align-items: center;
  max-width: 55%;
}
.title-text {
  font-size: 17px; font-weight: 600;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.member-count {
  font-size: 11px; font-weight: 400; color: var(--text-2); margin-top: 1px;
}
.read-count {
  font-size: 11px;
  color: var(--green);
  margin-top: 1px;
}
.typing-bar {
  flex-shrink: 0;
  padding: 4px 12px;
  font-size: 12px;
  color: var(--text-2);
  background: #f7f7f7;
  border-bottom: 0.5px solid var(--divider-soft);
}
.quote-box {
  max-width: 100%;
  margin-bottom: 4px;
  padding: 6px 8px;
  background: rgba(0,0,0,0.04);
  border-left: 2px solid #c7c7cc;
  border-radius: 2px;
  font-size: 13px;
  line-height: 1.4;
}
.msg-row.mine .quote-box {
  background: rgba(0,0,0,0.05);
  border-left-color: #8fbf6a;
}
.quote-name {
  font-size: 12px;
  color: var(--text-2);
  margin-bottom: 2px;
}
.quote-text {
  font-size: 13px;
  color: var(--text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 220px;
}
.quote-strip {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px 0;
  background: #f7f7f7;
}
.quote-strip-main {
  flex: 1;
  min-width: 0;
  padding: 6px 8px;
  background: #fff;
  border-left: 2px solid #07c160;
  border-radius: 2px;
}
.quote-close {
  width: 28px;
  height: 28px;
  font-size: 20px;
  color: var(--text-2);
  flex-shrink: 0;
}
.fail-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 6px;
  font-size: 13px;
  color: var(--red);
  background: #fff0f0;
}
.fail-bar button {
  color: var(--blue);
  font-size: 13px;
}
.send-fail {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 4px;
  font-size: 12px;
  color: var(--red);
}
.msg-status {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 3px;
  font-size: 11px;
  color: var(--text-3);
}
.msg-row.mine .msg-status { justify-content: flex-end; }
.msg-status.st-failed { color: var(--red); cursor: pointer; }
.st-clock {
  width: 12px; height: 12px; border-radius: 50%;
  border: 1.5px solid var(--text-3);
  border-top-color: transparent;
  animation: st-spin 0.8s linear infinite;
  display: inline-block;
}
.st-bang {
  width: 14px; height: 14px; border-radius: 50%;
  background: var(--red); color: #fff;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 10px; font-weight: 700;
}
@keyframes st-spin { to { transform: rotate(360deg); } }
.msg-row.mine .send-fail {
  justify-content: flex-end;
}
.send-fail button {
  color: var(--blue);
  font-size: 12px;
}

.chat-body {
  flex: 1;
  min-height: 0;
  padding: 12px var(--wx-msg-pad-x, 12px) 8px;
  background: var(--chat-bg, var(--bg));
}
.history-tip {
  text-align: center; color: var(--text-3); font-size: 12px; padding: 8px 0 12px;
}
.time-divider {
  text-align: center;
  color: var(--text-3);
  font-size: var(--wx-time-fs, 12px);
  margin: 16px 0 12px;
}
.sys-msg { display: flex; justify-content: center; margin: 10px 0; }
.sys-msg span {
  max-width: 80%;
  padding: 4px 10px;
  border-radius: 3px;
  background: #d9d9d9;
  color: #666;
  font-size: 12px;
  line-height: 1.4;
  text-align: center;
}

.msg-row {
  display: flex;
  gap: 10px;
  margin-top: var(--wx-msg-gap, 12px);
  margin-bottom: 0;
  align-items: flex-start;
}
/* 连续同人消息：保留可见间隙，避免气泡粘连 */
.msg-row.cont {
  margin-top: var(--wx-msg-gap-cont, 8px);
}
.chat-body > .msg-row:first-child {
  margin-top: 0;
}
.chat-body > .time-divider + .msg-row,
.chat-body > .sys-msg + .msg-row,
.chat-body > .history-tip + .msg-row,
.chat-body > .notice-bar + .msg-row {
  margin-top: 0;
}
.msg-row.mine { flex-direction: row-reverse; }
.msg-row.selected { background: rgba(7, 193, 96, 0.08); }
.check-box {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 1.5px solid #c7c7cc;
  flex-shrink: 0;
  margin-top: 10px;
  align-self: flex-start;
}
.check-box.on {
  background: #07c160;
  border-color: #07c160;
  box-shadow: inset 0 0 0 3px #fff;
}
.multi-bar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  background: var(--white);
  border-bottom: 0.5px solid var(--divider);
  font-size: 14px;
}
.multi-bar button {
  color: var(--blue);
  font-size: 14px;
  min-height: 32px;
  padding: 0 4px;
}
.multi-bar button.danger { color: var(--red); }
.multi-bar button:disabled { color: var(--text-3); }
.avatar-spacer { width: var(--wx-avatar-chat, 40px); flex-shrink: 0; }
.avatar-wrap { flex-shrink: 0; cursor: pointer; }

.msg-col {
  max-width: 68%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}
.msg-row.mine .msg-col { align-items: flex-end; }

.sender-name {
  font-size: var(--wx-name-fs, 12px);
  color: var(--text-3);
  margin-bottom: 4px;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.3;
}

/* 微信经典文本气泡 */
.bubble {
  position: relative;
  padding: var(--wx-bubble-py, 9px) var(--wx-bubble-px, 12px);
  border-radius: var(--wx-bubble-r, 6px);
  background: var(--white);
  font-size: var(--wx-bubble-fs, 17px);
  line-height: var(--wx-bubble-lh, 1.45);
  word-break: break-word;
  white-space: pre-wrap;
  user-select: text;
  transition: background 120ms linear;
  animation: fade-up 140ms var(--ease);
  color: var(--text);
}
.msg-row.press-flash .bubble {
  filter: brightness(0.92);
  transform: scale(0.985);
}
.bubble:active { background: #ececec; }
.msg-row.mine .bubble { background: var(--green-bubble); }
.msg-row.mine .bubble:active { background: #86d95c; }

/* 气泡小尾巴（仅非连续消息） */
.msg-row:not(.cont) .bubble:not(.img-bubble):not(.media-video):not(.wx-rp-card):not(.wx-tf-card)::before {
  content: '';
  position: absolute;
  top: 12px;
  width: 0;
  height: 0;
  border: 5px solid transparent;
  border-top-width: 0;
  border-bottom-width: 6px;
  border-bottom-style: solid;
  margin-top: 1px;
}
.msg-row:not(.mine):not(.cont) .bubble:not(.img-bubble):not(.media-video):not(.wx-rp-card):not(.wx-tf-card)::before {
  left: -6px;
  border-right-color: var(--white);
  border-bottom-color: var(--white);
  border-left-color: transparent;
}
.msg-row.mine:not(.cont) .bubble:not(.img-bubble):not(.media-video):not(.wx-rp-card):not(.wx-tf-card)::before {
  right: -6px;
  border-left-color: var(--green-bubble);
  border-bottom-color: var(--green-bubble);
  border-right-color: transparent;
}

.bubble :deep(.at-mention) { color: var(--blue); }
.msg-row.mine .bubble :deep(.at-mention) { color: #3d5a80; }

.img-bubble {
  padding: 0; background: transparent; overflow: hidden;
  border-radius: var(--wx-bubble-r-media, 4px); max-width: 160px; cursor: pointer;
}
.img-bubble:active { opacity: 0.85; background: transparent; }
.img-bubble {
  width: 140px; height: 140px; object-fit: cover; background: #ddd;
}

.media-video {
  width: 220px; max-height: 280px;
  border-radius: var(--wx-bubble-r-media, 4px);
  background: #000;
}
.card-bubble, .file-bubble, .rp-bubble, .tf-bubble, .loc-bubble {
  width: 230px;
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
}
.card-name { font-size: 15px; color: #111; font-weight: 500; }
.card-sub { margin-top: 4px; font-size: 12px; color: var(--text-2); }
.file-icon { font-size: 28px; }
.file-main { min-width: 0; flex: 1; }
.file-name { font-size: 14px; color: #111; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file-size { margin-top: 2px; font-size: 12px; color: var(--text-2); }
.rp-bubble {
  background: #fa9d3b !important;
  color: #fff;
  width: 230px;
}
.msg-row.mine .rp-bubble { background: #fa9d3b !important; }
.file-bubble {
  display: flex; gap: 10px; align-items: center; min-width: 200px; max-width: 260px;
  background: var(--white) !important; cursor: pointer;
}
.file-icon { font-size: 28px; }
.file-name { font-size: 14px; color: var(--text); word-break: break-all; }
.file-sub { font-size: 11px; color: var(--text-3); margin-top: 2px; }
.loc-bubble { padding: 0 !important; overflow: hidden; width: 200px; background: var(--white) !important; }
.loc-map {
  height: 100px; background: linear-gradient(135deg, #cfe3d8, #b8d4e8);
  position: relative; display: flex; align-items: center; justify-content: center;
}
.loc-grid {
  position: absolute; inset: 0;
  background-image: linear-gradient(rgba(255,255,255,0.35) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,0.35) 1px, transparent 1px);
  background-size: 20px 20px;
}
.loc-pin { position: relative; font-size: 28px; filter: drop-shadow(0 2px 2px rgba(0,0,0,0.2)); }
.loc-name { padding: 8px 10px; font-size: 13px; color: var(--text); }
.merge-bubble { min-width: 200px; max-width: 260px; background: var(--white) !important; cursor: pointer; }
.merge-title { font-size: 14px; font-weight: 600; color: var(--text); margin-bottom: 6px; }
.merge-preview { font-size: 12px; color: var(--text-2); line-height: 1.45; }
.merge-line { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.merge-foot { margin-top: 8px; padding-top: 6px; border-top: 0.5px solid var(--divider-soft); font-size: 12px; color: var(--text-3); }
.emoji-item.fav { background: rgba(7,193,96,0.08); border-radius: 8px; }
.rp-icon { font-size: 32px; }
.rp-note { font-size: 14px; font-weight: 500; }
.rp-sub { margin-top: 2px; font-size: 11px; opacity: 0.9; }
.tf-bubble { width: 230px; }
.tf-icon {
  width: 36px; height: 36px; border-radius: 18px;
  background: #f5a623; color: #fff;
  display: flex; align-items: center; justify-content: center;
  font-weight: 700; font-size: 18px;
}
.tf-amt { font-size: 16px; color: #111; font-weight: 600; }
.tf-sub { margin-top: 2px; font-size: 12px; color: var(--text-2); }
.rp-panel { text-align: center; }
.rp-big-icon { font-size: 48px; margin-bottom: 8px; }
.rp-big-note { font-size: 16px; color: #111; font-weight: 500; }
.rp-big-amt { margin: 10px 0 6px; font-size: 28px; color: #e6433d; font-weight: 700; }
.rp-big-tip { margin: 10px 0 6px; font-size: 14px; color: var(--text-2); }
.tf-big-amt { margin: 8px 0; font-size: 28px; font-weight: 700; color: #e6433d; }
.tf-big-note { margin-bottom: 8px; font-size: 14px; color: var(--text-2); }
.pay-btn.ghost {
  margin-top: 8px;
  background: var(--divider-soft);
  color: var(--text-2);
}
.loc-bubble { width: 230px; display: block; }
.loc-map {
  height: 90px;
  background: linear-gradient(135deg, #cfe3d8, #b8d4e8);
  border-radius: 4px 4px 0 0;
  display: flex; align-items: center; justify-content: center;
  font-size: 28px;
}
.loc-name { padding: 8px 0 2px; font-size: 14px; color: #111; }
.pay-panel {
  width: min(320px, calc(100% - 40px));
  margin: auto;
  background: var(--white);
  border-radius: 10px;
  padding: 16px;
  animation: popIn 160ms var(--ease);
}
.mask {
  position: absolute; inset: 0; background: var(--mask); z-index: 48;
  display: flex;
  animation: fadeIn 160ms var(--ease);
}
.pay-title { font-size: 16px; font-weight: 500; margin-bottom: 12px; text-align: center; }
.pay-row {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 0; border-bottom: 0.5px solid var(--divider-soft);
  font-size: 14px;
}
.pay-row span { width: 64px; color: var(--text-2); }
.pay-row input {
  flex: 1; height: 36px; font-size: 16px; color: var(--text);
  background: transparent;
}
.pay-btn {
  width: 100%; margin-top: 16px; height: 44px;
  border-radius: 8px; background: #07c160; color: #fff; font-size: 16px;
}
.pay-btn:active { background: #06ad56; }
.voice-bubble {
  min-width: 72px;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: nowrap;
  cursor: pointer;
  user-select: none;
}
.voice-bubble.playing {
  animation: voice-pulse 1s ease infinite;
}
@keyframes voice-pulse {
  0%, 100% { filter: brightness(1); }
  50% { filter: brightness(0.9); }
}
.voice-wave {
  width: 14px;
  height: 14px;
  display: flex;
  align-items: center;
  gap: 1.5px;
  flex-shrink: 0;
}
.voice-wave i {
  width: 2px;
  background: #666;
  border-radius: 1px;
  display: block;
}
.msg-row.mine .voice-wave i { background: #3d7a28; }
.voice-wave i:nth-child(1) { height: 5px; }
.voice-wave i:nth-child(2) { height: 9px; }
.voice-wave i:nth-child(3) { height: 13px; }
.voice-bubble.playing .voice-wave i {
  animation: wave 0.8s ease infinite;
}
.voice-bubble.playing .voice-wave i:nth-child(2) { animation-delay: 0.1s; }
.voice-bubble.playing .voice-wave i:nth-child(3) { animation-delay: 0.2s; }
@keyframes wave {
  0%, 100% { transform: scaleY(0.55); }
  50% { transform: scaleY(1.25); }
}
.voice-dur {
  font-size: 12px;
  color: var(--text-2);
  min-width: 1.4em;
  text-align: center;
}
.msg-row.mine .voice-dur { color: rgba(0,0,0,0.45); }
.at-mention.at-all {
  color: #576b95;
  font-weight: 600;
}
.conn-bar {
  text-align: center;
  font-size: 12px;
  color: #fff;
  background: #e6a23c;
  padding: 4px 8px;
}
.voice-bubble { position: relative; overflow: hidden; }
.voice-progress {
  position: absolute; left: 0; bottom: 0; height: 2px;
  background: rgba(7,193,96,0.85); border-radius: 0 1px 1px 0;
}
.msg-row.mine .voice-progress { background: rgba(255,255,255,0.7); }
.jieleng-bubble {
  min-width: 220px; max-width: 260px; background: var(--white) !important; cursor: pointer;
}
.jl-head { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.jl-tag {
  font-size: 11px; background: #07c160; color: #fff; border-radius: 3px; padding: 1px 6px;
}
.jl-title { font-size: 14px; font-weight: 600; color: var(--text); }
.jl-body { font-size: 12px; color: var(--text-2); line-height: 1.5; }
.jl-line { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.jl-foot {
  margin-top: 8px; padding-top: 6px; border-top: 0.5px solid var(--divider-soft);
  font-size: 12px; color: var(--green);
}
.collect-bubble {
  min-width: 220px; max-width: 260px; background: var(--white) !important; cursor: pointer;
  display: flex !important; gap: 10px; align-items: center;
}
.gc-icon { font-size: 28px; }
.gc-title { font-size: 14px; font-weight: 600; color: var(--text); }
.gc-amt { font-size: 18px; font-weight: 700; color: var(--red); margin-top: 2px; }
.gc-note { font-size: 12px; color: var(--text-3); margin-top: 2px; }
.merge-expand-mask {
  position: absolute; inset: 0; z-index: 60; background: var(--mask);
  display: flex; align-items: stretch; justify-content: center;
}
.merge-expand {
  width: min(420px, 100%); margin: 40px 12px; background: var(--white);
  border-radius: 10px; display: flex; flex-direction: column; max-height: 70%;
}
.merge-expand-bar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 14px; border-bottom: 0.5px solid var(--divider); font-weight: 600;
}
.merge-expand-bar button { border: 0; background: transparent; color: var(--green); min-height: 40px; }
.merge-expand-body { flex: 1; overflow: auto; padding: 8px 0; }
.merge-expand-item { padding: 10px 14px; border-bottom: 0.5px solid var(--divider-soft); }
.me-name { font-size: 13px; color: var(--text-2); margin-bottom: 4px; }
.me-content { font-size: 15px; color: var(--text); line-height: 1.45; word-break: break-word; }
.me-time { margin-top: 4px; font-size: 11px; color: var(--text-3); }
.pay-row.col { flex-direction: column; align-items: stretch; gap: 6px; }
.pay-row.col textarea {
  width: 100%; min-height: 72px; border: 1px solid var(--divider); border-radius: 6px;
  padding: 8px; font-size: 14px; resize: vertical; background: var(--white); color: var(--text);
}
.notice-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: #fffbe8;
  border-bottom: 0.5px solid var(--divider);
  font-size: 12px;
  color: #8a6d3b;
  cursor: pointer;
}
.notice-tag {
  flex-shrink: 0;
  background: #e6a23c;
  color: #fff;
  border-radius: 3px;
  padding: 1px 4px;
  font-size: 10px;
}
.notice-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mention-picker {
  background: var(--white); border-top: 0.5px solid var(--divider);
  max-height: 200px; overflow-y: auto; flex-shrink: 0;
}
.mention-item {
  display: flex; align-items: center; padding: 8px 14px; gap: 10px; cursor: pointer;
}
.mention-item:active { background: #f0f0f0; }
.mention-name { font-size: 15px; color: var(--text); }

.chat-dock {
  flex-shrink: 0;
  background: var(--bg);
  border-top: 0.5px solid var(--divider);
  padding-bottom: var(--safe-b);
}
.dock-panel { background: var(--bg); }
.emoji-footer { background: var(--divider-soft); }
.card-name, .file-name, .tf-amt, .loc-name { color: var(--text); }
.hist-search { background: var(--bg); }
.hist-item:active { background: var(--press); }
.input-bar {
  display: flex; align-items: flex-end; gap: 2px;
  padding: 7px 6px; min-height: 54px;
}
.input-wrap {
  flex: 1; min-width: 0; background: var(--white); border-radius: 4px;
  padding: 8px 10px; min-height: 36px; display: flex; align-items: center;
}
.chat-input {
  width: 100%; resize: none; font-size: 16px; line-height: 1.4;
  max-height: 96px; overflow-y: auto; background: transparent;
}
.hold-talk {
  width: 100%; height: 28px; border-radius: 4px; background: var(--white);
  border: 0.5px solid #d0d0d0; font-size: 15px; font-weight: 500;
}
.hold-talk:active { background: #ddd; }
.hold-talk.cancel { background: #fde2e2; color: var(--red); }
.send-btn {
  min-width: 52px; height: 36px; margin: 0 4px 0 2px; border-radius: 4px;
  background: var(--green); color: #fff; font-size: 15px; flex-shrink: 0;
}
.send-btn:active { background: var(--green-press); }

.dock-panel {
  height: 260px; background: #f7f7f7;
  border-top: 0.5px solid var(--divider);
  animation: panelUp var(--dur) var(--ease);
}
.emoji-panel { display: flex; flex-direction: column; }
.emoji-grid {
  flex: 1; overflow-y: auto; display: grid;
  grid-template-columns: repeat(8, 1fr); gap: 2px;
  padding: 10px 8px; align-content: start;
}
.emoji-item {
  height: 40px; font-size: 24px;
  display: flex; align-items: center; justify-content: center; border-radius: 4px;
  border: 0; background: transparent; cursor: pointer;
}
.emoji-item:active { background: #e0e0e0; }
.emoji-empty {
  grid-column: 1 / -1; text-align: center; color: var(--text-3);
  font-size: 13px; padding: 28px 8px;
}
.emoji-tabs {
  height: 40px; display: flex; align-items: center; gap: 2px;
  padding: 0 6px; border-top: 0.5px solid var(--divider-soft); background: #f0f0f0;
  overflow-x: auto;
}
.emoji-tab {
  flex: 0 0 auto; border: 0; background: transparent; color: var(--text-2);
  font-size: 12px; padding: 6px 10px; border-radius: 4px; min-height: 32px; cursor: pointer;
}
.emoji-tab.on { color: #07c160; background: rgba(7,193,96,0.08); font-weight: 600; }
.emoji-del {
  margin-left: auto; min-width: 36px; height: 28px; font-size: 16px; color: var(--text-2);
  border: 0; background: transparent; cursor: pointer;
}
.plus-panel { overflow-y: auto; }
.plus-grid {
  display: grid; grid-template-columns: repeat(4, 1fr);
  gap: 18px 8px; padding: 22px 12px 28px;
}
.plus-item {
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  font-size: 12px; color: var(--text-2); min-height: 44px;
}
.plus-icon {
  width: 56px; height: 56px; border-radius: 8px; background: var(--white);
  display: flex; align-items: center; justify-content: center; font-size: 26px;
}
.plus-item:active .plus-icon { background: #e5e5e5; }

.mask {
  position: absolute; inset: 0; background: var(--mask); z-index: 40;
  animation: fadeIn 160ms var(--ease);
}
.pop-menu {
  position: absolute; top: calc(var(--status-h) + var(--nav-h) - 4px); right: 10px;
  width: 148px; background: #4c4c4c; border-radius: 6px; z-index: 45;
  overflow: hidden; transform-origin: top right; animation: popIn 160ms var(--ease);
}
.pop-item {
  width: 100%; height: 48px; padding: 0 14px; color: #fff; font-size: 15px;
  text-align: left; display: flex; align-items: center; position: relative;
}
.pop-item:active { background: rgba(255,255,255,0.12); }
.pop-item + .pop-item::before {
  content: ""; position: absolute; left: 14px; right: 0; top: 0;
  height: 0.5px; background: rgba(255,255,255,0.12);
}

.action-sheet {
  position: absolute; inset: 0; z-index: 46;
  background: rgba(0, 0, 0, 0.35);
  animation: fadeIn 160ms var(--ease);
}
.action-menu {
  position: absolute; left: 50%; top: 28%; transform: translateX(-50%);
  width: min(280px, calc(100% - 36px));
  background: #4c4c4c; border-radius: 8px; overflow: hidden;
  animation: popIn 200ms var(--ease);
  box-shadow: 0 8px 28px rgba(0,0,0,0.28);
}
.action-grid {
  display: flex; flex-wrap: wrap;
  padding: 4px 0;
}
.action-item {
  flex: 0 0 25%;
  min-width: 25%;
  height: 64px;
  padding: 8px 4px;
  color: #fff; font-size: 12px;
  border: 0; background: transparent;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
  cursor: pointer;
}
.action-item:active { background: rgba(255,255,255,0.12); }
.action-item .ai-ico {
  font-size: 20px; line-height: 1; opacity: 0.95;
}
.action-item.danger { color: #ff6b6b; }
.action-item.danger .ai-ico { color: #ff6b6b; }

/* 按住说话全屏录制层 */
.rec-overlay {
  position: absolute; inset: 0; z-index: 50;
  background: rgba(0,0,0,0.45);
  display: grid; place-items: center;
  pointer-events: none;
}
.rec-panel {
  width: 200px; min-height: 220px;
  background: rgba(40, 40, 40, 0.92);
  border-radius: 12px;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 12px; padding: 24px 16px;
  color: #fff;
}
.rec-overlay.cancel .rec-panel { background: rgba(180, 40, 40, 0.92); }
.rec-mic { color: #fff; opacity: 0.95; }
.rec-bars {
  display: flex; align-items: flex-end; gap: 3px; height: 24px;
}
.rec-bars i {
  width: 3px; border-radius: 2px; background: #07c160;
  display: block; min-height: 4px;
}
.rec-overlay.cancel .rec-bars i { background: #ffb3b3; }
.rec-text { font-size: 14px; font-weight: 500; text-align: center; }
.rec-hint { font-size: 12px; color: rgba(255,255,255,0.65); }

.hold-talk {
  width: 100%; min-height: 42px;
  border: 0; border-radius: 6px;
  background: #f7f7f7; color: #111;
  font-size: 16px; font-weight: 500;
  letter-spacing: 2px;
  user-select: none; -webkit-user-select: none;
  touch-action: none;
}
.hold-talk:active { background: #ddd; }
.hold-talk.cancel { background: #fde2e2; color: var(--red, #fa5151); }
.action-item.danger { color: #ff6b6b; }

.img-preview {
  position: absolute; inset: 0; background: #000; z-index: 50;
  display: flex; align-items: center; justify-content: center;
  animation: fadeIn var(--dur) var(--ease);
}
.img-preview img { max-width: 100%; max-height: 100%; object-fit: contain; }

.hist-search {
  position: absolute;
  inset: 0;
  background: var(--bg);
  z-index: 48;
  display: flex;
  flex-direction: column;
  animation: fadeIn var(--dur) var(--ease);
}
.hist-nav {
  height: var(--nav-h);
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px 0 12px;
  border-bottom: 0.5px solid var(--divider);
  background: var(--bg);
  flex-shrink: 0;
}
.hist-field {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 10px;
  background: var(--white);
  border-radius: 6px;
  min-width: 0;
}
.hist-field input {
  flex: 1;
  min-width: 0;
  font-size: 15px;
  background: transparent;
  color: var(--text);
}
.search-entry-icon {
  width: 14px;
  height: 14px;
  border: 1.5px solid var(--text-3);
  border-radius: 50%;
  position: relative;
  flex-shrink: 0;
}
.search-entry-icon::after {
  content: "";
  position: absolute;
  width: 5px;
  height: 1.5px;
  background: var(--text-3);
  right: -4px;
  bottom: -1px;
  transform: rotate(45deg);
  border-radius: 1px;
}
.text-btn {
  min-width: 44px;
  height: 44px;
  font-size: 15px;
  color: var(--blue);
}
.hist-body {
  flex: 1;
  min-height: 0;
  background: var(--white);
}
.hist-hint {
  padding: 28px 16px;
  text-align: center;
  color: var(--text-3);
  font-size: 14px;
}
.hist-item {
  width: 100%;
  display: block;
  text-align: left;
  padding: 12px 14px;
  border-bottom: 0.5px solid var(--divider-soft);
  background: var(--white);
}
.hist-item:active { background: #f0f0f0; }
.hist-name {
  font-size: 14px;
  color: var(--blue);
  margin-bottom: 4px;
}
.hist-text {
  font-size: 15px;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hist-time {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-3);
}
.preview-close {
  position: absolute; top: 12px; right: 12px; width: 44px; height: 44px;
  color: #fff; font-size: 22px; z-index: 2; border-radius: 50%;
}
.preview-close:active { background: rgba(255,255,255,0.15); }
</style>
