<script setup>
import { ref, onMounted, onBeforeUnmount, computed } from 'vue';
import { io } from 'socket.io-client';
import { getToken, api } from '../api.js';
import UserAvatar from './UserAvatar.vue';

const props = defineProps({
  me: { type: Object, required: true },
  mode: { type: String, default: 'feed' },
});
const emit = defineEmits(['back']);

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
const previewImage = ref(null);
const expandedMap = ref({});
const replyTo = ref(null); // { id, name }
const visibility = ref('public');
const visibleTo = ref([]);
const friendOptions = ref([]);
const showVisPicker = ref(false);
const friendList = ref([]);
let liveSocket = null;
let liveTimer = null;

async function refreshFeed() {
  loading.value = true;
  try {
    const data = props.mode === 'mine' ? await api.myMoments() : await api.moments();
    moments.value = data.moments || [];
    noMore.value = (data.moments || []).length < 10;
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

const title = computed(() => (props.mode === 'mine' ? '我的朋友圈' : '朋友圈'));

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
  for (const file of files) {
    if (pickedImages.value.length >= 9) break;
    const data = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(file);
    });
    try {
      const { url } = await api.uploadMomentImage(data);
      pickedImages.value = [...pickedImages.value, url];
    } catch (err) {
      alert(err.message);
    }
  }
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
    if (props.mode === 'mine') {
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
    <header class="nav">
      <button class="nav-back" @click="emit('back')">‹</button>
      <div class="nav-title">{{ title }}</div>
      <button v-if="mode === 'feed'" class="nav-cam" type="button" :disabled="loading" @click="refreshFeed">↻</button>
      <button v-if="mode === 'feed'" class="nav-cam" @click="showComposer = true">📷</button>
      <div v-else class="nav-right"></div>
    </header>

    <main class="content" @scroll="onScroll">
      <div class="cover">
        <div class="cover-bg"></div>
        <div class="cover-user">
          <span class="cover-name">{{ me.nickname }}</span>
          <UserAvatar :name="me.nickname" :avatar="me.avatar" :color="me.avatarColor" :size="64" />
        </div>
      </div>

      <div v-if="moments.length === 0 && !loading" class="empty">还没有动态, 发一条吧</div>

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
          :name="m.author.nickname"
          :avatar="m.author.avatar"
          :color="m.author.avatarColor"
          :size="42"
        />
        <div class="moment-body">
          <div class="moment-name">{{ m.author.nickname }}</div>
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
              @click.stop="previewImage = img"
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
                <span class="act-count">{{ m.likes?.length || 0 }}</span>
              </button>
              <button class="moment-act" @click.stop="openComment(m)">
                <svg viewBox="0 0 24 24" width="16" height="16"><path d="M5 6h14v9H9l-4 3V6z" fill="none" stroke="#576b95" stroke-width="1.6" stroke-linejoin="round"/></svg>
                <span class="act-count">{{ m.comments?.length || 0 }}</span>
              </button>
            </div>
          </div>
          <div class="interact-box" v-if="likePreview(m) || m.comments?.length">
            <div v-if="likePreview(m)" class="moment-likes">♥ {{ likePreview(m) }}</div>
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

    <div v-if="showComposer" class="composer-mask" @click.self="showComposer = false">
      <div class="composer">
        <div class="composer-bar">
          <button class="cancel" @click="showComposer = false">取消</button>
          <span class="composer-title">发表朋友圈</span>
          <button class="ok" :disabled="(!draft.trim() && !pickedImages.length) || publishing" @click="publish">
            {{ publishing ? '…' : '发表' }}
          </button>
        </div>
        <div class="vis-row">
          <span class="vis-label">谁可以看</span>
          <select v-model="visibility" class="vis-select" @change="onVisibilityChange">
            <option value="public">公开</option>
            <option value="friends">好友可见</option>
            <option value="partial">部分可见</option>
            <option value="private">私密</option>
          </select>
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
          <span class="tool-hint">最多 9 张 · 长按动态可删除</span>
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

    <div v-if="previewImage" class="img-preview" @click="previewImage = null">
      <button class="preview-close" @click.stop="previewImage = null">✕</button>
      <img :src="previewImage" alt="预览" @click.stop />
    </div>
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

.moment {
  display: flex;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid #f0f0f0;
}
.moment-body { flex: 1; min-width: 0; }
.moment-name {
  font-size: 15px;
  font-weight: 500;
  color: #576b95;
  margin-bottom: 4px;
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
