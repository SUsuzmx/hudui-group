<script setup>
import { ref, onMounted, onBeforeUnmount, computed, watch } from 'vue';
import { io } from 'socket.io-client';
import { getToken, api, compressImage } from '../api.js';
import UserAvatar from './UserAvatar.vue';
import ImagePreview from './ImagePreview.vue';
import ImageCropper from './ImageCropper.vue';
import UploadProgress from './UploadProgress.vue';
import { toast } from '../toast.js';

const props = defineProps({
  me: { type: Object, required: true },
  mode: { type: String, default: 'feed' },
  user: { type: Object, default: null },
});
const emit = defineEmits(['back', 'updated', 'open-user-moments']);

const moments = ref([]);
const loading = ref(false);
const noMore = ref(false);
const showComposer = ref(false);
const draft = ref('');
const publishing = ref(false);
const longPressTimer = ref(null);
const menuMoment = ref(null);
const pickedImages = ref([]);
const commentTarget = ref(null);
const commentText = ref('');
const fileInput = ref(null);
const previewImages = ref([]);
const previewIndex = ref(0);
const showPreview = ref(false);
const likesMoment = ref(null);
const cropSrc = ref('');
const cropKind = ref('cover'); // cover | post
const cropQueue = ref([]);
const uploading = ref(false);
const uploadPct = ref(0);
const uploadLabel = ref('上传中');
const expandedMap = ref({});
const replyTo = ref(null); // { id, name }
const visibility = ref('public');
const visibleTo = ref([]);
const friendOptions = ref([]);
const showVisPicker = ref(false);
const friendList = ref([]);
const targetUser = ref(props.user || null);
let liveSocket = null;
let liveTimer = null;

const isUserMode = computed(() => props.mode === 'user' && Boolean(props.user?.userId ?? props.user?.id));
const isMineMode = computed(() => props.mode === 'mine' || (!isUserMode.value && props.mode !== 'feed'));
const isFeedMode = computed(() => !isUserMode.value && props.mode !== 'mine');

async function refreshFeed() {
  loading.value = true;
  try {
    let data;
    if (isUserMode.value) {
      const uid = Number(props.user?.userId ?? props.user?.id);
      data = await api.userMoments(uid);
      if (data?.user) {
        targetUser.value = { ...targetUser.value, ...data.user };
        if (data.user.momentsCover) coverUrl.value = data.user.momentsCover;
      }
    } else if (props.mode === 'mine') {
      data = await api.myMoments();
    } else {
      data = await api.moments();
    }
    moments.value = data.moments || [];
    noMore.value = isUserMode.value || props.mode === 'mine' || (data.moments || []).length < 10;
  } catch (e) {
    console.warn(e);
  } finally {
    loading.value = false;
  }
}

function scheduleLiveRefresh() {
  clearTimeout(liveTimer);
  liveTimer = setTimeout(() => {
    refreshFeed();
  }, 400);
}

const profileSignature = ref('');
const title = computed(() => {
  if (isUserMode.value) {
    return `${targetUser.value?.nickname || props.user?.nickname || ''}的朋友圈`;
  }
  return props.mode === 'mine' ? '我的朋友圈' : '朋友圈';
});
const coverUser = computed(() => {
  if (isUserMode.value) {
    return {
      nickname: targetUser.value?.nickname || props.user?.nickname || '',
      avatar: targetUser.value?.avatar ?? props.user?.avatar ?? null,
      avatarColor: targetUser.value?.avatarColor ?? props.user?.avatarColor ?? null,
      signature: targetUser.value?.signature ?? props.user?.signature ?? profileSignature.value ?? '',
    };
  }
  return props.me || {};
});
const coverUrl = ref('');
const coverInput = ref(null);

watch(
  () => props.me?.momentsCover,
  (v) => {
    if (v && !isUserMode.value) coverUrl.value = v;
  }
);

async function replaceCover(file) {
  if (!file) return;
  if (!file.type?.startsWith('image/')) {
    alert('请选择图片文件');
    return;
  }
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(file);
  }).catch((e) => { alert(e.message || '读取图片失败'); return null; });
  if (!dataUrl) return;
  cropKind.value = 'cover';
  cropSrc.value = dataUrl;
}

function onCoverPick(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  replaceCover(file);
}

async function uploadImageWithProgress(dataUrl, label) {
  uploading.value = true;
  uploadPct.value = 0;
  uploadLabel.value = label || '上传中';
  try {
    const { url } = await api.uploadMomentImageWithProgress(dataUrl, (p) => { uploadPct.value = p; });
    return url;
  } finally {
    uploading.value = false;
    uploadPct.value = 0;
  }
}

async function onCropConfirm(dataUrl) {
  const kind = cropKind.value;
  cropSrc.value = '';
  try {
    if (kind === 'cover') {
      const url = await uploadImageWithProgress(dataUrl, '上传封面');
      if (!url) throw new Error('上传失败');
      coverUrl.value = url;
      const { user } = await api.updateMe({ momentsCover: url });
      if (user?.momentsCover) coverUrl.value = user.momentsCover;
      emit('updated', user);
      toast('朋友圈封面已更换');
    } else {
      if (pickedImages.value.length >= 9) {
        alert('最多 9 张图片');
        return;
      }
      const url = await uploadImageWithProgress(dataUrl, '上传配图');
      if (!url) throw new Error('上传失败');
      pickedImages.value = [...pickedImages.value, url];
      // 队列：继续裁剪下一张
      if (cropQueue.value.length) {
        const next = cropQueue.value.shift();
        cropKind.value = 'post';
        cropSrc.value = next;
      }
    }
  } catch (e) {
    alert(e.message || '上传失败');
  }
}

function onCropCancel() {
  cropSrc.value = '';
  cropQueue.value = [];
}

function openMomentPreview(m, idx) {
  const imgs = (m.images || []).filter(Boolean);
  if (!imgs.length) return;
  previewImages.value = imgs;
  previewIndex.value = Math.max(0, Math.min(idx || 0, imgs.length - 1));
  showPreview.value = true;
}

function openLikes(m) {
  likesMoment.value = m;
}

function friendMomentEmptyText() {
  if (!props.user && !isUserMode.value) return '还没有动态, 发一条吧';
  return '对方设置了朋友圈权限，或你们暂无可见动态';
}

function likedByMe(m) {
  return Boolean(m.likedByMe ?? (m.likes || []).some((l) => l.userId === props.me?.id));
}

function likePreview(m) {
  const names = (m.likes || []).map((l) => (l.userId === props.me?.id ? '我' : l.nickname));
  if (!names.length) return '';
  if (names.length > 3) return `${names.slice(0, 3).join('、')}等${names.length}人觉得很赞`;
  return `${names.join('、')}觉得很赞`;
}

function applyInteractions(m, data) {
  if (!m || !data) return;
  if (data.likes) m.likes = data.likes;
  if (data.comments) m.comments = data.comments;
  if (typeof data.likeCount === 'number') m.likeCount = data.likeCount;
  if (typeof data.commentCount === 'number') m.commentCount = data.commentCount;
  if (typeof data.likedByMe === 'boolean') m.likedByMe = data.likedByMe;
}

async function toggleLike(m) {
  try {
    if (likedByMe(m)) {
      const data = await api.unlikeMoment(m.id);
      applyInteractions(m, data);
    } else {
      const data = await api.likeMoment(m.id);
      applyInteractions(m, data);
    }
  } catch (e) {
    alert(e.message);
  }
}

function openComment(m, c = null) {
  commentTarget.value = m;
  commentText.value = c ? `回复${c.nickname}：` : '';
  replyTo.value = c ? { id: c.id, name: c.nickname } : null;
}

async function submitComment() {
  const content = commentText.value.trim();
  const m = commentTarget.value;
  if (!content || !m) return;
  try {
    const data = await api.commentMoment(m.id, content, replyTo.value?.id);
    applyInteractions(m, data);
    commentText.value = '';
    commentTarget.value = null;
    replyTo.value = null;
  } catch (e) {
    alert(e.message);
  }
}

async function deleteComment(m, c) {
  if (!confirm('删除这条评论？')) return;
  try {
    const data = await api.deleteMomentComment(c.id);
    applyInteractions(m, data);
  } catch (e) {
    alert(e.message);
  }
}

function canDeleteComment(m, c) {
  return c.userId === props.me?.id || m.userId === props.me?.id;
}

function pickImages() {
  fileInput.value?.click();
}

async function onPickFiles(e) {
  const files = [...(e.target.files || [])].slice(0, 9 - pickedImages.value.length);
  e.target.value = '';
  if (!files.length) return;
  const dataUrls = [];
  for (const file of files) {
    if (dataUrls.length >= 9) break;
    if (!file.type?.startsWith('image/')) continue;
    const data = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });
    if (data) dataUrls.push(data);
  }
  if (!dataUrls.length) return;
  // 逐张裁剪后上传
  cropQueue.value = dataUrls.slice(1);
  cropKind.value = 'post';
  cropSrc.value = dataUrls[0];
}

function removePicked(i) {
  pickedImages.value = pickedImages.value.filter((_, idx) => idx !== i);
}

function fmtTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return `今天 ${hm}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `昨天 ${hm}`;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

async function load(reset = false) {
  if (loading.value) return;
  loading.value = true;
  try {
    if (isUserMode.value) {
      const uid = Number(props.user?.userId ?? props.user?.id);
      const data = await api.userMoments(uid);
      moments.value = data.moments || [];
      noMore.value = true;
      if (data.user) {
        targetUser.value = { ...targetUser.value, ...data.user };
        profileSignature.value = data.user.signature || '';
        if (data.user.momentsCover) coverUrl.value = data.user.momentsCover;
      } else {
        try {
          const up = await api.user(uid);
          profileSignature.value = up?.user?.signature || '';
          targetUser.value = { ...targetUser.value, ...(up?.user || {}) };
        } catch { /* ignore */ }
      }
    } else if (props.mode === 'mine') {
      const data = await api.myMoments();
      moments.value = data.moments;
      noMore.value = true;
    } else {
      const beforeId = !reset && moments.value.length
        ? moments.value[moments.value.length - 1].id
        : undefined;
      const data = await api.moments(beforeId);
      if (reset) moments.value = data.moments;
      else moments.value = [...moments.value, ...data.moments];
      if (data.moments.length < 20) noMore.value = true;
    }
  } catch (e) {
    console.error(e);
  } finally {
    loading.value = false;
  }
}

function onScroll(e) {
  const el = e.target;
  if (el.scrollTop + el.clientHeight > el.scrollHeight - 80 && !noMore.value && !loading.value) {
    load(false);
  }
}

async function publish() {
  const content = draft.value.trim();
  if ((!content && !pickedImages.value.length) || publishing.value) return;
  if (visibility.value === 'partial' && !visibleTo.value.length) {
    alert('请选择部分可见的好友');
    showVisPicker.value = true;
    return;
  }
  publishing.value = true;
  try {
    const { moment } = await api.createMoment(
      content,
      pickedImages.value,
      visibility.value,
      visibility.value === 'partial' ? visibleTo.value : [],
    );
    moments.value = [moment, ...moments.value];
    draft.value = '';
    pickedImages.value = [];
    visibility.value = 'public';
    visibleTo.value = [];
    showComposer.value = false;
  } catch (e) {
    alert(e.message);
  } finally {
    publishing.value = false;
  }
}

async function loadFriendsForPicker() {
  if (friendOptions.value.length) return;
  try {
    const data = await api.friends();
    friendOptions.value = (data.friends || []).map((f) => ({
      id: f.id,
      nickname: f.remark || f.nickname,
      avatar: f.avatar,
      color: f.avatarColor,
    }));
  } catch {
    friendOptions.value = [];
  }
}

function toggleVisFriend(id) {
  const set = new Set(visibleTo.value);
  if (set.has(id)) set.delete(id);
  else set.add(id);
  visibleTo.value = [...set];
}

function onVisibilityChange() {
  if (visibility.value === 'partial') {
    loadFriendsForPicker();
    showVisPicker.value = true;
  } else {
    showVisPicker.value = false;
    if (visibility.value !== 'partial') visibleTo.value = [];
  }
}

function visLabel(m) {
  const v = m.visibility || 'public';
  if (v === 'private') return '私密';
  if (v === 'friends') return '好友可见';
  if (v === 'partial') return `部分可见${m.visibleTo?.length ? `(${m.visibleTo.length})` : ''}`;
  return '';
}

function openAuthorMoments(m) {
  const a = m?.author || {};
  const uid = Number(a.userId ?? a.id ?? m.userId);
  if (!uid) return;
  if (uid === Number(props.me?.id)) {
    emit('open-user-moments', { id: uid, userId: uid, nickname: props.me?.nickname, avatar: props.me?.avatar, avatarColor: props.me?.avatarColor });
    return;
  }
  emit('open-user-moments', {
    id: uid,
    userId: uid,
    nickname: a.nickname || '',
    avatar: a.avatar ?? null,
    avatarColor: a.avatarColor ?? null,
    isAI: Boolean(a.isAI),
  });
}

function dayOf(ts) {
  return new Date(ts).getDate();
}
function monthOf(ts) {
  return new Date(ts).getMonth() + 1;
}
function yearOf(ts) {
  return new Date(ts).getFullYear();
}

const albumYears = computed(() => {
  const map = new Map();
  for (const m of moments.value) {
    const y = yearOf(m.createdAt || Date.now());
    if (!map.has(y)) map.set(y, []);
    map.get(y).push(m);
  }
  return [...map.entries()].map(([year, list]) => ({ year, list }));
});

const albumDots = computed(() => Math.min(3, Math.max(1, albumYears.value.length || 1)));

function albumCover() {
  return coverUrl.value
    || props.user?.avatar
    || targetUser.value?.avatar
    || moments.value[0]?.images?.[0]
    || '';
}

function albumSignature() {
  return coverUser.value?.signature
    || props.user?.signature
    || targetUser.value?.signature
    || profileSignature.value
    || '';
}

const VIS_OPTIONS = [
  { value: 'public', label: '公开', sub: '所有朋友可见' },
  { value: 'private', label: '私密', sub: '仅自己可见' },
  { value: 'friends', label: '好友可见', sub: '仅好友可见' },
  { value: 'partial', label: '部分可见', sub: '选中的朋友可见' },
];

function pickVisibility(v) {
  visibility.value = v;
  if (v === 'partial') {
    loadFriendsForPicker();
    showVisPicker.value = true;
  } else {
    showVisPicker.value = false;
    if (v !== 'partial') visibleTo.value = [];
  }
}

/** 评论里 @ 好友 */
const showAtPicker = ref(false);

function insertAt(name) {
  if (!name) return;
  const at = `@${name} `;
  if (!commentText.value.includes(at)) {
    commentText.value = (commentText.value || '') + at;
  }
  showAtPicker.value = false;
}

async function openCommentAt() {
  if (!friendOptions.value.length) await loadFriendsForPicker();
  showAtPicker.value = true;
}

function openMenu(m) {
  menuMoment.value = m;
}

async function deleteMoment() {
  if (!menuMoment.value) return;
  try {
    await api.deleteMoment(menuMoment.value.id);
    moments.value = moments.value.filter((x) => x.id !== menuMoment.value.id);
  } catch (e) {
    alert(e.message);
  } finally {
    menuMoment.value = null;
  }
}

function startLongPress(m) {
  clearLongPress();
  longPressTimer.value = setTimeout(() => openMenu(m), 550);
}
function clearLongPress() {
  if (longPressTimer.value) {
    clearTimeout(longPressTimer.value);
    longPressTimer.value = null;
  }
}

onMounted(() => {
  if (props.me?.momentsCover && !isUserMode.value) coverUrl.value = props.me.momentsCover;
  if (props.user) targetUser.value = props.user;
  load(true);
  liveSocket = io('/', { auth: { token: getToken() }, transports: ['polling', 'websocket'] });
  liveSocket.on('moments:update', (p) => {
    if (!p) return;
    // 他人动态互动或新发布时刷新; 自己操作也刷新以同步 AI 互动
    scheduleLiveRefresh();
  });
});

onBeforeUnmount(() => {
  clearTimeout(liveTimer);
  liveSocket?.disconnect();
});
</script>

<template>
  <div class="page">
    <!-- 他人朋友圈：相册时间线 UI -->
    <template v-if="isUserMode">
      <div class="album-page">
        <div
          class="album-cover"
          :style="albumCover() ? {
            backgroundImage: `url(${albumCover()})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          } : undefined"
        >
          <button class="album-back" type="button" aria-label="返回" @click="emit('back')">‹</button>
          <div class="album-cover-user">
            <div class="album-cover-name">{{ coverUser?.nickname || props.user?.nickname || '' }}</div>
            <UserAvatar
              class="album-cover-avatar"
              :name="coverUser?.nickname || props.user?.nickname"
              :avatar="coverUser?.avatar ?? props.user?.avatar"
              :color="coverUser?.avatarColor ?? props.user?.avatarColor"
              :size="80"
            />
          </div>
        </div>

        <div v-if="albumSignature()" class="album-signature">{{ albumSignature() }}</div>

        <div v-if="loading && !moments.length" class="album-empty">加载中…</div>
        <div v-else-if="!moments.length" class="album-empty">
          <div class="empty-title">朋友仅展示最近三天的朋友圈</div>
          <div class="empty-sub">或对方设置了权限，暂无可见内容</div>
        </div>

        <div v-else class="album-body">
          <section v-for="g in albumYears" :key="g.year" class="album-year-block">
            <div v-if="albumYears.length > 1 || g.year !== yearOf(Date.now())" class="album-year">{{ g.year }}年</div>
            <button
              v-for="m in g.list"
              :key="m.id"
              class="album-item"
              type="button"
            >
              <div class="album-date">
                <span class="album-day">{{ dayOf(m.createdAt) }}</span>
                <span class="album-month">{{ monthOf(m.createdAt) }}月</span>
              </div>
              <div class="album-main">
                <div v-if="m.images?.length" class="album-images" :class="'n' + Math.min(9, m.images.length)">
                  <img
                    v-for="(img, i) in m.images.slice(0, 9)"
                    :key="i"
                    :src="img"
                    alt=""
                    loading="lazy"
                    @click.stop="openMomentPreview(m, i)"
                  />
                </div>
                <div v-if="m.content" class="album-text">{{ m.content }}</div>
              </div>
            </button>
          </section>
          <div class="album-dots">
            <span v-for="i in albumDots" :key="i" class="dot" :class="{ on: i === 1 }"></span>
          </div>
        </div>
      </div>
    </template>

    <template v-else>
      <header class="nav">
        <button class="nav-back" @click="emit('back')">‹</button>
        <div class="nav-title">{{ title }}</div>
        <button v-if="isFeedMode" class="nav-cam" type="button" :disabled="loading" @click="refreshFeed">↻</button>
        <button v-if="isFeedMode" class="nav-cam" @click="showComposer = true">📷</button>
        <div v-else class="nav-right"></div>
      </header>

      <main class="content" @scroll="onScroll">
        <div
          class="moments-cover"
          :style="coverUrl ? {
            backgroundImage: `url(${coverUrl})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          } : undefined"
        >
          <div class="cover-mask"></div>
          <div class="cover-user">
            <div class="cover-name">{{ coverUser?.nickname || '我' }}</div>
            <UserAvatar
              class="cover-avatar"
              :name="coverUser?.nickname"
              :avatar="coverUser?.avatar"
              :color="coverUser?.avatarColor"
              :size="64"
            />
          </div>
          <button v-if="!isUserMode" class="cover-cam" type="button" aria-label="更换封面" @click="coverInput?.click()">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#fff" stroke-width="1.6"><path d="M4 8h3l1.5-2h7L17 8h3v11H4V8z"/><circle cx="12" cy="13" r="3.2"/></svg>
          </button>
          <input ref="coverInput" type="file" accept="image/*" class="cover-file-input" tabindex="-1" @change="onCoverPick" />
        </div>

        <div v-if="moments.length === 0 && !loading" class="empty">{{ isUserMode ? '对方还没有可见的动态' : '还没有动态, 发一条吧' }}</div>

      <article
        v-for="m in moments"
        :key="m.id"
        class="moment"
        @touchstart="startLongPress(m)"
        @touchend="clearLongPress"
        @touchmove="clearLongPress"
        @contextmenu.prevent="openMenu(m)"
      >
        <UserAvatar
          class="moment-avatar"
          :name="m.author.nickname"
          :avatar="m.author.avatar"
          :color="m.author.avatarColor"
          :size="42"
          @click.stop="openAuthorMoments(m)"
        />
        <div class="moment-body">
          <div class="moment-name" @click.stop="openAuthorMoments(m)">{{ m.author.nickname }}</div>
          <div v-if="visLabel(m)" class="moment-vis">{{ visLabel(m) }}</div>
          <div v-if="m.content" class="moment-text" :class="{ clamp: m.content.length > 60 && !expandedMap[m.id] }">{{ m.content }}</div>
          <button
            v-if="m.content && m.content.length > 60"
            class="expand-btn"
            @click="expandedMap = { ...expandedMap, [m.id]: !expandedMap[m.id] }"
          >{{ expandedMap[m.id] ? '收起' : '全文' }}</button>
          <div v-if="m.images?.length" class="moment-images" :class="'n' + Math.min(9, m.images.length)">
            <img
              v-for="(img, i) in m.images.slice(0, 9)"
              :key="i"
              :src="img"
              alt="配图"
              loading="lazy"
              @click.stop="openMomentPreview(m, i)"
            />
          </div>
          <div class="moment-meta">
            <span class="moment-time">{{ fmtTime(m.createdAt) }}</span>
            <div class="moment-actions">
              <button
                class="moment-act"
                :class="{ on: likedByMe(m) }"
                @click.stop="toggleLike(m)"
              >
                <svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 20s-7-4.4-7-9.2C5 8 7 6 9.2 6c1.3 0 2.3.7 2.8 1.6C12.5 6.7 13.5 6 14.8 6 17 6 19 8 19 10.8 19 15.6 12 20 12 20z" fill="none" :stroke="likedByMe(m) ? '#fa5151' : '#576b95'" stroke-width="1.6"/></svg>
                <span class="act-count" @click.stop="openLikes(m)">{{ m.likes?.length || 0 }}</span>
              </button>
              <button class="moment-act" @click.stop="openComment(m)">
                <svg viewBox="0 0 24 24" width="16" height="16"><path d="M5 6h14v9H9l-4 3V6z" fill="none" stroke="#576b95" stroke-width="1.6" stroke-linejoin="round"/></svg>
                <span class="act-count">{{ m.comments?.length || 0 }}</span>
              </button>
            </div>
          </div>
          <div class="interact-box" v-if="likePreview(m) || m.comments?.length">
            <div v-if="likePreview(m)" class="moment-likes" @click="openLikes(m)">♥ {{ likePreview(m) }}</div>
            <div v-if="m.comments?.length" class="moment-comments">
              <div v-for="c in m.comments" :key="c.id" class="comment-line">
                <span class="comment-name" @click="openComment(m, c)">
                  {{ c.userId === me.id ? '我' : c.nickname }}
                  <em v-if="c.isAI" class="ai-tag">AI</em>
                </span>
                <span v-if="c.replyToName" class="comment-reply"> 回复 </span>
                <span v-if="c.replyToName" class="comment-name">{{ c.replyToName }}</span>
                <span class="comment-text">：{{ c.content }}</span>
                <button
                  v-if="canDeleteComment(m, c)"
                  class="comment-del"
                  @click.stop="deleteComment(m, c)"
                >删除</button>
              </div>
            </div>
          </div>
          <div v-if="m.userId === me.id || m.author?.id === me.id" class="moment-owner-del">
            <button class="moment-del" @click.stop="openMenu(m)">删除</button>
          </div>
        </div>
      </article>

      <div v-if="loading" class="load-tip">加载中…</div>
      <div v-else-if="noMore && moments.length" class="load-tip">没有更多了</div>
      </main>
    </template>

    <div v-if="showComposer" class="composer-mask" @click.self="showComposer = false">
      <div class="composer">
        <div class="composer-bar">
          <button class="cancel" @click="showComposer = false">取消</button>
          <span class="composer-title">发表朋友圈</span>
          <button class="ok" :disabled="(!draft.trim() && !pickedImages.length) || publishing" @click="publish">
            {{ publishing ? '…' : '发表' }}
          </button>
        </div>
        <div class="vis-row wechat-vis">
          <div class="vis-head">谁可以看</div>
          <button
            v-for="opt in VIS_OPTIONS"
            :key="opt.value"
            type="button"
            class="vis-opt"
            :class="{ on: visibility === opt.value }"
            @click="pickVisibility(opt.value)"
          >
            <span class="vis-check">{{ visibility === opt.value ? '✓' : '' }}</span>
            <span class="vis-main">
              <span class="vis-label2">{{ opt.label }}</span>
              <span class="vis-sub">{{ opt.value === 'partial' && visibleTo.length ? `已选 ${visibleTo.length} 人` : opt.sub }}</span>
            </span>
          </button>
        </div>
        <div v-if="visibility === 'partial'" class="vis-friends">
          <div class="vis-friends-head">
            <span>选择可见好友（{{ visibleTo.length }}）</span>
            <button type="button" @click="showVisPicker = !showVisPicker">{{ showVisPicker ? '收起' : '展开' }}</button>
          </div>
          <div v-if="showVisPicker" class="vis-friend-list">
            <button
              v-for="f in friendOptions"
              :key="f.id"
              type="button"
              class="vis-friend-item"
              :class="{ on: visibleTo.includes(f.id) }"
              @click="toggleVisFriend(f.id)"
            >
              <span class="vis-friend-check">{{ visibleTo.includes(f.id) ? '✓' : '' }}</span>
              {{ f.nickname }}
            </button>
            <div v-if="!friendOptions.length" class="vis-empty">暂无好友，可先添加好友</div>
          </div>
        </div>
        <textarea
          v-model="draft"
          class="composer-input"
          placeholder="这一刻的想法…"
          maxlength="500"
          rows="6"
        ></textarea>
        <div v-if="pickedImages.length" class="picked-grid">
          <div v-for="(img, i) in pickedImages" :key="img" class="picked-item">
            <img :src="img" alt="配图" />
            <button class="picked-x" @click="removePicked(i)">×</button>
          </div>
        </div>
        <div class="composer-tools">
          <button class="add-photo" @click="pickImages">🖼 添加图片</button>
          <input ref="fileInput" type="file" accept="image/*" multiple hidden @change="onPickFiles" />
          <span class="tool-hint">{{ pickedImages.length ? `${pickedImages.length}/9 张` : '可发纯文字' }} · 长按动态可删除</span>
        </div>
      </div>
    </div>

    <div v-if="commentTarget" class="composer-mask" @click.self="commentTarget = null">
      <div class="composer">
        <div class="composer-bar">
          <button class="cancel" @click="commentTarget = null; replyTo = null">取消</button>
          <span class="composer-title">{{ replyTo ? '回复评论' : '评论' }}</span>
          <button class="ok" :disabled="!commentText.trim()" @click="submitComment">发送</button>
        </div>
        <div class="at-bar">
          <button type="button" class="at-btn" @click="openCommentAt">@ 提醒谁看</button>
        </div>
        <div v-if="showAtPicker" class="at-picker">
          <button
            v-for="f in friendOptions"
            :key="'at-'+f.id"
            type="button"
            class="at-item"
            @click="insertAt(f.nickname)"
          >@{{ f.nickname }}</button>
          <div v-if="!friendOptions.length" class="vis-empty">暂无可@的好友</div>
        </div>
        <textarea
          v-model="commentText"
          class="composer-input"
          placeholder="评论…"
          maxlength="200"
          rows="3"
        ></textarea>
      </div>
    </div>

    <div v-if="menuMoment" class="action-mask" @click.self="menuMoment = null">
      <div class="action-sheet">
        <button class="action-item danger" @click="deleteMoment">删除</button>
        <button class="action-item" @click="menuMoment = null">取消</button>
      </div>
    </div>

    <!-- 大图预览（支持左右滑） -->
    <ImagePreview
      v-if="showPreview && previewImages.length"
      :images="previewImages"
      :index="previewIndex"
      @close="showPreview = false"
      @change="(i) => (previewIndex = i)"
    />

    <!-- 点赞列表（微信底部半屏） -->
    <div v-if="likesMoment" class="likes-mask" @click.self="closeLikes">
      <div class="likes-sheet">
        <div class="likes-head">
          <span>{{ likesMoment.likes?.length || 0 }} 人觉得很赞</span>
          <button type="button" class="likes-close" @click="closeLikes">关闭</button>
        </div>
        <div class="likes-body scroll-y">
          <div v-if="!(likesMoment.likes || []).length" class="likes-empty">还没有人点赞</div>
          <div v-for="(l, i) in (likesMoment.likes || [])" :key="i" class="likes-row">
            <UserAvatar :name="l.nickname" :color="l.isAI ? '#07c160' : '#4f6ef7'" :size="40" :emoji="l.isAI ? '🤖' : null" />
            <div class="likes-main">
              <div class="likes-name">{{ l.nickname }}<em v-if="l.isAI" class="ai-tag">AI</em></div>
              <div class="likes-time">{{ fmtTime(l.createdAt) }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <ImageCropper
      v-if="cropSrc"
      :src="cropSrc"
      :ratio="cropKind === 'cover' ? 'cover' : 'free'"
      :title="cropKind === 'cover' ? '裁剪朋友圈封面' : '裁剪配图'"
      @confirm="onCropConfirm"
      @cancel="onCropCancel"
    />
    <UploadProgress v-if="uploading" :percent="uploadPct" :label="uploadLabel" />
  </div>
</template>

<style scoped>
.page {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--white);
}
.nav {
  background: var(--bg);
  border-bottom: 0.5px solid var(--divider);
}
.moment-text, .comment-text, .empty, .load-tip { color: var(--text); }
.moment-name { color: var(--blue); }
.moment-time, .empty-tip { color: var(--text-3); }
.moment-likes, .moment-comments { background: var(--divider-soft); }
.moment-likes { cursor: pointer; }

/* 点赞列表半屏 */
.likes-mask {
  position: fixed; inset: 0; z-index: 70;
  background: rgba(0,0,0,0.4);
  display: flex; align-items: flex-end;
}
.likes-sheet {
  width: 100%; max-height: 62%;
  background: var(--white, #fff);
  border-radius: 12px 12px 0 0;
  display: flex; flex-direction: column;
  padding-bottom: env(safe-area-inset-bottom, 0px);
  animation: slideUp 200ms var(--ease);
}
@keyframes slideUp {
  from { transform: translateY(40%); opacity: 0.6; }
  to { transform: translateY(0); opacity: 1; }
}
.likes-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px; border-bottom: 0.5px solid var(--divider, #e5e5e5);
  font-size: 15px; font-weight: 600; color: var(--text);
}
.likes-close {
  border: 0; background: transparent; color: var(--text-2);
  font-size: 14px; min-height: 36px; cursor: pointer;
}
.likes-body { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 0 12px; }
.likes-row {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 16px;
}
.likes-name { font-size: 15px; color: var(--text); }
.likes-time { margin-top: 2px; font-size: 12px; color: var(--text-3); }
.likes-empty { padding: 28px; text-align: center; color: var(--text-3); font-size: 13px; }

.interact-box {
  margin-top: 8px;
  border-radius: 6px;
  overflow: hidden;
  background: var(--divider-soft);
}
.interact-box .moment-likes,
.interact-box .moment-comments { background: transparent; }
.act-count {
  margin-left: 2px;
  font-size: 11px;
  color: var(--text-2);
}
.ai-tag {
  display: inline-block;
  margin-left: 4px;
  font-style: normal;
  font-size: 10px;
  color: #07c160;
  border: 1px solid #07c160;
  border-radius: 3px;
  padding: 0 2px;
  line-height: 1.2;
}
.composer, .action-sheet { background: var(--white); }
.add-photo { background: var(--divider-soft); color: var(--text); }
.vis-select { background: var(--white); color: var(--text); }
.vis-friends {
  margin-top: 8px;
  padding: 8px 10px;
  background: var(--divider-soft);
  border-radius: 8px;
}
.vis-friends-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  color: var(--text-2);
}
.vis-friends-head button {
  border: 0;
  background: transparent;
  color: var(--green);
  font-size: 13px;
}
.vis-friend-list {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-height: 160px;
  overflow: auto;
}
.vis-friend-item {
  border: 1px solid var(--divider);
  background: var(--white);
  color: var(--text);
  border-radius: 16px;
  padding: 6px 12px;
  font-size: 13px;
  min-height: 32px;
}
.vis-friend-item.on {
  border-color: var(--green);
  color: var(--green);
  background: rgba(7, 193, 96, 0.08);
}
.vis-empty { font-size: 12px; color: var(--text-3); padding: 6px 0; }
.moment-vis {
  margin-top: 2px;
  font-size: 11px;
  color: var(--text-3);
}
.nav {
  height: 52px;
  background: #ededed;
  border-bottom: 1px solid #d9d9d9;
  display: flex;
  align-items: center;
  padding: 0 14px;
  flex-shrink: 0;
}
.nav-back {
  width: 36px;
  background: none;
  font-size: 30px;
  color: #111;
  line-height: 1;
  padding-bottom: 4px;
  margin-left: -8px;
}
.nav-title {
  flex: 1;
  text-align: center;
  font-size: 17px;
  font-weight: 500;
  color: #111;
}
.nav-cam, .nav-right {
  width: 36px;
  background: none;
  font-size: 20px;
  text-align: right;
}

/* 朋友圈相册（他人） */
.album-page {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  background: var(--white);
  width: 100%;
  padding-bottom: calc(20px + var(--safe-b));
}
.album-cover {
  position: relative;
  width: 100%;
  height: 42vw;
  min-height: 220px;
  max-height: 360px;
  background: linear-gradient(160deg, #d8d2c8, #b9b0a4 45%, #8f877c);
  background-size: cover;
  background-position: center;
}
.album-back {
  position: absolute;
  left: 6px;
  top: 8px;
  width: 40px;
  height: 40px;
  border: 0;
  background: transparent;
  color: #fff;
  font-size: 36px;
  line-height: 1;
  text-shadow: 0 1px 3px rgba(0,0,0,0.35);
  z-index: 2;
}
.album-cover-user {
  position: absolute;
  right: 16px;
  bottom: 12px;
  display: flex;
  align-items: flex-end;
  gap: 10px;
}
.album-cover-name {
  color: #fff;
  font-size: 20px;
  font-weight: 600;
  text-shadow: 0 1px 4px rgba(0,0,0,0.35);
  margin-bottom: 10px;
}
.album-cover-avatar {
  border-radius: 4px !important;
  box-shadow: 0 2px 8px rgba(0,0,0,0.2);
  border: 2px solid rgba(255,255,255,0.85);
}
.album-signature {
  padding: 22px 24px 18px;
  text-align: center;
  font-size: 15px;
  color: var(--text-2);
  background: var(--white);
  letter-spacing: 0.5px;
}
.album-empty {
  padding: 48px 16px;
  text-align: center;
  color: var(--text-3);
  font-size: 14px;
  background: var(--white);
}
.album-body { background: var(--white); padding-bottom: 8px; }
.album-year {
  padding: 18px 20px 10px;
  font-size: 22px;
  font-weight: 600;
  color: var(--text);
}
.album-item {
  width: 100%;
  display: flex;
  gap: 14px;
  padding: 16px 18px;
  border: 0;
  background: var(--white);
  text-align: left;
  align-items: flex-start;
}
.album-item:active { background: var(--press); }
.album-date {
  width: 56px;
  flex-shrink: 0;
  display: flex;
  align-items: baseline;
  gap: 2px;
  padding-top: 2px;
}
.album-day {
  font-size: 28px;
  font-weight: 700;
  color: var(--text);
  line-height: 1;
}
.album-month {
  font-size: 13px;
  color: var(--text-2);
}
.album-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.album-images {
  display: grid;
  gap: 3px;
  width: min(220px, 58vw);
}
.album-images.n1 { grid-template-columns: 1fr; width: min(200px, 50vw); }
.album-images.n2 { grid-template-columns: 1fr 1fr; }
.album-images.n3,
.album-images.n4,
.album-images.n5,
.album-images.n6,
.album-images.n7,
.album-images.n8,
.album-images.n9 { grid-template-columns: repeat(3, 1fr); width: min(240px, 64vw); }
.album-images img {
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  display: block;
  background: var(--divider-soft);
  border-radius: 2px;
}
.album-images.n1 img { aspect-ratio: 4/3; }
.album-text {
  font-size: 15px;
  color: var(--text);
  line-height: 1.5;
  word-break: break-word;
}
.album-dots {
  display: flex;
  justify-content: center;
  gap: 8px;
  padding: 24px 0 8px;
}
.album-dots .dot {
  width: 28px;
  height: 3px;
  border-radius: 2px;
  background: var(--divider);
}
.album-dots .dot.on { background: var(--text-3); }

.content {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  padding-bottom: 24px;
}

.cover {
  position: relative;
  height: 220px;
  margin-bottom: 16px;
}
.cover-bg {
  position: absolute;
  inset: 0;
  background: linear-gradient(160deg, #5b7cfa 0%, #7b5bfa 40%, #c45bfa 100%);
}
.cover-user {
  position: absolute;
  right: 16px;
  bottom: -20px;
  display: flex;
  align-items: flex-end;
  gap: 12px;
}
.cover-name {
  color: #fff;
  font-size: 17px;
  font-weight: 500;
  margin-bottom: 8px;
  text-shadow: 0 1px 3px rgba(0,0,0,0.25);
}

.empty {
  text-align: center;
  color: #b2b2b2;
  font-size: 14px;
  padding: 48px 0;
}

.moments-cover {
  position: relative; height: 220px; background: linear-gradient(160deg, #3d4a5c, #1a222d);
  background-size: cover; background-position: center; margin-bottom: 0;
  background-color: #1a222d;
}
.moments-cover[style*="background-image"] {
  background-color: transparent;
}
.cover-mask { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(0,0,0,0.05), rgba(0,0,0,0.35)); pointer-events: none; z-index: 1; }
.cover-user {
  position: absolute; right: 16px; bottom: 16px; display: flex; align-items: flex-end; gap: 10px; z-index: 2;
}
.cover-name { color: #fff; font-size: 18px; font-weight: 600; text-shadow: 0 1px 4px rgba(0,0,0,0.35); padding-bottom: 8px; }
.cover-avatar :deep(.avatar) { box-shadow: 0 4px 12px rgba(0,0,0,0.25); border: 2px solid rgba(255,255,255,0.85); }
.cover-cam {
  position: absolute; right: 16px; top: 16px; width: 40px; height: 40px; border-radius: 50%;
  border: 0; background: rgba(0,0,0,0.35); display: flex; align-items: center; justify-content: center;
  z-index: 3; cursor: pointer;
}
.cover-file-input {
  position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; overflow: hidden;
}
.moment {
  display: flex;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid #f0f0f0;
}
.moment-body { flex: 1; min-width: 0; }
.moment-avatar { cursor: pointer; flex-shrink: 0; }
.moment-name {
  font-size: 15px;
  font-weight: 500;
  color: #576b95;
  margin-bottom: 4px;
  cursor: pointer;
}
.moment-text {
  font-size: 15px;
  color: #111;
  line-height: 1.45;
  word-break: break-word;
  white-space: pre-wrap;
}
.moment-text.clamp {
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.expand-btn {
  margin-top: 2px;
  background: none;
  color: #576b95;
  font-size: 14px;
  padding: 0;
  align-self: flex-start;
}
.moment-images {
  display: grid;
  gap: 4px;
  margin-top: 8px;
  width: 240px;
}
.moment-images.n1 {
  grid-template-columns: 1fr;
  width: 200px;
}
.moment-images.n1 img { width: 100%; height: 200px; object-fit: cover; border-radius: 4px; }
.moment-images.n2, .moment-images.n4 {
  grid-template-columns: repeat(2, 1fr);
  width: 180px;
}
.moment-images.n3, .moment-images.n5, .moment-images.n6,
.moment-images.n7, .moment-images.n8, .moment-images.n9 {
  grid-template-columns: repeat(3, 1fr);
  width: 240px;
}
.moment-images:not(.n1) img {
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  border-radius: 4px;
}
.img-preview {
  position: fixed;
  inset: 0;
  background: #000;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: fadeIn 160ms var(--ease);
}
.img-preview img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
.preview-close {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 44px;
  height: 44px;
  color: #fff;
  font-size: 22px;
  z-index: 2;
}
.moment-meta {
  display: flex;
  align-items: center;
  margin-top: 8px;
  gap: 12px;
  width: 100%;
}
.moment-time {
  font-size: 12px;
  color: #b2b2b2;
  flex: 1;
}
.moment-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}
.moment-act {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
}
.moment-act:active { background: #f0f0f0; }
.moment-act.on svg path { fill: #fa5151; stroke: #fa5151; }
.moment-likes {
  margin-top: 6px;
  padding: 6px 8px;
  background: #f7f7f7;
  border-radius: 3px;
  font-size: 13px;
  color: #576b95;
  width: 100%;
}
.moment-comments {
  margin-top: 4px;
  padding: 6px 8px;
  background: #f7f7f7;
  border-radius: 3px;
  width: 100%;
}
.comment-line {
  font-size: 13px;
  line-height: 1.5;
  word-break: break-word;
}
.comment-name { color: #576b95; margin-right: 4px; cursor: pointer; }
.comment-reply { color: var(--text-2); font-size: 12px; }
.comment-text { color: #111; }
.comment-del {
  margin-left: 8px;
  background: none;
  color: #fa5151;
  font-size: 12px;
  padding: 0;
}
.vis-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px 0;
}
.vis-label { font-size: 14px; color: var(--text-2); }
.vis-select {
  flex: 1;
  height: 36px;
  border-radius: 6px;
  border: 0.5px solid var(--divider);
  background: var(--white);
  font-size: 14px;
  color: var(--text);
  padding: 0 8px;
}
.wechat-vis {
  flex-direction: column;
  align-items: stretch;
  gap: 0;
  padding: 8px 0 0;
  background: var(--white);
  margin-top: 8px;
}
.vis-head {
  padding: 10px 16px 6px;
  font-size: 12px;
  color: var(--text-3);
}
.vis-opt {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 52px;
  padding: 8px 16px;
  border: 0;
  border-bottom: 0.5px solid var(--divider-soft);
  background: transparent;
  text-align: left;
}
.vis-opt.on .vis-label2 { color: #07c160; }
.vis-check {
  width: 18px;
  color: #07c160;
  font-weight: 700;
  flex-shrink: 0;
}
.vis-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.vis-label2 { font-size: 15px; color: var(--text); }
.vis-sub { font-size: 12px; color: var(--text-3); }
.vis-friend-check {
  display: inline-flex;
  width: 18px;
  color: #07c160;
  margin-right: 4px;
}
.at-bar { padding: 8px 16px 0; }
.at-btn {
  border: 0;
  background: var(--divider-soft);
  color: #576b95;
  font-size: 13px;
  border-radius: 14px;
  min-height: 30px;
  padding: 0 12px;
}
.at-picker {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 10px 16px;
  max-height: 140px;
  overflow-y: auto;
}
.at-item {
  border: 0;
  background: rgba(87, 107, 149, 0.1);
  color: #576b95;
  font-size: 13px;
  border-radius: 14px;
  min-height: 30px;
  padding: 0 10px;
}
.moment-owner-del {
  margin-top: 6px;
  width: 100%;
  display: flex;
  justify-content: flex-end;
}
.moment-del {
  background: none;
  color: #576b95;
  font-size: 12px;
  padding: 0;
}
.picked-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 0 16px 8px;
}
.picked-item {
  position: relative;
  width: 72px;
  height: 72px;
}
.picked-item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 4px;
}
.picked-x {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: rgba(0,0,0,0.55);
  color: #fff;
  font-size: 14px;
  line-height: 20px;
}
.add-photo {
  background: #f0f0f0;
  border-radius: 4px;
  padding: 8px 12px;
  font-size: 13px;
  color: #333;
}

.load-tip {
  text-align: center;
  color: #b2b2b2;
  font-size: 12px;
  padding: 16px 0;
}

.composer-mask, .action-mask {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.45);
  z-index: 50;
  display: flex;
}
.composer-mask { align-items: flex-end; }
.composer {
  width: 100%;
  max-width: 480px;
  margin: 0 auto;
  background: #fff;
  border-radius: 12px 12px 0 0;
  padding-bottom: env(safe-area-inset-bottom);
}
.composer-bar {
  display: flex;
  align-items: center;
  padding: 12px 14px;
  border-bottom: 1px solid #f0f0f0;
}
.composer-bar .cancel,
.composer-bar .ok {
  background: none;
  font-size: 15px;
  min-width: 48px;
}
.composer-bar .cancel { color: #666; text-align: left; }
.composer-bar .ok { color: #07c160; text-align: right; font-weight: 500; }
.composer-bar .ok:disabled { color: #b2b2b2; }
.composer-title {
  flex: 1;
  text-align: center;
  font-size: 16px;
  font-weight: 500;
}
.composer-input {
  width: 100%;
  border: none;
  padding: 14px 16px;
  font-size: 16px;
  resize: none;
  min-height: 140px;
  line-height: 1.5;
}
.composer-tools {
  padding: 10px 16px 16px;
}
.tool-hint {
  font-size: 12px;
  color: #b2b2b2;
}

.action-mask {
  align-items: flex-end;
}
.action-sheet {
  width: 100%;
  max-width: 480px;
  margin: 0 auto;
  background: #f7f7f7;
  border-radius: 12px 12px 0 0;
  padding: 8px 0 calc(8px + env(safe-area-inset-bottom));
}
.action-item {
  width: 100%;
  background: #fff;
  padding: 15px;
  font-size: 16px;
  color: #111;
  border-bottom: 1px solid #f0f0f0;
}
.action-item.danger { color: #fa5151; }
.action-item:last-child {
  border-bottom: none;
  margin-top: 8px;
}
</style>
