<script setup>
import { ref, onMounted, computed } from 'vue';
import { api } from '../api.js';
import { toast } from '../toast.js';
import UserAvatar from './UserAvatar.vue';
import { loadFriendExtras } from '../profile-extras.js';

const props = defineProps({
  user: { type: Object, required: true },
  me: { type: Object, default: null },
});
const emit = defineEmits([
  'back',
  'open-chat',
  'open-video-call',
  'open-moments',
  'open-detail',
  'open-settings',
  'open-channel',
]);

const profile = ref(null);
const loading = ref(true);
const error = ref('');
const momentThumbs = ref([]);
const momentsLoaded = ref(false);
/** 视频号：仅在对方有视频内容时展示该栏 */
const channel = ref({ name: '', videos: [] });

const isSelf = computed(() => Number(profile.value?.id) === Number(props.me?.id));
const isAI = computed(() => Boolean(profile.value?.isAI || props.user?.isAI));
const showChannel = computed(() => (channel.value.videos || []).length > 0);
const showMomentDash = computed(() => momentsLoaded.value && !momentThumbs.value.length);
const displayName = computed(() => profile.value?.remark || profile.value?.nickname || props.user?.nickname || '');
const nicknameText = computed(() => profile.value?.nickname || props.user?.nickname || '');
const wxidText = computed(() => profile.value?.wxid || '未设置');
const regionText = computed(() => profile.value?.region || props.user?.region || '未设置');
const genderIcon = computed(() => {
  const g = profile.value?.gender;
  if (g === 'female') return '♀';
  if (g === 'male') return '♂';
  return '';
});

function payloadUser() {
  const p = profile.value || {};
  return {
    id: p.userId ?? p.id,
    userId: Number(p.userId ?? p.id) || null,
    nickname: p.nickname,
    remark: p.remark || null,
    avatar: p.avatar,
    avatarColor: p.avatarColor,
    wxid: p.wxid,
    region: p.region,
    signature: p.signature,
    gender: p.gender,
    isAI: Boolean(p.isAI),
  };
}

function loadChannelFromExtras(uid) {
  const extras = loadFriendExtras(uid) || {};
  const videos = Array.isArray(extras.channelVideos) ? extras.channelVideos.filter(Boolean) : [];
  if (videos.length) {
    channel.value = {
      name: extras.channelName || profile.value?.nickname || '视频号',
      videos,
    };
  } else {
    // 没发过视频号：隐藏整栏，不用占位
    channel.value = { name: '', videos: [] };
  }
}

async function load() {
  loading.value = true;
  error.value = '';
  momentsLoaded.value = false;
  momentThumbs.value = [];
  channel.value = { name: '', videos: [] };
  try {
    if (props.user?.isAI || props.user?.local) {
      profile.value = {
        id: props.user.id ?? props.user.userId,
        nickname: props.user.nickname,
        avatar: props.user.avatar ?? props.user.avatarUrl ?? null,
        emoji: props.user.emoji ?? props.user.avatarEmoji ?? null,
        avatarColor: props.user.color ?? props.user.avatarColor ?? '#07c160',
        wxid: props.user.wxid || null,
        region: props.user.region || '',
        signature: props.user.signature || '',
        gender: props.user.gender || '',
        isFriend: props.user.isFriend ?? true,
        isAI: Boolean(props.user.isAI),
        personaId: props.user.personaId ?? null,
        remark: props.user.remark || null,
      };
    } else {
      const uid = Number(props.user?.userId ?? props.user?.id);
      const data = await api.user(uid);
      profile.value = data.user || null;
      if (profile.value) loadChannelFromExtras(uid);
    }
  } catch (e) {
    error.value = e.message || '加载失败';
  } finally {
    loading.value = false;
  }
  await loadMomentThumbs();
}

async function loadMomentThumbs() {
  const uid = Number(profile.value?.userId ?? profile.value?.id ?? props.user?.userId ?? props.user?.id);
  momentThumbs.value = [];
  if (!uid || isAI.value) {
    momentsLoaded.value = true;
    return;
  }
  try {
    const data = await api.userMoments(uid);
    const imgs = [];
    for (const m of data.moments || []) {
      for (const img of m.images || []) {
        if (img) imgs.push(img);
        if (imgs.length >= 4) break;
      }
      if (imgs.length >= 4) break;
    }
    momentThumbs.value = imgs;
  } catch {
    momentThumbs.value = [];
  } finally {
    momentsLoaded.value = true;
  }
}

function onFriendInfo() {
  if (isAI.value || isSelf.value) return;
  emit('open-detail', payloadUser());
}

function onMoments() {
  emit('open-moments', payloadUser());
}

function onChannel(v) {
  emit('open-channel', {
    channel: channel.value,
    video: v || null,
    user: payloadUser(),
  });
}

function onSendMessage() {
  if (!profile.value && !props.user) return;
  emit('open-chat', payloadUser());
}

function onCall() {
  if (isAI.value) {
    toast('暂不支持与 AI 音视频通话');
    return;
  }
  emit('open-video-call', {
    callMode: 'video',
    role: 'caller',
    target: {
      nickname: displayName.value,
      avatar: profile.value?.avatar,
      color: profile.value?.avatarColor,
      userId: Number(profile.value?.userId ?? profile.value?.id) || null,
    },
  });
}

function openSettings() {
  emit('open-settings', payloadUser());
}

onMounted(load);
</script>

<template>
  <div class="page">
    <header class="nav">
      <button class="nav-back" type="button" aria-label="返回" @click="emit('back')">
        <svg viewBox="0 0 24 24" width="24" height="24"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <div class="nav-title"></div>
      <button class="nav-more" type="button" aria-label="更多" @click="openSettings">
        <svg viewBox="0 0 24 24" width="22" height="22"><circle cx="5" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="19" cy="12" r="1.8" fill="currentColor"/></svg>
      </button>
    </header>

    <main v-if="loading" class="loading">加载中…</main>
    <main v-else-if="error" class="loading">{{ error }}</main>

    <main v-else-if="profile" class="content scroll-y">
      <section class="hero">
        <UserAvatar
          class="hero-avatar"
          :name="displayName"
          :avatar="profile.avatar"
          :emoji="profile.emoji"
          :color="profile.avatarColor"
          :size="84"
        />
        <div class="hero-main">
          <div class="hero-name">
            {{ displayName }}
            <span v-if="genderIcon" class="gender" :class="genderIcon === '♀' ? 'female' : 'male'">{{ genderIcon }}</span>
          </div>
          <div class="hero-line">昵称：{{ nicknameText }}</div>
          <div class="hero-line">微信号：{{ wxidText }}</div>
          <div class="hero-line">地区：{{ regionText }}</div>
        </div>
      </section>

      <section class="card block">
        <button class="row-link" type="button" @click="onFriendInfo">
          <div class="row-title">朋友资料</div>
          <div class="row-desc">添加朋友的备注名、电话、标签、备忘、照片等，并设置朋友权限。</div>
          <span class="arrow">›</span>
        </button>
      </section>

      <section class="card moments-card">
        <button class="row-link moments-row" type="button" @click="onMoments">
          <div class="row-title moments-label">朋友圈</div>
          <div class="thumbs">
            <template v-if="momentThumbs.length">
              <div v-for="(img, i) in momentThumbs" :key="i" class="thumb">
                <img :src="img" alt="" loading="lazy" />
              </div>
            </template>
            <div v-else class="moment-dash" role="presentation" aria-label="暂无朋友圈"></div>
          </div>
          <span class="arrow">›</span>
        </button>
      </section>

      <section v-if="showChannel" class="card channel-card">
        <button class="row-link channel-row" type="button" @click="onChannel(null)">
          <div class="channel-left">
            <div class="row-title">视频号</div>
          </div>
          <div class="channel-right">
            <div class="channel-name">{{ channel.name }}</div>
            <div class="channel-videos">
              <button
                v-for="v in channel.videos"
                :key="v.id || v.title"
                class="ch-video"
                type="button"
                @click.stop="onChannel(v)"
              >
                <img v-if="v.cover" class="ch-cover" :src="v.cover" :alt="v.title || ''" loading="lazy" />
                <div v-else class="ch-cover">{{ (v.title || '视').slice(0, 1) }}</div>
                <span class="ch-play">▶</span>
              </button>
            </div>
          </div>
          <span class="arrow">›</span>
        </button>
      </section>

      <section v-if="!isSelf" class="card actions">
        <button class="action-btn" type="button" @click="onSendMessage">
          <span class="action-ico">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6">
              <path d="M4.5 6.5A2.5 2.5 0 017 4h10a2.5 2.5 0 012.5 2.5v7A2.5 2.5 0 0117 16H9l-4 3.2V6.5z"/>
            </svg>
          </span>
          <span>发消息</span>
        </button>
        <button class="action-btn" type="button" @click="onCall">
          <span class="action-ico">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6">
              <path d="M6.2 4.5h3l1.4 3.6-2 1.4c.8 2.2 2.6 4 4.8 4.8l1.4-2 3.6 1.4v3c0 1-.8 1.8-1.8 1.8C10.2 18.5 5.5 13.8 5.5 6.3c0-1 .7-1.8 1.7-1.8z"/>
              <rect x="14.5" y="13.5" width="5.5" height="4" rx="1"/>
              <path d="M16 13.5v-1.2c0-.6.5-1.1 1.1-1.1h2.8c.6 0 1.1.5 1.1 1.1v1.2"/>
            </svg>
          </span>
          <span>音视频通话</span>
        </button>
      </section>
    </main>
  </div>
</template>

<style scoped>
.page {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--bg);
  width: 100%;
}
.nav {
  height: var(--nav-h);
  flex-shrink: 0;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 4px;
  background: var(--bg);
}
.nav-back,
.nav-more {
  width: 44px;
  height: 44px;
  border: 0;
  background: transparent;
  color: var(--text);
  display: flex;
  align-items: center;
  justify-content: center;
}
.nav-title { position: absolute; left: 50%; transform: translateX(-50%); }
.loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-2);
}
.content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-bottom: 24px;
}

.hero {
  display: flex;
  align-items: flex-start;
  gap: 18px;
  padding: 8px 20px 28px;
  background: var(--bg);
}
.hero-avatar {
  border-radius: 8px !important;
  flex-shrink: 0;
}
.hero-main {
  flex: 1;
  min-width: 0;
  padding-top: 4px;
}
.hero-name {
  font-size: 26px;
  font-weight: 700;
  color: var(--text);
  display: flex;
  align-items: center;
  gap: 8px;
  line-height: 1.2;
}
.gender {
  font-size: 20px;
  line-height: 1;
}
.gender.male { color: #576b95; }
.gender.female { color: #fa5151; }
.hero-line {
  margin-top: 10px;
  font-size: 15px;
  color: var(--text-2);
  line-height: 1.4;
}

.card {
  background: var(--white);
  margin-top: 10px;
}
.block { display: flex; flex-direction: column; }
.row-link {
  width: 100%;
  display: block;
  text-align: left;
  border: 0;
  background: var(--white);
  padding: 18px 40px 18px 16px;
  position: relative;
  min-height: 56px;
  color: var(--text);
}
.row-title {
  font-size: 20px;
  font-weight: 600;
  color: var(--text);
}
.row-desc {
  margin-top: 10px;
  font-size: 14px;
  color: var(--text-2);
  line-height: 1.55;
  padding-right: 4px;
}
.arrow {
  position: absolute;
  right: 16px;
  top: 50%;
  transform: translateY(-50%);
  color: #c7c7cc;
  font-size: 20px;
}

.moments-card .moments-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 18px 40px 18px 16px;
}
.moments-label {
  flex-shrink: 0;
  width: 64px;
}
.thumbs {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  min-height: 72px;
}
.thumb {
  width: 56px;
  height: 72px;
  border-radius: 4px;
  overflow: hidden;
  background: var(--divider-soft);
  flex-shrink: 0;
}
.thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
/* 未发过朋友圈：一条横杠 */
.moment-dash {
  flex: 1;
  max-width: 140px;
  height: 2px;
  border-radius: 1px;
  background: var(--text-3);
  opacity: 0.65;
  margin: 0 auto;
}

.channel-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 18px 40px 18px 16px;
}
.channel-left { width: 64px; flex-shrink: 0; }
.channel-right { flex: 1; min-width: 0; }
.channel-name {
  font-size: 20px;
  font-weight: 500;
  color: var(--text);
  margin-bottom: 12px;
}
.channel-videos {
  display: flex;
  gap: 8px;
  overflow: hidden;
}
.ch-video {
  position: relative;
  width: 64px;
  height: 64px;
  border: 0;
  border-radius: 6px;
  overflow: hidden;
  padding: 0;
  background: linear-gradient(145deg, #d8e6d4, #9bb89a);
  flex-shrink: 0;
}
.ch-cover {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255,255,255,0.9);
  font-size: 18px;
  font-weight: 600;
}
.ch-play {
  position: absolute;
  right: 4px;
  bottom: 4px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: rgba(0,0,0,0.45);
  color: #fff;
  font-size: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding-left: 1px;
}

.actions {
  margin-top: 18px;
  display: flex;
  flex-direction: column;
}
.action-btn {
  width: 100%;
  min-height: 64px;
  border: 0;
  background: var(--white);
  color: var(--blue, #576b95);
  font-size: 20px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
}
.action-btn + .action-btn {
  border-top: 0.5px solid var(--divider-soft);
}
.action-ico {
  display: flex;
  color: var(--blue, #576b95);
}
</style>
