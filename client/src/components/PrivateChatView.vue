<script setup>
import { ref, nextTick, onMounted, onBeforeUnmount, computed } from 'vue';
import { api, compressImage } from '../api.js';
import { EMOJI_LIST, renderContent } from '../chat-shared.js';
import { useVoicePlayer } from '../voice-player.js';
import { ensureNotifyPermission, notifyMessage, playMsgSound, playSendSound } from '../notify.js';
import { makeLocalMsg, patchLocalMsg, dropLocalEcho } from '../chat-send-status.js';
import { toast } from '../toast.js';
import { getSocket, bindSocket } from '../socket-store.js';
import { saveMsgCache, loadMsgCache } from '../chat-cache.js';
import UserAvatar from './UserAvatar.vue';
import ForwardSheet from './ForwardSheet.vue';
import ImagePreview from './ImagePreview.vue';
import WxPayCard from './WxPayCard.vue';
import WxPayOverlay from './WxPayOverlay.vue';

const props = defineProps({
  me: { type: Object, required: true },
  target: { type: Object, required: true },
  pendingSearch: { type: Boolean, default: false },
});
const emit = defineEmits(['back', 'open-profile', 'open-chat-info', 'search-used', 'open-video-call']);

const messages = ref([]);
const draft = ref('');
const convBg = ref('');
const connected = ref(false);
const everConnected = ref(false);
const booting = ref(true);
const loadingHistory = ref(false);
const noMoreHistory = ref(false);
const listEl = ref(null);
const textareaRef = ref(null);
const dockMode = ref(0); // 0 none 1 emoji 2 plus 3 voice
const previewSrc = ref(null);
const actionMsg = ref(null);
const showMore = ref(false);
const chatPrefs = ref({ muted: false, pinned: false, folded: false });
const quoteMsg = ref(null);
const peerTyping = ref(false);
const sendState = ref('idle');
const lastFailed = ref(null);
const showSearch = ref(false);
const searchQuery = ref('');
const searchResults = ref([]);
const searching = ref(false);
const photoInput = ref(null);
const recorder = ref(null);
const recording = ref(false);
const recSeconds = ref(0);
const showForward = ref(false);
const forwardIds = ref([]);
const peerReadId = ref(null);
let recTimer = null;
let typingTimer = null;
let peerReadTimer = null;

const emojiList = EMOJI_LIST;
const favEmojis = (() => {
  try { return JSON.parse(localStorage.getItem('hudui_stickers') || '[]'); }
  catch { return []; }
})();
const { playingKey, voiceProgress, playVoice, disposeVoice, parseVoiceSeconds } = useVoicePlayer();
const previewImages = ref([]);
const previewIndex = ref(0);
const showImagePreview = ref(false);
let lastLocalDraft = '';
const CONV_BG = ['#ededed', '#e7e7e7', '#dce9f7', '#e3f0e6', '#f3efe6', '#2a2a2a'];

function applyConvBgFromPref(d) {
  const key = Number(d?.pref?.bgKey);
  // 0/缺省跟随全局 --chat-bg；1-5 会话专属背景
  convBg.value = Number.isInteger(key) && key > 0 && key < CONV_BG.length ? CONV_BG[key] : '';
}

let socket = null;
let unbinders = [];
let longPressTimer = null;
let composing = false;

const showConnHint = computed(() => everConnected.value && !connected.value);

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

function onCompositionStart() { composing = true; }
function onCompositionEnd() {
  composing = false;
  autoSizeInput();
}
function onKeyDown(e) {
  if (e.key !== 'Enter' || e.shiftKey) return;
  if (composing || e.isComposing) return;
  if (localStorage.getItem('wx_enter_send') === '0') return; // 设置里关了回车发送
  e.preventDefault();
  send();
}

const peerUid = Number(props.target.userId ?? props.target.id ?? 0);
const conversationId = props.target.isAI
  ? `pv_${props.me.id}_ai_${props.target.personaId}`
  : Number.isInteger(peerUid) && peerUid > 0 && peerUid !== props.me.id
    ? `pv_u_${Math.min(props.me.id, peerUid)}_${Math.max(props.me.id, peerUid)}`
    : `pv_u_${props.me.id}_${props.me.id}`;
const canPay = computed(() => {
  if (props.target.isAI) return Boolean(props.target.personaId);
  return Number.isInteger(peerUid) && peerUid > 0;
});

function avatarProps() {
  if (props.target.isAI) {
    return {
      name: props.target.nickname,
      avatar: props.target.avatarUrl ?? props.target.avatar ?? null,
      emoji: props.target.avatarUrl ? null : (props.target.avatarEmoji ?? props.target.emoji ?? '😊'),
      color: '#07c160',
      size: 40,
    };
  }
  return {
    name: props.target.nickname,
    avatar: props.target.avatar ?? null,
    emoji: null,
    color: props.target.color ?? props.target.avatarColor ?? '#4f6ef7',
    size: 40,
  };
}

function myAvatarProps() {
  return {
    name: props.me.nickname,
    avatar: props.me.avatar ?? null,
    emoji: null,
    color: props.me.avatarColor ?? '#4f6ef7',
    size: 40,
  };
}

function isMine(m) {
  if (m?.localPending) return true;
  return m.senderType === 'user' && m.senderName === props.me.nickname;
}

function fmtTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (d.toDateString() === now.toDateString()) return hm;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `昨天 ${hm}`;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
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
}

function seedSeen(rows) {
  for (const r of rows || []) {
    if (r?.id != null) seenIds.add(r.id);
  }
}

const seenIds = new Set();

function persistMessages() {
  saveMsgCache(conversationId, messages.value);
}

async function loadHistory(beforeId = null) {
  if (loadingHistory.value) return;
  if (!socket) socket = getSocket();
  const run = () => {
    loadingHistory.value = true;
    const el = listEl.value;
    const prevHeight = el?.scrollHeight ?? 0;
    const timer = setTimeout(() => { loadingHistory.value = false; }, 4000);
    socket.emit('private:history', { conversationId, beforeId }, (rows) => {
      clearTimeout(timer);
      const list = Array.isArray(rows) ? rows : [];
      if (!list.length && beforeId) noMoreHistory.value = true;
      const merged = beforeId ? [...list, ...messages.value] : (list.length ? list : messages.value);
      const map = new Map();
      for (const m of merged) if (m?.id != null) map.set(m.id, m);
      messages.value = [...map.values()].sort((a, b) => a.id - b.id);
      seedSeen(messages.value);
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
    // 缓存已展示; 连上后再拉
    const onConnect = () => {
      socket?.off('connect', onConnect);
      run();
    };
    socket.on('connect', onConnect);
    setTimeout(() => {
      try { socket?.off('connect', onConnect); } catch { /* ignore */ }
      booting.value = false;
      if (!messages.value.length) loadingHistory.value = false;
    }, 2500);
  }
}

function onScroll() {
  const el = listEl.value;
  if (!el) return;
  if (el.scrollTop < 60 && !noMoreHistory.value && messages.value.length) {
    loadHistory(messages.value[0].id);
  }
}

function setDock(mode) {
  dockMode.value = dockMode.value === mode ? 0 : mode;
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
  if (dockMode.value === 1 || dockMode.value === 2) dockMode.value = 0;
  setTimeout(() => scrollToBottom(false), 80);
}

function send() {
  const content = draft.value.trim();
  if (!content) return;
  if (!socket?.connected) {
    showToast('网络连接中，发送可能稍延迟');
  }
  const payload = {
    conversationId,
    content,
    quote: quoteMsg.value
      ? {
          id: quoteMsg.value.id,
          name: quoteMsg.value.senderName || props.target.nickname,
          content: (quoteMsg.value.content || '[图片]').slice(0, 80),
        }
      : null,
  };
  const local = makeLocalMsg({
    me: props.me,
    conversationId,
    content,
    quote: payload.quote,
  });
  messages.value.push(local);
  sendState.value = 'sending';
  socket.emit('private:send', payload, (res) => {
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
    const still = messages.value.find((m) => m.id === local.id);
    if (still) patchLocalMsg(messages.value, local.id, { sendStatus: 'sent', localPending: false });
    messages.value = [...messages.value];
  });
  draft.value = '';
  quoteMsg.value = null;
  dockMode.value = 0;
  stopTyping();
  api.chatPref({ conversationId, draft: '' }).catch(() => {});
  api.privateRead(conversationId).then((d) => {
    peerReadId.value = d?.peerReadId ?? peerReadId.value;
  }).catch(() => {});
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
  socket.emit('private:send', payload, (res) => {
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
    conversationId,
    content: m.content,
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
      conversationId,
      content: '[图片]',
      mediaType: mediaType || 'image',
      mediaUrl: url,
    });
    messages.value.push(local);
    scrollToBottom();
    socket.emit('private:send', { conversationId, content: '[图片]', mediaType: mediaType || 'image', mediaUrl: url }, (res) => {
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

function openFileMsg(m) {
  const url = m?.mediaUrl;
  if (url) window.open(url, '_blank');
  else showToast('演示文件消息（无附件）');
}

function onPreviewForward(url) {
  const m = messages.value.find((x) => x.mediaUrl === url);
  if (m?.id) {
    forwardIds.value = [m.id];
    showForward.value = true;
  } else {
    showToast('无法转发该图片');
  }
}

function showSendTip(m) {
  if (!isMine(m) || props.target?.isAI) return null;
  if (m.sendStatus === 'sending') return '发送中';
  if (m.sendStatus === 'failed') return '发送失败';
  const lid = lastMineId();
  if (lid && m.id === lid) {
    if (peerReadId.value && m.id <= peerReadId.value) return '已读';
    return '送达';
  }
  return null;
}

function setQuote(m) {
  if (!m || m.senderType === 'system' || m.recalled) return;
  quoteMsg.value = m;
  dockMode.value = 0;
  nextTick(() => textareaRef.value?.focus());
}

function startTyping() {
  if (!socket) return;
  socket.emit('private:typing', { conversationId, typing: true });
}

function stopTyping() {
  if (!socket) return;
  socket.emit('private:typing', { conversationId, typing: false });
}

function onInputTyping() {
  startTyping();
  clearTimeout(typingTimer);
  typingTimer = setTimeout(stopTyping, 1500);
}

function doRecall(m) {
  if (!m || !socket) return;
  socket.emit('message:recall', { id: m.id, conversationId }, (res) => {
    if (res?.error) showToast(res.error);
  });
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
  showToast(payload?.name ? `已转发到「${payload.name}」` : '已转发');
}

function doAction(kind) {
  const m = actionMsg.value;
  actionMsg.value = null;
  if (!m) return;
  if (kind === 'copy' && m.content && navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(m.content).catch(() => {});
  }
  if (kind === 'quote') {
    setQuote(m);
    return;
  }
  if (kind === 'recall') {
    doRecall(m);
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
      fromName: m.senderName || props.target?.nickname || '',
    }).then(() => showToast('已收藏，可在「我 → 收藏」查看')).catch((e) => showToast(e.message || '收藏失败'));
    return;
  }
  if (kind === 'delete') {
    messages.value = messages.value.filter((x) => x.id !== m.id);
  }
}

function openPreview(url) {
  const imgs = messages.value
    .filter((m) => m.mediaType === 'image' && m.mediaUrl)
    .map((m) => m.mediaUrl);
  if (url && !imgs.includes(url)) imgs.unshift(url);
  previewImages.value = imgs.filter(Boolean);
  previewIndex.value = Math.max(0, previewImages.value.indexOf(url));
  showImagePreview.value = true;
}

function voiceWidth(m) {
  const sec = parseVoiceSeconds(m.content);
  return Math.min(160, 48 + sec * 10) + 'px';
}

function isVoicePlaying(m) {
  return playingKey.value === String(m.id ?? m.mediaUrl);
}

function startLongPress(m, e) {
  if (m.senderType === 'system') return;
  if (e?.target?.closest?.('.rp-bubble,.tf-bubble,.pay-mask')) return;
  clearTimeout(longPressTimer);
  longPressTimer = setTimeout(() => {
    actionMsg.value = m;
  }, 480);
}

function clearLongPress() {
  clearTimeout(longPressTimer);
}

function openMore() {
  emit('open-chat-info', {
    conversationId,
    groupName: props.target.remark || props.target.nickname,
    isGroup: false,
    muted: chatPrefs.value.muted,
    pinned: chatPrefs.value.pinned,
    folded: chatPrefs.value.folded,
    remind: Boolean(chatPrefs.value.remind),
    peerUserId: peerUid > 0 ? peerUid : (props.target.userId ?? null),
    target: {
      nickname: props.target.nickname,
      avatar: props.target.avatar ?? props.target.avatarUrl ?? null,
      avatarUrl: props.target.avatar ?? props.target.avatarUrl ?? null,
      emoji: props.target.emoji ?? props.target.avatarEmoji ?? null,
      avatarEmoji: props.target.emoji ?? props.target.avatarEmoji ?? null,
      color: props.target.color ?? '#4f6ef7',
      avatarColor: props.target.color ?? '#4f6ef7',
      userId: peerUid > 0 ? peerUid : (props.target.userId ?? null),
      isAI: Boolean(props.target.isAI),
      personaId: props.target.personaId ?? null,
      remark: props.target.remark || null,
    },
  });
}

function openCall(mode = 'video') {
  const uid = peerUid > 0 ? peerUid : Number(props.target.userId ?? 0);
  if (props.target.isAI) {
    showToast('暂不支持与 AI 语音/视频通话');
    return;
  }
  if (!uid) {
    showToast('无法确定对方账号，暂不能拨打');
    return;
  }
  emit('open-video-call', {
    callMode: mode,
    role: 'caller',
    target: {
      nickname: props.target.remark || props.target.nickname,
      avatar: props.target.avatar ?? props.target.avatarUrl ?? null,
      emoji: props.target.emoji ?? props.target.avatarEmoji ?? null,
      color: props.target.color ?? props.target.avatarColor ?? '#4f6ef7',
      userId: uid,
      isAI: false,
    },
  });
}

function openTargetProfile() {
  showMore.value = false;
  if (props.target?.isAI) {
    emit('open-profile', {
      id: props.target.personaId ?? props.target.userId,
      userId: null,
      nickname: props.target.nickname,
      avatar: props.target.avatar ?? props.target.avatarUrl ?? null,
      avatarUrl: props.target.avatar ?? props.target.avatarUrl ?? null,
      emoji: props.target.emoji ?? props.target.avatarEmoji ?? null,
      avatarEmoji: props.target.emoji ?? props.target.avatarEmoji ?? null,
      color: props.target.color ?? '#07c160',
      avatarColor: props.target.color ?? '#07c160',
      isAI: true,
      personaId: props.target.personaId ?? null,
      isFriend: false,
      local: true,
    });
    return;
  }
  emit('open-profile', {
    id: peerUid > 0 ? peerUid : (props.target.userId ?? props.target.personaId),
    userId: peerUid > 0 ? peerUid : (props.target.userId ?? null),
    nickname: props.target.nickname,
    avatar: props.target.avatar ?? props.target.avatarUrl ?? null,
    avatarUrl: props.target.avatar ?? props.target.avatarUrl ?? null,
    emoji: props.target.emoji ?? props.target.avatarEmoji ?? null,
    avatarEmoji: props.target.emoji ?? props.target.avatarEmoji ?? null,
    color: props.target.color ?? '#07c160',
    avatarColor: props.target.color ?? '#07c160',
    isAI: Boolean(props.target.isAI),
    personaId: props.target.personaId ?? null,
    isFriend: !props.target.isAI,
    local: Boolean(props.target.isAI),
  });
}

function openMyProfile() {
  emit('open-profile', {
    id: props.me?.id,
    userId: props.me?.id,
    nickname: props.me?.nickname,
    avatar: props.me?.avatar,
    color: props.me?.avatarColor,
    avatarColor: props.me?.avatarColor,
    isAI: false,
    isSelf: true,
  });
}

function toastMore(label) {
  showMore.value = false;
  if (label === '查找聊天记录') {
    showSearch.value = true;
    searchQuery.value = '';
    searchResults.value = [];
  }
}

async function doSearchHistory() {
  const q = searchQuery.value.trim();
  if (!q) {
    searchResults.value = [];
    return;
  }
  searching.value = true;
  try {
    const data = await api.searchChat(q, conversationId);
    searchResults.value = data.messages || [];
  } catch (e) {
    alert(e.message);
  } finally {
    searching.value = false;
  }
}

function pickChatPhoto() {
  photoInput.value?.click();
}

function showToast(msg) {
  toast(msg);
}

const payOverlay = ref({
  open: false,
  kind: 'redpacket',
  mode: 'claim',
  amount: null,
  note: '',
  status: '',
  isMine: false,
  senderName: '',
  senderAvatar: null,
  senderEmoji: '🧧',
  packetId: null,
  transferId: null,
  messageId: null,
  tip: '',
});
const createPay = ref({
  kind: 'redpacket',
  amount: 0,
  amountText: '',
  note: '',
  open: false,
  balance: null,
  rpType: 'exclusive',
  rpCount: 1,
  cover: 'classic',
});
const peerWxid = ref('');

function parseExt(m) {
  if (!m) return {};
  if (m.ext && typeof m.ext === 'object') return m.ext;
  if (typeof m.ext === 'string') {
    try { return JSON.parse(m.ext) || {}; } catch { /* ignore */ }
  }
  const c = String(m.content || '');
  const amt = /¥\s*([0-9]+(?:\.[0-9]{1,2})?)/.exec(c);
  return { amount: amt ? Number(amt[1]) : undefined, note: /红包/.test(c) ? '恭喜发财' : '' };
}

function isRedPacketMsg(m) {
  return m?.mediaType === 'redpacket' || /^\[微信红包\]/.test(String(m?.content || ''));
}
function isTransferMsg(m) {
  return m?.mediaType === 'transfer' || /^\[转账\]/.test(String(m?.content || ''));
}
function payKindOf(m) {
  if (isRedPacketMsg(m)) return 'redpacket';
  if (isTransferMsg(m)) return 'transfer';
  return null;
}

let payOpenAt = 0;
function openPayOverlay(m) {
  const kind = payKindOf(m);
  if (!kind) return;
  const now = Date.now();
  if (now - payOpenAt < 280) return;
  payOpenAt = now;
  const ext = parseExt(m);
  const mine = isMine(m);
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
    senderName: mine ? (props.me?.nickname || '我') : (m.senderName || props.target?.nickname || '好友'),
    senderAvatar: mine ? (props.me?.avatar || null) : (props.target?.avatarUrl || props.target?.avatar || null),
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
    if (row) row.ext = { ...parseExt(row), ...p };
  } catch { /* ignore */ }
}

function onPayConfirm() {
  const info = payOverlay.value;
  if (!info.open) return;
  if (!socket?.connected) {
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
        row.ext = { ...parseExt(row), ...p, status: p.status || 'claimed', amount: res.amount ?? p.amount };
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
      };
      return;
    }
    showToast(res?.error || '操作失败');
  });
}

function openCreatePay(kind) {
  if (!canPay.value) {
    showToast('无法确定对方账号，暂不能发起支付');
    return;
  }
  createPay.value = {
    kind,
    amount: 0,
    amountText: '',
    note: '',
    open: true,
    balance: createPay.value.balance ?? 0,
    rpType: 'exclusive',
    rpCount: kind === 'redpacket' && props.target.isAI ? 1 : 1,
    cover: 'classic',
  };
  api.wallet().then((w) => {
    createPay.value = { ...createPay.value, balance: w.balance };
  }).catch(() => {});
  if (!props.target.isAI && peerUid) {
    api.user(peerUid).then((d) => {
      peerWxid.value = d?.user?.wxid || '';
    }).catch(() => {});
  }
}

function submitCreatePay() {
  const info = createPay.value;
  const amount = Number(info.amountText || info.amount);
  if (!(amount > 0)) {
    showToast('请输入金额');
    return;
  }
  if (!canPay.value) {
    showToast('无法确定对方账号，暂不能发起支付');
    return;
  }
  if (!socket?.connected) {
    showToast('连接中, 请稍后再试');
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
  const conv = conversationId;
  socket.emit('private:send', {
    conversationId: conv,
    content: isRP ? `[微信红包]${rpType === 'lucky' ? '拼手气' : ''}${note}` : `[转账]¥${amount.toFixed(2)}`,
    mediaType: info.kind,
    ext,
  }, (res) => {
    if (res?.error) {
      showToast(res.error);
      return;
    }
    if (!res?.ok && !res?.id) {
      showToast('发送失败，请重试');
      return;
    }
    createPay.value = { ...info, open: false };
    dockMode.value = 0;
    showToast(isRP ? '红包已发出' : '转账已发出');
  });
}

function onMsgBubbleClick(m, e) {
  if (!payKindOf(m)) return;
  e?.stopPropagation?.();
  e?.preventDefault?.();
  openPayOverlay(m);
}

function onChatBodyClick(e) {
  const t = e.target;
  if (t?.closest?.('.wx-rp-card,.wx-tf-card,.wx-pay-root')) return;
  if (dockMode.value === 1 || dockMode.value === 2) dockMode.value = 0;
}

function lastMineId() {
  for (let i = messages.value.length - 1; i >= 0; i--) {
    const m = messages.value[i];
    if (isMine(m) && !m.recalled) return m.id;
  }
  return null;
}

function showReadTip(m) {
  const tip = showSendTip(m);
  return tip === '已读';
}

async function onChatPhoto(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = await compressImage(file);
    const { url, mediaType } = await api.uploadChatMedia(data, 'image');
    if (!url) throw new Error('上传失败');
    socket.emit('private:send', { conversationId, mediaType: mediaType || 'image', mediaUrl: url }, (res) => {
      if (res?.error) showToast(res.error);
    });
    dockMode.value = 0;
  } catch (err) {
    showToast(err.message || '发送图片失败');
  }
}

const recStartY = ref(0);
const recCancel = ref(false);

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
        alert('说话时间太短');
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
        if (!url) throw new Error('上传失败');
        socket.emit(
          'private:send',
          { conversationId, content: `[语音] ${recSeconds.value}"`, mediaType: mediaType || 'voice', mediaUrl: url },
          (res) => {
            if (res?.error) showToast(res.error);
            else playSendSound();
          }
        );
      } catch (err) {
        showToast(err.message || '发送语音失败');
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
    alert('无法访问麦克风');
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

onMounted(() => {
  ensureNotifyPermission().catch(() => {});
  if (props.pendingSearch) {
    showSearch.value = true;
    emit('search-used');
  }

  // 1) 先画本地缓存, 进页立刻有内容
  const cached = loadMsgCache(conversationId);
  if (cached.length) {
    messages.value = cached;
    seedSeen(cached);
    booting.value = false;
    nextTick(() => scrollToBottom(false));
  }

  // 2) 立刻拉历史, 不等待 socket
  loadHistory().finally(() => {
    booting.value = false;
  });
  api.getChatPref(conversationId).then((d) => {
    const s = d?.pref?.draft || '';
    if (s && !draft.value) draft.value = s;
    applyConvBgFromPref(d);
    let remind = false;
    try { remind = localStorage.getItem(`wx_remind_${conversationId}`) === '1'; } catch { /* ignore */ }
    chatPrefs.value = {
      muted: Boolean(d?.pref?.muted),
      pinned: Boolean(d?.pref?.pinned),
      folded: Boolean(d?.pref?.folded),
      remind,
    };
  }).catch(() => {});

  // 3) 共享 socket, 连接态后台同步
  socket = getSocket();
  connected.value = socket.connected;
  if (socket.connected) {
    everConnected.value = true;
    socket.emit('private:join', conversationId);
    api.privateRead(conversationId).then((d) => {
      if (typeof d?.peerReadId === 'number') peerReadId.value = d.peerReadId;
    }).catch(() => {});
  }

  const onConnect = () => {
    connected.value = true;
    everConnected.value = true;
    socket.emit('private:join', conversationId);
    api.privateRead(conversationId).then((d) => {
      if (typeof d?.peerReadId === 'number') peerReadId.value = d.peerReadId;
    }).catch(() => {});
    // 连上后再补一次最新
    if (!messages.value.length) loadHistory();
  };
  const onDisconnect = () => { connected.value = false; };
  const onPrivateMsg = (m) => {
    if (m.conversationId !== conversationId) return;
    const idx = messages.value.findIndex((x) => x.id === m.id);
    if (idx >= 0) {
      messages.value[idx] = m;
      persistMessages();
      return;
    }
    if (m.senderName === props.me?.nickname) {
      messages.value = dropLocalEcho(messages.value, m, props.me.nickname);
    }
    messages.value.push(m);
    persistMessages();
    peerTyping.value = false;
    if (isMine(m)) {
      api.privateRead(conversationId).catch(() => {});
    } else if (m.senderType && m.senderType !== 'system') {
      const body = m.mediaType === 'image' ? '[图片]'
        : m.mediaType === 'voice' ? '[语音]'
        : (m.content || '').slice(0, 40);
      notifyMessage({
        title: `${props.target?.nickname || '微信'} · ${m.senderName || ''}`,
        body,
        tag: `pv-${conversationId}`,
      });
      playMsgSound();
    }
    const el = listEl.value;
    const nearBottom = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) scrollToBottom();
  };
  const onTyping = (p) => {
    if (p?.conversationId !== conversationId) return;
    peerTyping.value = p.typing !== false;
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
  const onChatSync = (p) => {
    if (p?.type === 'draft' && p.conversationId === conversationId) {
      draft.value = p.draft || '';
    }
  };

  unbinders = [
    bindSocket('connect', onConnect),
    bindSocket('disconnect', onDisconnect),
    bindSocket('private:message', onPrivateMsg),
    bindSocket('private:typing', onTyping),
    bindSocket('call:incoming', onCallIncoming),
    bindSocket('chat:sync', onChatSync),
  ];

  if (!props.target?.isAI) {
    peerReadTimer = setInterval(() => {
      api.privatePeerRead(conversationId).then((d) => {
        if (typeof d?.peerReadId === 'number') peerReadId.value = d.peerReadId;
      }).catch(() => {});
    }, 4000);
  }
});

onBeforeUnmount(() => {
  persistMessages();
  unbinders.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
  unbinders = [];
  disposeVoice();
  clearTimeout(longPressTimer);
  clearTimeout(typingTimer);
  clearInterval(recTimer);
  clearInterval(peerReadTimer);
});
</script>

<template>
  <div class="chat-page" :style="convBg ? { '--chat-bg': convBg } : undefined">
    <header class="nav-bar">
      <button class="icon-btn nav-back" aria-label="返回" @click="emit('back')">
        <svg viewBox="0 0 24 24" width="24" height="24"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <div class="nav-title">
        <span class="title-text">{{ target.remark || target.nickname }}</span>
        <span v-if="peerTyping" class="typing-inline">正在输入…</span>
      </div>
      <button v-if="!target.isAI" class="icon-btn nav-call" aria-label="音视频通话" @click="openCall('video')">
        <svg viewBox="0 0 24 24" width="20" height="20"><path d="M6.5 4.5h3l1.5 4-2 1.5a12 12 0 0 0 5 5l1.5-2 4 1.5v3c0 .8-.7 1.5-1.5 1.5C10.5 19 5 13.5 5 6c0-.8.7-1.5 1.5-1.5z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>
      </button>
      <button class="icon-btn nav-more" aria-label="更多" @click="openMore">
        <svg viewBox="0 0 24 24" width="22" height="22"><circle cx="5" cy="12" r="1.7" fill="currentColor"/><circle cx="12" cy="12" r="1.7" fill="currentColor"/><circle cx="19" cy="12" r="1.7" fill="currentColor"/></svg>
      </button>
    </header>

    <div v-if="showConnHint" class="conn-bar">连接已断开，正在重连…</div>
    <div v-if="peerTyping" class="typing-bar">{{ target.nickname }} 正在输入…</div>

    <main class="chat-body scroll-y" ref="listEl" @scroll="onScroll" @click="onChatBodyClick">
      <div v-if="booting && !messages.length" class="history-tip">正在加载聊天记录…</div>
      <div v-else-if="!messages.length" class="history-tip">暂无消息，打个招呼吧</div>
      <div v-else-if="noMoreHistory && messages.length" class="history-tip">没有更多消息了</div>

      <template v-for="(m, i) in messages" :key="m.id">
        <div v-if="showTime(i)" class="time-divider">{{ fmtTime(m.createdAt) }}</div>
        <div v-if="m.senderType === 'system'" class="sys-msg"><span>{{ sysText(m) }}</span></div>
        <div
          v-else
          class="msg-row"
          :class="{ mine: isMine(m), cont: sameSenderAsPrev(i) }"
          @pointerdown="startLongPress(m, $event)"
          @pointerup="clearLongPress"
          @pointerleave="clearLongPress"
          @pointercancel="clearLongPress"
        >
          <UserAvatar
            v-if="!sameSenderAsPrev(i)"
            v-bind="isMine(m) ? myAvatarProps() : avatarProps()"
            style="cursor:pointer"
            @click.stop="isMine(m) ? openMyProfile() : openTargetProfile()"
          />
          <div v-else class="avatar-spacer"></div>
          <div class="msg-col" @click="onMsgBubbleClick(m, $event)">
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
              @click.stop="openPreview(m.mediaUrl)"
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
              @click.stop="playVoice(m)"
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
            <WxPayCard
              v-else-if="payKindOf(m)"
              class="bubble"
              :kind="payKindOf(m)"
              :amount="parseExt(m).amount ?? parseExt(m).totalAmount"
              :note="parseExt(m).note"
              :status="parseExt(m).status"
              :is-mine="isMine(m)"
              :content="m.content"
              :rp-type="parseExt(m).rpType || 'exclusive'"
              :claimed-count="parseExt(m).claimedCount"
              :total-count="parseExt(m).totalCount"
              :cover-emoji="parseExt(m).coverEmoji"
              :remaining="parseExt(m).remaining"
              :expired="parseExt(m).status === 'expired'"
              @open="openPayOverlay(m)"
            />
            <div
              v-else-if="m.mediaType === 'merge' || (m.ext && m.ext.mergeItems)"
              class="bubble merge-bubble"
            >
              <div class="merge-title">聊天记录</div>
              <div class="merge-preview">
                <div v-for="(it, mi) in parseMergeItems(m).slice(0, 4)" :key="mi" class="merge-line">
                  {{ it.name }}: {{ it.content }}
                </div>
              </div>
              <div class="merge-foot">{{ parseMergeItems(m).length }} 条聊天记录 ›</div>
            </div>
            <div v-else class="bubble">{{ m.content }}</div>
            <div
              v-if="isMine(m) && (m.sendStatus === 'sending' || m.sendStatus === 'failed')"
              class="msg-status"
              :class="m.sendStatus === 'failed' ? 'st-failed' : 'st-sending'"
              @click="m.sendStatus === 'failed' && onBubbleRetry(m)"
            >
              <span v-if="m.sendStatus === 'sending'" class="st-clock"></span>
              <span v-else class="st-bang">!</span>
            </div>
            <div v-else-if="showSendTip(m)" class="read-tip">{{ showSendTip(m) }}</div>
          </div>
        </div>
      </template>
    </main>

    <footer class="chat-dock">
      <div v-if="quoteMsg" class="quote-strip">
        <div class="quote-strip-main">
          <div class="quote-name">回复 {{ quoteMsg.senderName || target.nickname }}</div>
          <div class="quote-text">{{ quoteMsg.content || '[图片]' }}</div>
        </div>
        <button class="quote-close" @click="quoteMsg = null">×</button>
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
            @input="autoSizeInput(); onInputTyping(); api.chatPref({ conversationId, draft: draft.slice(0, 500) })"
            @focus="onInputFocus"
            @paste="onPasteChat"
          ></textarea>
          <button
            v-show="dockMode === 3"
            class="hold-talk"
            :class="{ cancel: recording && recCancel }"
            type="button"
            @pointerdown.prevent="startRecord"
            @pointermove="onRecordMove"
            @pointerup.prevent="stopRecord"
            @pointerleave="stopRecord"
          >
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
      </div>

      <div v-if="dockMode === 1" class="dock-panel emoji-panel">
        <div class="emoji-grid">
          <button v-for="(e, i) in emojiList" :key="i" class="emoji-item" @click="insertEmoji(e)">{{ e }}</button>
          <button v-for="e in favEmojis" :key="'fav-'+e" class="emoji-item fav" @click="insertEmoji(e)">{{ e }}</button>
        </div>
        <div class="emoji-footer">
          <button class="emoji-del" @click="deleteEmoji">删除</button>
        </div>
      </div>

      <div v-if="dockMode === 2" class="dock-panel plus-panel">
        <div class="plus-grid">
          <button class="plus-item" type="button" @click="pickChatPhoto"><span class="plus-icon">🖼</span><span>相册</span></button>
          <input ref="photoInput" type="file" accept="image/*" hidden @change="onChatPhoto" />
          <button class="plus-item" type="button" @click="pickChatPhoto"><span class="plus-icon">📷</span><span>拍摄</span></button>
          <button v-if="!target.isAI && peerUid" class="plus-item" type="button" @click="openCall('video')"><span class="plus-icon">📹</span><span>视频通话</span></button>
          <button v-if="!target.isAI && peerUid" class="plus-item" type="button" @click="openCall('voice')"><span class="plus-icon">📞</span><span>语音通话</span></button>
          <button class="plus-item" type="button" @click="openCreatePay('redpacket')"><span class="plus-icon">🧧</span><span>红包</span></button>
          <button class="plus-item" type="button" @click="openCreatePay('transfer')"><span class="plus-icon">💰</span><span>转账</span></button>
          <button class="plus-item" type="button" @click="showToast('位置消息演示中')"><span class="plus-icon">📍</span><span>位置</span></button>
        </div>
      </div>
    </footer>

    <div v-if="actionMsg" class="action-sheet" @click.self="actionMsg = null">
      <div class="action-menu">
        <button class="action-item" @click="doAction('copy')">复制</button>
        <button class="action-item" @click="doAction('forward')">转发</button>
        <button class="action-item" @click="doAction('favorite')">收藏</button>
        <button class="action-item" @click="doAction('quote')">引用</button>
        <button class="action-item" @click="doAction('recall')">撤回</button>
        <button class="action-item danger" @click="doAction('delete')">删除</button>
      </div>
    </div>

    <div v-if="previewSrc" class="img-preview" @click="previewSrc = null">
      <button class="preview-close" @click.stop="previewSrc = null">✕</button>
      <img :src="previewSrc" alt="预览" @click.stop />
    </div>
    <ImagePreview
      v-if="showImagePreview && previewImages.length"
      :images="previewImages"
      :index="previewIndex"
      @close="showImagePreview = false"
      @change="(i) => (previewIndex = i)"
      @forward="onPreviewForward"
    />

    <ForwardSheet
      v-if="showForward"
      :me="me"
      :ids="forwardIds"
      @close="showForward = false; forwardIds = []"
      @done="onForwardDone"
    />

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
          @click="showSearch = false"
        >
          <div class="hist-name">{{ m.senderName }}</div>
          <div class="hist-text">{{ m.content }}</div>
          <div class="hist-time">{{ fmtTime(m.createdAt) }}</div>
        </button>
      </div>
    </div>

    <div v-if="showMore" class="mask" @click="showMore = false"></div>
    <div v-if="showMore" class="pop-menu">
      <button class="pop-item" @click="openTargetProfile">{{ target.isAI ? '查看资料' : '聊天信息' }}</button>
      <button class="pop-item" @click="toastMore('查找聊天记录')">查找聊天记录</button>
      <button class="pop-item" @click="toastMore('消息免打扰')">消息免打扰</button>
      <button class="pop-item" @click="toastMore('清空聊天记录')">清空聊天记录</button>
    </div>
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
      @confirm="onPayConfirm"
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
      :is-group="false"
      :sender-name="target.nickname"
      :sender-avatar="target.avatarUrl || target.avatar"
      :peer-wxid="peerWxid"
      :balance="createPay.balance"
      @close="createPay = { ...createPay, open: false }"
      @update:create-amount-text="(v) => (createPay.amountText = v)"
      @update:create-note="(v) => (createPay.note = v)"
      @update:rp-type="(v) => (createPay.rpType = v)"
      @update:rp-count="(v) => (createPay.rpCount = v)"
      @update:cover="(v) => (createPay.cover = v)"
      @submit="submitCreatePay"
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
  height: var(--nav-h); flex-shrink: 0; display: flex; align-items: center;
  justify-content: center; position: relative; background: var(--bg);
  border-bottom: 0.5px solid var(--divider); padding: 0 8px;
}
.nav-back { position: absolute; left: 0; top: 0; bottom: 0; margin: auto 0; }
.nav-more { position: absolute; right: 0; top: 0; bottom: 0; margin: auto 0; }
.nav-call { position: absolute; right: 44px; top: 0; bottom: 0; margin: auto 0; }
.nav-right-space { width: 44px; }
.nav-title { max-width: 45%; display: flex; flex-direction: column; align-items: center; }
.title-text {
  font-size: 17px; font-weight: 600;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.typing-inline {
  font-size: 11px;
  font-weight: 400;
  color: var(--green);
  margin-top: 1px;
}

.chat-body { flex: 1; min-height: 0; padding: 10px 12px 8px; background: var(--chat-bg, var(--bg)); }
.history-tip { text-align: center; color: var(--text-3); font-size: 12px; padding: 8px 0 12px; }
.time-divider { text-align: center; color: var(--text-3); font-size: 12px; margin: 12px 0 10px; }
.sys-msg { display: flex; justify-content: center; margin: 8px 0; }
.sys-msg span {
  max-width: 80%; padding: 4px 10px; border-radius: 3px;
  background: #d9d9d9; color: #666; font-size: 12px; text-align: center;
}

.msg-row {
  display: flex;
  gap: 10px;
  margin-bottom: var(--wx-msg-gap, 12px);
  align-items: flex-start;
}
.msg-row.cont {
  margin-top: calc(var(--wx-msg-gap, 12px) * -1 + var(--wx-msg-gap-cont, 3px));
  margin-bottom: var(--wx-msg-gap-cont, 3px);
}
.msg-row.mine { flex-direction: row-reverse; }
.avatar-spacer { width: var(--wx-avatar-chat, 40px); flex-shrink: 0; }
.msg-col { max-width: 68%; min-width: 0; display: flex; flex-direction: column; }
.msg-row.mine .msg-col { align-items: flex-end; }

.bubble {
  position: relative;
  padding: var(--wx-bubble-py, 9px) var(--wx-bubble-px, 12px);
  border-radius: var(--wx-bubble-r, 6px);
  background: var(--white);
  font-size: var(--wx-bubble-fs, 17px);
  line-height: var(--wx-bubble-lh, 1.45);
  word-break: break-word; white-space: pre-wrap;
  animation: fade-up 140ms var(--ease);
  color: var(--text);
}
.bubble:active { background: #ececec; }
.msg-row.mine .bubble { background: var(--green-bubble); }
.msg-row.mine .bubble:active { background: #86d95c; }
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
.img-bubble {
  padding: 0; background: transparent; width: 140px; height: 140px;
  object-fit: cover; border-radius: var(--wx-bubble-r-media, 4px); cursor: pointer;
}
.media-video {
  width: 220px; max-height: 280px;
  border-radius: var(--wx-bubble-r-media, 4px);
  background: #000;
}

.chat-dock {
  flex-shrink: 0; background: var(--bg);
  border-top: 0.5px solid var(--divider); padding-bottom: var(--safe-b);
}
.dock-panel { background: var(--bg); border-top: 0.5px solid var(--divider); }
.emoji-footer { background: var(--divider-soft); }
.hist-search { background: var(--bg); }
.hist-item:active { background: var(--press); }
.input-bar { display: flex; align-items: flex-end; gap: 2px; padding: 7px 6px; min-height: 54px; }
.input-wrap {
  flex: 1; min-width: 0; background: var(--white); border-radius: 4px;
  padding: 8px 10px; min-height: 36px; display: flex; align-items: center;
}
.chat-input {
  width: 100%; resize: none; font-size: 16px; line-height: 1.4;
  max-height: 96px; overflow-y: auto;
}
.hold-talk {
  width: 100%; height: 28px; border-radius: 4px; background: var(--white);
  border: 0.5px solid #d0d0d0; font-size: 15px; font-weight: 500;
}
.hold-talk.cancel { background: #fde2e2; color: var(--red); border-color: #f5c2c2; }
.send-btn {
  min-width: 52px; height: 36px; margin: 0 4px 0 2px; border-radius: 4px;
  background: var(--green); color: #fff; font-size: 15px;
}
.send-btn:active { background: var(--green-press); }

.dock-panel {
  height: 260px; background: #f7f7f7; border-top: 0.5px solid var(--divider);
  animation: panelUp var(--dur) var(--ease);
}
.emoji-panel { display: flex; flex-direction: column; }
.emoji-grid {
  flex: 1; overflow-y: auto; display: grid;
  grid-template-columns: repeat(8, 1fr); gap: 2px; padding: 10px 8px; align-content: start;
}
.emoji-item {
  height: 40px; font-size: 24px; display: flex; align-items: center; justify-content: center;
}
.emoji-item:active { background: #e0e0e0; }
.emoji-item.fav { background: rgba(7,193,96,0.08); border-radius: 8px; }
.merge-bubble { min-width: 200px; max-width: 260px; background: var(--white) !important; cursor: pointer; }
.merge-title { font-size: 14px; font-weight: 600; color: var(--text); margin-bottom: 6px; }
.merge-preview { font-size: 12px; color: var(--text-2); line-height: 1.45; }
.merge-line { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.merge-foot { margin-top: 8px; padding-top: 6px; border-top: 0.5px solid var(--divider-soft); font-size: 12px; color: var(--text-3); }
.emoji-footer {
  height: 40px; display: flex; justify-content: flex-end; align-items: center;
  padding: 0 10px; background: #f0f0f0;
}
.emoji-del {
  min-width: 56px; height: 30px; font-size: 14px; color: var(--text-2);
  border: 0.5px solid #ccc; border-radius: 4px; background: var(--white);
}
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

.action-sheet { position: absolute; inset: 0; z-index: 46; background: var(--mask); }
.action-menu {
  position: absolute; left: 50%; top: 30%; transform: translateX(-50%);
  width: min(240px, calc(100% - 40px)); background: #4c4c4c; border-radius: 6px;
  overflow: hidden; animation: popIn 160ms var(--ease);
}
.action-item {
  width: 100%; height: 44px; padding: 0 14px; color: #fff; font-size: 15px;
  text-align: left; display: flex; align-items: center;
}
.action-item:active { background: rgba(255,255,255,0.12); }
.action-item + .action-item { border-top: 0.5px solid rgba(255,255,255,0.12); }
.action-item.danger { color: #ff6b6b; }

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
.read-tip {
  margin-top: 3px;
  font-size: 11px;
  color: var(--text-3);
  text-align: right;
}
.msg-status {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 3px;
  font-size: 11px;
  color: var(--text-3);
  justify-content: flex-end;
}
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
.file-bubble {
  display: flex; gap: 10px; align-items: center;
  min-width: 200px; max-width: 260px; background: var(--white) !important;
  padding: 12px 14px; border-radius: 8px; cursor: pointer;
}
.file-icon { font-size: 28px; }
.file-name { font-size: 14px; color: var(--text); word-break: break-all; }
.file-sub { font-size: 11px; color: var(--text-3); margin-top: 4px; }
.voice-bubble { position: relative; overflow: hidden; }
.voice-progress {
  position: absolute; left: 0; bottom: 0; height: 2px;
  background: rgba(7, 193, 96, 0.75);
}

.img-preview {
  position: absolute; inset: 0; background: #000; z-index: 50;
  display: flex; align-items: center; justify-content: center;
}
.img-preview img { max-width: 100%; max-height: 100%; object-fit: contain; }
.preview-close {
  position: absolute; top: 12px; right: 12px; width: 44px; height: 44px;
  color: #fff; font-size: 22px; z-index: 2;
}

.hist-search {
  position: absolute;
  inset: 0;
  background: var(--bg);
  z-index: 48;
  display: flex;
  flex-direction: column;
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

.mask {
  position: absolute; inset: 0; background: var(--mask); z-index: 40;
  animation: fadeIn 160ms var(--ease);
}
.pop-menu {
  position: absolute; top: calc(var(--nav-h) - 4px); right: 10px;
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
.voice-bubble {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 72px;
  max-width: 70%;
  cursor: pointer;
  user-select: none;
}
.voice-bubble.playing { animation: voice-pulse 1s ease infinite; }
@keyframes voice-pulse {
  0%, 100% { filter: brightness(1); }
  50% { filter: brightness(0.9); }
}
.voice-wave {
  display: inline-flex;
  align-items: flex-end;
  gap: 1.5px;
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}
.voice-wave i {
  display: block;
  width: 2px;
  border-radius: 1px;
  background: #576b95;
}
.msg-row.mine .voice-wave i { background: #3d7a28; }
.voice-wave i:nth-child(1) { height: 5px; }
.voice-wave i:nth-child(2) { height: 9px; }
.voice-wave i:nth-child(3) { height: 13px; }
.voice-bubble.playing .voice-wave i { animation: wave 0.8s ease infinite; }
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
.msg-row.mine .voice-dur { color: rgba(0, 0, 0, 0.45); }
.conn-bar {
  text-align: center;
  font-size: 12px;
  color: #fff;
  background: #e6a23c;
  padding: 4px 8px;
}
.pay-bubble {
  cursor: pointer !important;
  touch-action: manipulation !important;
  pointer-events: auto !important;
  min-width: 200px;
  display: inline-flex !important;
  align-items: center;
  gap: 10px;
  user-select: none;
}
.rp-bubble {
  background: #fa9d3b !important;
  color: #fff !important;
  width: 230px;
  border-radius: 6px;
  padding: 12px;
}
.tf-bubble {
  background: var(--white);
  width: 230px;
  border-radius: 6px;
  padding: 12px;
  box-shadow: 0 1px 2px rgba(0,0,0,0.04);
}
.tf-yen {
  width: 34px;
  height: 34px;
  border-radius: 17px;
  background: #f5a623;
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 17px;
  flex-shrink: 0;
}
.pay-mask {
  position: fixed;
  inset: 0;
  z-index: 3200;
  background: rgba(0,0,0,0.45);
  display: flex;
  align-items: center;
  justify-content: center;
}
.pay-card {
  width: 280px;
  background: var(--white);
  border-radius: 12px;
  padding: 20px 16px 16px;
  text-align: center;
}
.pay-icon { font-size: 40px; }
.pay-title2 { margin-top: 8px; font-size: 16px; font-weight: 600; color: var(--text); }
.pay-amt { margin-top: 8px; font-size: 26px; color: #e6433d; font-weight: 700; }
.pay-tip { margin-top: 10px; font-size: 13px; color: var(--text-2); }
.pay-ok {
  margin-top: 14px;
  width: 100%;
  min-height: 42px;
  border: 0;
  border-radius: 8px;
  background: var(--green);
  color: #fff;
  font-size: 15px;
}
.pay-no {
  margin-top: 8px;
  width: 100%;
  min-height: 36px;
  border: 0;
  border-radius: 8px;
  background: var(--divider-soft);
  color: var(--text-2);
  font-size: 14px;
}
.pay-field {
  display: block;
  margin-top: 10px;
  text-align: left;
  font-size: 13px;
  color: var(--text-2);
}
.pay-field input {
  margin-top: 4px;
  width: 100%;
  box-sizing: border-box;
  min-height: 38px;
  border: 1px solid var(--divider);
  border-radius: 8px;
  padding: 0 10px;
  font-size: 15px;
  color: var(--text);
  background: var(--white);
}
</style>
