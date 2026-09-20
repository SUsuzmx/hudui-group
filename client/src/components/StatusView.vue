<script setup>
import { ref, computed } from 'vue';
import { api, compressImage } from '../api.js';
import { toast } from '../toast.js';
import { loadProfileExtras, saveProfileExtras } from '../profile-extras.js';
import { STATUS_GRADIENTS as BG } from '../status-bg.js';

/**
 * 微信「设个状态」
 * step pick: 状态九宫格
 * step edit: 选中后的编辑页（对齐官方截图）
 */
const props = defineProps({
  me: { type: Object, default: null },
});
const emit = defineEmits(['close', 'back', 'updated']);

const ICONS = {
  smile: `<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5c1.2 1.3 2.5 2 3.5 2s2.3-.7 3.5-2"/><circle cx="9" cy="10" r="0.8" fill="currentColor" stroke="none"/><circle cx="15" cy="10" r="0.8" fill="currentColor" stroke="none"/>`,
  crack: `<circle cx="12" cy="12" r="9"/><path d="M8 8l3 3-2 2 3 3"/><path d="M16 7l-2 3 2 2-2 3"/>`,
  koi: `<circle cx="12" cy="12" r="9"/><path d="M7 13c2-3 5-4 8-2"/><path d="M9 16c2-1 4-1 6 0"/>`,
  sun: `<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4"/>`,
  tired: `<circle cx="12" cy="8" r="3.2"/><path d="M5 20c1.5-3.5 4-5 7-5s5.5 1.5 7 5"/><path d="M9 7.5h.01M15 7.5h.01"/>`,
  daze: `<circle cx="12" cy="9" r="3"/><path d="M6 20c1-3 3.2-4.5 6-4.5S17 17 18 20"/><path d="M8 4c.5 1 1 1.5 2 1.5M16 4c-.5 1-1 1.5-2 1.5"/>`,
  go: `<path d="M7 20l4-8 2-6"/><path d="M13 6l3 2 3-1"/><path d="M9 14h5l2 3"/>`,
  emo: `<rect x="5" y="4" width="3" height="8" rx="1"/><rect x="10.5" y="7" width="3" height="10" rx="1"/><rect x="16" y="3" width="3" height="7" rx="1"/>`,
  cloud: `<path d="M7 16h9a3.5 3.5 0 0 0 0-7 5 5 0 0 0-9.5 1.5A3 3 0 0 0 7 16z"/>`,
  energy: `<path d="M13 3l-2 7h4l-3 11"/><path d="M16 7l3 2"/>`,
  bot: `<rect x="5" y="8" width="14" height="10" rx="2"/><circle cx="9.5" cy="12.5" r="1.2"/><circle cx="14.5" cy="12.5" r="1.2"/><path d="M9 16h6M12 8V5M10 5h4"/>`,
  brick: `<path d="M4 9h16v5H4z"/><path d="M6 14v4M18 14v4M4 12h16"/>`,
  study: `<path d="M5 18c2-4 5-6 7-6s5 2 7 6"/><path d="M8 10c1.2-2 2.5-3 4-3s2.8 1 4 3"/><path d="M4 18h16"/>`,
  busy: `<circle cx="12" cy="7" r="3"/><path d="M8 12v3M16 12v3M8 15c0 3 1.5 5 4 5s4-2 4-5"/>`,
  fish: `<circle cx="12" cy="10" r="3.5"/><path d="M6 18c2-2 4-3 6-3s4 1 6 3"/><path d="M12 4v2"/>`,
  plane: `<path d="M3 13l18-6-4 7 4 7-18-6z"/><path d="M11 13h6"/>`,
  runhome: `<circle cx="15" cy="5.5" r="2"/><path d="M7 20l3-6 4-2 2 4"/><path d="M10 14l-2-3 4-2"/>`,
  moon: `<path d="M16 14.5A6.5 6.5 0 0 1 9.5 8 6.5 6.5 0 1 0 16 14.5z"/>`,
  wave: `<path d="M4 14c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/><path d="M4 18c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/><path d="M8 10l2-4 2 3 2-5"/>`,
  clock: `<circle cx="12" cy="12" r="8"/><path d="M12 8v5l3 2"/>`,
  sport: `<circle cx="14" cy="5" r="2"/><path d="M7 20l4-7 3-2 3 4"/><path d="M9 12l-2-2"/>`,
  coffee: `<path d="M6 9h10v6a4 4 0 0 1-4 4H10a4 4 0 0 1-4-4V9z"/><path d="M16 11h2a2.5 2.5 0 0 1 0 5h-2"/><path d="M8 5c.5 1 .5 2 0 3M11 4c.5 1 .5 2 0 3"/>`,
  milktea: `<path d="M7 8h10l-1 12H8L7 8z"/><path d="M8 8l2-3h4l2 3"/><path d="M10 13h4M10 16h4"/>`,
  rice: `<path d="M4 12h16c0 4-3 7-8 7s-8-3-8-7z"/><path d="M8 8c.5-2 2-3 4-3s3.5 1 4 3"/>`,
  baby: `<circle cx="8" cy="8" r="2"/><circle cx="16" cy="10" r="1.8"/><path d="M6 20v-5c0-2 1.5-3.5 3.5-3.5S13 13 13 15v5"/><path d="M14 20v-4c0-1.5 1-2.5 2.5-2.5S19 14.5 19 16v4"/>`,
  hero: `<circle cx="12" cy="5" r="2"/><path d="M12 7v5l-4 4M12 12l4 4"/><path d="M7 4l2 2M17 4l-2 2"/>`,
  selfie: `<circle cx="12" cy="10" r="3.5"/><path d="M6 20c1.2-3 3.5-4.5 6-4.5s4.8 1.5 6 4.5"/><path d="M17 6l2-2M7 6L5 4"/>`,
};

const CATEGORIES = [
  {
    title: '心情想法',
    items: [
      { key: 'happy', icon: 'smile', label: '美滋滋', text: '美滋滋' },
      { key: 'crack', icon: 'crack', label: '裂开', text: '裂开了' },
      { key: 'koi', icon: 'koi', label: '求锦鲤', text: '求锦鲤' },
      { key: 'sunny', icon: 'sun', label: '等天晴', text: '等天晴' },
      { key: 'tired', icon: 'tired', label: '疲惫', text: '疲惫' },
      { key: 'daze', icon: 'daze', label: '发呆', text: '发呆中' },
      { key: 'go', icon: 'go', label: '冲', text: '冲！' },
      { key: 'emo', icon: 'emo', label: 'emo', text: 'emo' },
      { key: 'think', icon: 'cloud', label: '胡思乱想', text: '胡思乱想' },
      { key: 'energy', icon: 'energy', label: '元气满满', text: '元气满满' },
      { key: 'bot', icon: 'bot', label: 'bot', text: 'bot' },
    ],
  },
  {
    title: '工作学习',
    items: [
      { key: 'brick', icon: 'brick', label: '搬砖', text: '搬砖中' },
      { key: 'study', icon: 'study', label: '沉迷学习', text: '沉迷学习' },
      { key: 'busy', icon: 'busy', label: '忙', text: '忙' },
      { key: 'fish', icon: 'fish', label: '摸鱼', text: '摸鱼中' },
      { key: 'trip', icon: 'plane', label: '出差', text: '出差中' },
      { key: 'runhome', icon: 'runhome', label: '飞奔回家', text: '飞奔回家' },
      { key: 'dnd', icon: 'moon', label: '勿扰模式', text: '勿扰模式' },
    ],
  },
  {
    title: '活动',
    items: [
      { key: 'wave', icon: 'wave', label: '浪', text: '出去浪' },
      { key: 'checkin', icon: 'clock', label: '打卡', text: '打卡' },
      { key: 'sport', icon: 'sport', label: '运动', text: '运动中' },
      { key: 'coffee', icon: 'coffee', label: '喝咖啡', text: '喝咖啡' },
      { key: 'milktea', icon: 'milktea', label: '喝奶茶', text: '喝奶茶' },
      { key: 'eat', icon: 'rice', label: '干饭', text: '干饭中' },
      { key: 'baby', icon: 'baby', label: '带娃', text: '带娃中' },
      { key: 'hero', icon: 'hero', label: '拯救世界', text: '拯救世界' },
      { key: 'selfie', icon: 'selfie', label: '自拍', text: '自拍' },
    ],
  },
];

const step = ref('pick'); // pick | edit
const selected = ref(null);
const draftText = ref('');
const topic = ref('');
const location = ref('');
const visibility = ref('public'); // public | friends
const bgUrl = ref('');
const bgType = ref(null);
const showTopic = ref(false);
const showLoc = ref(false);
const saving = ref(false);
const bgInput = ref(null);
const uploadingBg = ref(false);

const editBg = computed(() => {
  if (bgUrl.value) {
    return bgType.value === 'video' ? '#1a1a1a' : (BG[selected.value?.key] || BG.custom);
  }
  return BG[selected.value?.key] || BG.custom;
});

const visLabel = computed(() => (visibility.value === 'friends' ? '好友' : visibility.value === 'private' ? '私密' : '公开'));
const canSubmit = computed(() => Boolean(selected.value));

function iconSvg(key) {
  return ICONS[key] || ICONS.smile;
}

function pick(item) {
  selected.value = item;
  if (!draftText.value.trim()) draftText.value = item.text;
  step.value = 'edit';
}

function backToPick() {
  step.value = 'pick';
}

function closeAll() {
  emit('close');
  emit('back');
}

function cycleVis() {
  visibility.value = visibility.value === 'public' ? 'friends' : visibility.value === 'friends' ? 'private' : 'public';
}

async function onBgFile(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  const isVideo = file.type.startsWith('video/');
  const isImage = file.type.startsWith('image/');
  if (!isImage && !isVideo) {
    toast('请选择图片或视频');
    return;
  }
  uploadingBg.value = true;
  try {
    let url;
    if (isVideo) {
      const d = await api.uploadChatMedia(file, 'video');
      url = d?.url;
    } else {
      const data = await compressImage(file, 1280, 0.8);
      const d = await api.uploadMomentImage(data);
      url = d?.url;
    }
    if (!url) throw new Error('上传失败');
    bgUrl.value = url;
    bgType.value = isVideo ? 'video' : 'image';
    toast('背景已设置');
  } catch (err) {
    toast(err.message || '背景上传失败');
  } finally {
    uploadingBg.value = false;
  }
}

function fillLocation() {
  if (!navigator.geolocation) {
    showLoc.value = true;
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      location.value = `${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`;
      showLoc.value = false;
      toast('已获取位置');
    },
    () => { showLoc.value = true; },
    { timeout: 4000 }
  );
}

async function submit() {
  if (!canSubmit.value || saving.value) return;
  saving.value = true;
  const text = draftText.value.trim() || selected.value?.text || selected.value?.label || '状态中';
  const status = {
    key: selected.value?.key || 'custom',
    label: selected.value?.label || text,
    text,
    icon: selected.value?.icon || 'smile',
    topic: topic.value.trim(),
    location: location.value.trim(),
    visibility: visibility.value,
    bgUrl: bgUrl.value || null,
    bgType: bgType.value,
    at: Date.now(),
    expiresInHours: 24,
  };
  try {
    saveProfileExtras(props.me?.id, { status });
    const { user } = await api.updateMe({ signature: text, status });
    emit('updated', user || { ...(props.me || {}), signature: text, status });
    toast('状态已设置 · 朋友24小时内可见');
    closeAll();
  } catch (e) {
    toast(e.message || '设置失败');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div v-if="step === 'pick'" class="status-modal pick-page" role="dialog" aria-label="设个状态">
    <div class="status-bg pick-bg"></div>
    <header class="status-nav">
      <button class="close-btn" type="button" aria-label="关闭" @click="closeAll">
        <svg viewBox="0 0 24 24" width="28" height="28"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </button>
      <div class="nav-center">
        <div class="nav-title">设个状态</div>
        <div class="nav-sub">朋友24小时内可见</div>
      </div>
      <div class="nav-spacer"></div>
    </header>
    <main class="status-body scroll-y">
      <section v-for="cat in CATEGORIES" :key="cat.title" class="cat-card">
        <div class="cat-title">{{ cat.title }}</div>
        <div class="icon-grid">
          <button
            v-for="item in cat.items"
            :key="item.key"
            type="button"
            class="icon-cell"
            :class="{ on: selected?.key === item.key }"
            @click="pick(item)"
          >
            <span class="icon-box">
              <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" v-html="iconSvg(item.icon)"></svg>
            </span>
            <span class="icon-label">{{ item.label }}</span>
          </button>
        </div>
      </section>
    </main>
  </div>

  <!-- 编辑页：对齐微信官方截图 -->
  <div v-else class="status-modal edit-page" role="dialog" aria-label="状态编辑">
    <div
      class="status-bg edit-bg"
      :style="{ background: editBg }"
    ></div>
    <video
      v-if="bgUrl && bgType === 'video'"
      class="bg-media"
      :src="bgUrl"
      autoplay
      muted
      loop
      playsinline
    ></video>
    <img v-else-if="bgUrl && bgType === 'image'" class="bg-media" :src="bgUrl" alt="状态背景" />

    <header class="edit-top">
      <button class="close-btn" type="button" aria-label="关闭" @click="closeAll">
        <svg viewBox="0 0 24 24" width="28" height="28"><path d="M6 6l12 12M18 6L6 18" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>
      </button>
      <button type="button" class="status-pill" @click="backToPick">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" v-html="iconSvg(selected?.icon || 'smile')"></svg>
        <span class="pill-label">{{ selected?.label || '状态' }}</span>
        <span class="pill-arrow">›</span>
      </button>
    </header>

    <main class="edit-main">
      <textarea
        v-model="draftText"
        class="say-input"
        rows="2"
        maxlength="80"
        placeholder="说点什么..."
      ></textarea>
      <button type="button" class="topic-chip" @click="showTopic = true">#话题</button>
      <div v-if="topic" class="topic-on">#{{ topic }}</div>
      <div v-if="location" class="loc-on">📍 {{ location }}</div>
    </main>

    <footer class="edit-foot">
      <button type="button" class="foot-btn" :disabled="uploadingBg" @click="bgInput?.click()">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="M3 16l5-4 4 3 3-2 6 5"/></svg>
        <span>背景</span>
      </button>
      <input ref="bgInput" type="file" accept="image/*,video/*" hidden @change="onBgFile" />
      <button type="button" class="foot-btn" @click="fillLocation">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 21s7-5.4 7-11a7 7 0 1 0-14 0c0 5.6 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>
        <span>位置</span>
      </button>
      <button type="button" class="foot-btn" @click="cycleVis">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="8" r="3.2"/><path d="M5 19c1.2-3.2 3.8-5 7-5s5.8 1.8 7 5"/></svg>
        <span>{{ visLabel }}</span>
      </button>
      <button type="button" class="go-btn" :disabled="saving" @click="submit">
        {{ saving ? '发布中…' : '就这样' }}
      </button>
    </footer>

    <div v-if="showTopic" class="sheet-mask" @click.self="showTopic = false">
      <div class="sheet">
        <div class="sheet-title"># 话题</div>
        <input v-model="topic" maxlength="20" placeholder="例如：周末去哪" />
        <div class="sheet-actions">
          <button type="button" @click="showTopic = false">取消</button>
          <button type="button" class="ok" @click="showTopic = false">确定</button>
        </div>
      </div>
    </div>
    <div v-if="showLoc" class="sheet-mask" @click.self="showLoc = false">
      <div class="sheet">
        <div class="sheet-title">位置</div>
        <input v-model="location" maxlength="40" placeholder="填写位置" />
        <div class="sheet-actions">
          <button type="button" @click="showLoc = false; location = ''">清除</button>
          <button type="button" class="ok" @click="showLoc = false">确定</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.status-modal {
  position: fixed;
  inset: 0;
  z-index: 5000;
  display: flex;
  flex-direction: column;
  color: #fff;
  overflow: hidden;
}
.status-bg {
  position: absolute;
  inset: 0;
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}
.pick-bg {
  background: radial-gradient(120% 80% at 50% 0%, #a8bcd2 0%, #7891af 45%, #5a7396 100%);
}
.edit-bg {
  background: linear-gradient(165deg, #d6e26a 0%, #b5cf55 42%, #8fb84a 100%);
}
.bg-media {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  z-index: 0;
}
.status-nav {
  position: relative; z-index: 2;
  display: flex; align-items: flex-start; justify-content: space-between;
  padding: calc(8px + env(safe-area-inset-top, 0px)) 8px 8px;
  flex-shrink: 0;
}
.close-btn {
  width: 44px; height: 44px; border: 0; background: transparent;
  color: #fff; display: grid; place-items: center; cursor: pointer; flex-shrink: 0;
}
.nav-center { flex: 1; text-align: center; padding-top: 2px; }
.nav-title { font-size: 18px; font-weight: 600; color: #fff; }
.nav-sub { margin-top: 4px; font-size: 13px; color: rgba(255,255,255,0.72); }
.nav-spacer { width: 44px; flex-shrink: 0; }
.status-body {
  position: relative; z-index: 1; flex: 1; min-height: 0; overflow-y: auto;
  padding: 8px 14px 40px;
}
.cat-card {
  border-radius: 16px;
  background: rgba(255,255,255,0.12);
  border: 1px solid rgba(255,255,255,0.16);
  padding: 14px 10px 16px;
  margin-bottom: 12px;
}
.cat-title { font-size: 14px; color: rgba(255,255,255,0.78); padding: 0 6px 12px; }
.icon-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px 4px; }
.icon-cell {
  border: 0; background: transparent; color: rgba(255,255,255,0.92);
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  min-height: 64px; padding: 4px 0; cursor: pointer; border-radius: 10px;
}
.icon-cell.on .icon-box {
  background: rgba(255,255,255,0.28);
  box-shadow: 0 0 0 1.5px rgba(255,255,255,0.55);
}
.icon-box {
  width: 44px; height: 44px; border-radius: 50%;
  display: grid; place-items: center; color: #fff;
}
.icon-label { font-size: 12px; color: rgba(255,255,255,0.92); line-height: 1.2; text-align: center; }

/* 编辑页 */
.edit-top {
  position: relative; z-index: 2;
  display: flex; align-items: flex-start; gap: 8px;
  padding: calc(10px + env(safe-area-inset-top, 0px)) 12px 0;
  flex-shrink: 0;
}
.status-pill {
  display: inline-flex; align-items: center; gap: 6px;
  margin-top: 8px;
  border: 0; border-radius: 20px;
  background: rgba(255,255,255,0.22);
  color: #fff; font-size: 15px; font-weight: 500;
  padding: 8px 12px 8px 10px;
  cursor: pointer;
  backdrop-filter: blur(8px);
}
.pill-arrow { opacity: 0.85; font-size: 16px; }
.edit-main {
  position: relative; z-index: 2;
  flex: 1; min-height: 0;
  display: flex; flex-direction: column; justify-content: flex-start;
  padding: 28vh 22px 20px;
}
.say-input {
  width: 100%;
  min-height: 56px;
  border: 0;
  background: transparent;
  resize: none;
  outline: none;
  color: rgba(255,255,255,0.92);
  font-size: 28px;
  line-height: 1.35;
  font-weight: 400;
  caret-color: #5d8f3a;
}
.say-input::placeholder { color: rgba(255,255,255,0.45); }
.topic-chip {
  align-self: flex-start;
  margin-top: 12px;
  border: 1px solid rgba(255,255,255,0.45);
  background: rgba(255,255,255,0.12);
  color: #fff;
  border-radius: 16px;
  padding: 6px 14px;
  font-size: 14px;
  cursor: pointer;
}
.topic-on, .loc-on {
  margin-top: 10px;
  font-size: 13px;
  color: rgba(255,255,255,0.85);
}
.edit-foot {
  position: relative; z-index: 2;
  flex-shrink: 0;
  display: flex; align-items: center; gap: 12px;
  padding: 14px 16px calc(16px + env(safe-area-inset-bottom, 0px));
  background: #000;
}
.foot-btn {
  border: 0; background: transparent; color: #fff;
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  min-width: 48px; font-size: 12px; cursor: pointer; padding: 0;
}
.foot-btn:disabled { opacity: 0.5; }
.go-btn {
  margin-left: auto;
  min-width: 96px;
  min-height: 44px;
  border: 0;
  border-radius: 8px;
  background: #3ecf6e;
  color: #fff;
  font-size: 17px;
  font-weight: 600;
  cursor: pointer;
  padding: 0 20px;
}
.go-btn:disabled { opacity: 0.55; }
.go-btn:active { filter: brightness(0.95); }
.sheet-mask {
  position: absolute; inset: 0; z-index: 20;
  background: rgba(0,0,0,0.45);
  display: flex; align-items: flex-end;
}
.sheet {
  width: 100%;
  background: #1c1c1e;
  color: #fff;
  border-radius: 12px 12px 0 0;
  padding: 16px 16px calc(16px + env(safe-area-inset-bottom, 0px));
}
.sheet-title { font-size: 15px; font-weight: 600; margin-bottom: 12px; }
.sheet input {
  width: 100%; min-height: 40px; border: 0; border-radius: 8px;
  background: #2c2c2e; color: #fff; padding: 0 12px; font-size: 15px;
}
.sheet-actions {
  display: flex; justify-content: flex-end; gap: 12px; margin-top: 14px;
}
.sheet-actions button {
  border: 0; background: transparent; color: rgba(255,255,255,0.7);
  min-height: 40px; padding: 0 12px; font-size: 15px;
}
.sheet-actions button.ok { color: #3ecf6e; font-weight: 600; }
</style>
