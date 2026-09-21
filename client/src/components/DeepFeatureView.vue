<script setup>
import { ref, onMounted } from 'vue';
import { api } from '../api.js';
import { toast } from '../toast.js';
import UserAvatar from './UserAvatar.vue';
import StatusView from './StatusView.vue';

const props = defineProps({
  type: { type: String, required: true },
  me: { type: Object, default: null },
  payload: { type: Object, default: () => ({}) },
});
const emit = defineEmits(['back', 'open-chat', 'open-private']);

const titleMap = {
  lookDetail: '看一看',
  videoChannels: '视频号',
  nearbyHello: '附近的人',
  miniappHome: '小程序',
  gameHome: '游戏',
  servicesHome: '服务',
  statusHome: '状态',
  groupList: '群聊',
  cardDetail: '卡包详情',
  stickerDetail: '表情',
};
const title = ref(titleMap[props.type] || '详情');

const lookItem = ref(props.payload.item || {
  title: 'AI 群友如何改变社交产品',
  sub: '科技早报 · 1.2万阅读',
  body: '当群聊里出现足够像真人的 AI 成员，社交产品的「在线感」会被重新定义。本文讨论人设一致性、消息节奏与媒体生成在即时通讯中的落地方式。',
});
if (!lookItem.value.body) {
  lookItem.value = {
    ...lookItem.value,
    body: '这里是「看一看」演示正文。可在发现页浏览列表，点进查看详情，并使用在看 / 收藏 / 分享。',
  };
}
if (!lookItem.value.body) {
  lookItem.value = {
    ...lookItem.value,
    body: '这里是「看一看」演示正文。可在发现页浏览列表，点进来看详情，并使用在看 / 收藏 / 分享等操作。',
  };
}
const videos = ref([
  { id: 1, title: '城市夜跑第一视角', author: '@运动小张', likes: '2.1万', cover: '🌃' },
  { id: 2, title: '三分钟番茄炒蛋', author: '@厨房日记', likes: '8642', cover: '🍳' },
  { id: 3, title: '周末爬山实拍', author: '@户外老周', likes: '1.3万', cover: '⛰️' },
  { id: 4, title: '前端调试小技巧', author: '@码上谈', likes: '5.6万', cover: '💻' },
  { id: 5, title: '猫咪睡姿大赏', author: '@喵星人', likes: '9.8万', cover: '🐱' },
  { id: 6, title: '吉他入门和弦', author: '@音乐教室', likes: '4210', cover: '🎸' },
]);
const nearby = ref([
  { id: 1, name: '小陈', dist: '0.3km', sign: '今天也要加油', gender: 'PM' },
  { id: 2, name: '阿凯', dist: '0.8km', sign: '打球缺人', gender: '工程师' },
  { id: 3, name: 'Nina', dist: '1.2km', sign: '拍照爱好者', gender: '设计师' },
  { id: 4, name: '老周', dist: '2.1km', sign: '周末爬山', gender: '摄影' },
]);
const miniapps = ref([
  { id: 'm1', name: '美团外卖', desc: '点餐 · 红包', icon: '🍔' },
  { id: 'm2', name: '乘车码', desc: '公交地铁', icon: '🚌' },
  { id: 'm3', name: '腾讯文档', desc: '协作编辑', icon: '📄' },
  { id: 'm4', name: '健康打卡', desc: '企业应用', icon: '💊' },
  { id: 'm5', name: '快递查询', desc: '物流跟踪', icon: '📦' },
  { id: 'm6', name: '天气预报', desc: '实时天气', icon: '🌤️' },
]);
const services = ref([
  { key: 'pay', icon: '💳', label: '收付款' },
  { key: 'wallet', icon: '💰', label: '钱包' },
  { key: 'mobile', icon: '📱', label: '手机充值' },
  { key: 'bills', icon: '🏠', label: '生活缴费' },
  { key: 'traffic', icon: '🚌', label: '交通出行' },
  { key: 'credit', icon: '🏦', label: '信用卡还款' },
  { key: 'fund', icon: '📈', label: '理财通' },
  { key: 'insurance', icon: '🛡️', label: '保险服务' },
  { key: 'city', icon: '🏙️', label: '城市服务' },
  { key: 'charity', icon: '❤️', label: '腾讯公益' },
  { key: 'ticket', icon: '🎬', label: '电影演出' },
  { key: 'hotel', icon: '🏨', label: '酒店预订' },
]);
const statuses = ref([
  { id: 1, emoji: '😊', text: '心情不错', name: props.me?.nickname || '我', time: '刚刚' },
  { id: 2, emoji: '🎯', text: '专注中', name: '思琪', time: '1小时前' },
  { id: 3, emoji: '😷', text: '有点累', name: 'Perry', time: '3小时前' },
]);
const statusPick = ref('😊 心情不错');
const groups = ref([]);
const card = ref(props.payload.card || null);
const helloText = ref('你好，可以交个朋友吗？');
const helloSent = ref({});
const balance = ref(0);
const recentApps = ref([]);
function absGameUrl(urlOrId) {
  const path = String(urlOrId || '').startsWith('/') ? String(urlOrId) : `/games/${urlOrId}/`;
  const normalized = path.endsWith('/') ? path : `${path}/`;
  try {
    return new URL(normalized, window.location.origin).href;
  } catch {
    return normalized;
  }
}

const games = ref([
  { id: 'tower_game', name: '叠塔挑战', desc: '比手速 · 层层叠高楼', icon: '🏗️', url: '/games/tower_game/' },
]);
const gameFrame = ref(null); // { url, name, status }
const gameFrameBusy = ref(false);
const stickerDetail = ref(props.payload.sticker || null);
const favStickers = ref([]);
const STICKER_KEY = 'hudui_stickers';
const STICKER_POOL = ['😀','😂','🥰','😎','🤔','😴','🎉','🔥','👍','🙏','💪','🌈','🍀','🍜','🎮','📸','❤️','⭐','😇','🤩','😢','😤','🤝','✌️','💯','🥳'];
const serviceGroups = [
  {
    title: '金融理财',
    items: [
      { key: 'credit', icon: '💳', label: '信用卡还款' },
      { key: 'fund', icon: '📈', label: '理财通' },
      { key: 'insurance', icon: '🛡️', label: '保险服务' },
    ],
  },
  {
    title: '生活服务',
    items: [
      { key: 'mobile', icon: '📱', label: '手机充值' },
      { key: 'bills', icon: '✅', label: '生活缴费' },
      { key: 'qcoin', icon: '🐧', label: 'Q币充值' },
      { key: 'city', icon: '🏙️', label: '城市服务' },
      { key: 'charity', icon: '🌺', label: '腾讯公益' },
      { key: 'health', icon: '➕', label: '医疗健康' },
    ],
  },
  {
    title: '交通出行',
    items: [
      { key: 'travel', icon: '🧭', label: '出行服务' },
      { key: 'train', icon: '🚄', label: '火车票机票' },
      { key: 'didi', icon: '🚕', label: '滴滴出行' },
      { key: 'hotel', icon: '🏨', label: '酒店民宿' },
    ],
  },
  {
    title: '购物消费',
    items: [
      { key: 'brand', icon: '🛍️', label: '品牌发现' },
      { key: 'jd', icon: '🐶', label: '京东购物' },
      { key: 'meituan', icon: '🐰', label: '美团外卖' },
      { key: 'movie', icon: '🎬', label: '电影演出玩' },
    ],
  },
];

async function load() {
  try { favStickers.value = JSON.parse(localStorage.getItem(STICKER_KEY) || '[]'); } catch { favStickers.value = []; }
  if (props.type === 'servicesHome' || props.type === 'miniappHome' || props.type === 'stickerDetail') {
    if (props.type === 'servicesHome') {
      try {
        const w = await api.wallet();
        balance.value = w.balance ?? 0;
      } catch { balance.value = 0; }
    }
    if (props.type === 'miniappHome') recentApps.value = miniapps.value.slice(0, 3);
  }
  if (props.type === 'groupList') {
    try {
      const d = await api.chats();
      groups.value = (d.chats || []).filter((c) => c.type === 'group');
    } catch { groups.value = []; }
  }
  if (props.type === 'gameHome') {
    try {
      const res = await fetch('/api/games', { headers: { Accept: 'application/json' } });
      if (res.ok) {
        const d = await res.json();
        const list = Array.isArray(d?.games) ? d.games : [];
        if (list.length) {
          games.value = list.map((g) => ({
            id: g.id,
            name: g.nameZh || g.name || g.id,
            desc: g.desc || g.description || '点击开始试玩',
            icon: g.icon || '🎮',
            url: g.url || `/games/${g.id}/`,
          }));
        }
      }
    } catch { /* keep local fallback list */ }
  }
  if (props.type === 'cardDetail' && !card.value) {
    try {
      const d = await api.userCards();
      card.value = d.cards?.[0] || null;
    } catch { /* ignore */ }
  }
}
onMounted(load);

function onService(s) {
  if (s.key === 'wallet' || s.key === 'pay' || ['mobile', 'bills', 'traffic', 'qcoin', 'travel'].includes(s.key)) {
    emit('back', { then: 'wallet' });
    return;
  }
  // 其余服务入口统一进钱包页演示支付，避免空按钮
  emit('back', { then: 'wallet' });
}

function openMini(m) {
  recentApps.value = [m, ...recentApps.value.filter((x) => x.id !== m.id)].slice(0, 6);
  if (m?.gameUrl || m?.url) {
    openGame({ id: m.id, name: m.name, url: m.gameUrl || m.url });
    return;
  }
  emit('back', { then: 'miniapp-detail', payload: m });
}

function openGame(g) {
  if (!g) return;
  const url = absGameUrl(g.url || g.id);
  gameFrameBusy.value = true;
  gameFrame.value = { url, name: g.name || g.id, status: 'loading' };
  // 兜底: 部分环境 iframe load 事件不可靠, 3s 后允许交互
  setTimeout(() => {
    if (gameFrame.value?.url === url && gameFrame.value.status === 'loading') {
      gameFrameBusy.value = false;
      gameFrame.value = { ...gameFrame.value, status: 'ready' };
    }
  }, 3000);
}
function onGameFrameLoad() {
  gameFrameBusy.value = false;
  if (gameFrame.value) gameFrame.value = { ...gameFrame.value, status: 'ready' };
}
function onGameFrameError() {
  gameFrameBusy.value = false;
  if (gameFrame.value) gameFrame.value = { ...gameFrame.value, status: 'error' };
}
function openGameInNewTab() {
  const url = gameFrame.value?.url;
  if (url) window.open(url, '_blank', 'noopener');
}
function closeGame() {
  gameFrameBusy.value = false;
  gameFrame.value = null;
}

function toggleFavSticker(e) {
  if (!e) return;
  try { favStickers.value = JSON.parse(localStorage.getItem(STICKER_KEY) || '[]'); } catch { favStickers.value = []; }
  const set = new Set(favStickers.value);
  if (set.has(e)) set.delete(e); else set.add(e);
  favStickers.value = [...set];
  localStorage.setItem(STICKER_KEY, JSON.stringify(favStickers.value));
  toast(set.has(e) ? '已添加到表情' : '已移出收藏');
}

async function sendHello(u) {
  if (helloSent.value[u.id]) return;
  helloSent.value = { ...helloSent.value, [u.id]: true };
  try {
    await api.addFavorite({ kind: 'text', content: `[附近的人打招呼] ${u.name}: ${helloText.value}`, fromName: u.name });
    toast(`已向 ${u.name} 打招呼`);
  } catch { toast('已发送打招呼（演示）'); }
}

async function setStatus(val) {
  statusPick.value = val;
  try {
    await api.updateMe({ signature: val.replace(/^[^\s]+\s/, '') });
    toast('状态已设置');
  } catch (e) { toast(e.message || '设置失败'); }
}

function openGroup(g) {
  const gid = g.groupId ?? g.id ?? null;
  const conv = g.conversationId
    || (gid ? `grp_${gid}` : null);
  emit('open-chat', {
    conversationId: conv,
    groupId: gid,
    kind: g.kind || null,
    name: g.name,
    isDefault: Boolean(g.isDefault),
  });
}

const lookWatched = ref(false);
const lookFaved = ref(false);
const channelPlayer = ref(null);
const chTab = ref('all');

function openChannel(v) {
  channelPlayer.value = v || null;
}

const channelList = computed(() => {
  const all = videos.value || [];
  if (chTab.value === 'follow') return all.slice(0, 2);
  return all;
});

async function actionLook(kind) {
  const t = lookItem.value || {};
  const title = t.title || '看一看';
  const body = t.body || '';
  try {
    if (kind === 'watch') {
      lookWatched.value = !lookWatched.value;
      if (lookWatched.value) {
        await api.addFavorite({ kind: 'text', content: `[在看] ${title}`, fromName: t.sub || '看一看' });
        toast('已标记在看');
      } else {
        toast('已取消在看');
      }
      return;
    }
    if (kind === 'fav') {
      lookFaved.value = !lookFaved.value;
      if (lookFaved.value) {
        await api.addFavorite({ kind: 'text', content: `${title}\n${body}`, fromName: t.sub || '看一看' });
        toast('已收藏');
      } else {
        toast('已取消收藏');
      }
      return;
    }
    if (kind === 'share') {
      await api.addFavorite({ kind: 'text', content: `[分享] ${title}`, fromName: props.me?.nickname || '我' });
      toast('已生成分享卡片');
    }
  } catch (e) {
    toast(e.message || '操作失败');
  }
}
</script>

<template>
  <div class="page">
    <header class="nav-bar">
      <button class="icon-btn nav-back" @click="emit('back')">
        <svg viewBox="0 0 24 24" width="24" height="24"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <div class="nav-title">{{ title }}</div>
      <div class="nav-right"></div>
    </header>

    <main class="content scroll-y">
      <!-- 看一看详情 -->
      <article v-if="type === 'lookDetail'" class="article">
        <h1>{{ lookItem.title }}</h1>
        <div class="article-meta">{{ lookItem.sub }}</div>
        <div class="article-body">
          <p>{{ lookItem.body }}</p>
          <p>在本项目中，你可以通过 AI 人设、多模型故障转移与朋友圈互动，体验接近真人的群聊节奏。后续可扩展「在看」关系链与文章评论。</p>
        </div>
        <div class="article-actions">
          <button type="button" :class="{ on: lookWatched }" @click="actionLook('watch')">👀 {{ lookWatched ? '已在看' : '在看' }}</button>
          <button type="button" :class="{ on: lookFaved }" @click="actionLook('fav')">⭐ {{ lookFaved ? '已收藏' : '收藏' }}</button>
          <button type="button" @click="actionLook('share')">↗ 分享</button>
        </div>
      </article>

      <!-- 视频号（全屏流） -->
      <div v-else-if="type === 'videoChannels'" class="channels-page">
        <div class="ch-tabs">
          <button class="ch-tab" :class="{ on: chTab === 'all' }" type="button" @click="chTab = 'all'">推荐</button>
          <button class="ch-tab" :class="{ on: chTab === 'follow' }" type="button" @click="chTab = 'follow'">关注</button>
          <button class="ch-tab" :class="{ on: chTab === 'local' }" type="button" @click="chTab = 'local'">同城</button>
        </div>
        <div class="video-grid">
          <button v-for="v in channelList" :key="v.id" class="video-card" type="button" @click="openChannel(v)">
            <div class="video-cover">{{ v.cover }}</div>
            <div class="video-title">{{ v.title }}</div>
            <div class="video-meta">{{ v.author }} · ❤️ {{ v.likes }}</div>
          </button>
        </div>
        <div v-if="channelPlayer" class="game-layer">
          <div class="game-layer-bar">
            <button class="game-layer-back" type="button" @click="channelPlayer = null">‹ 返回</button>
            <span class="game-layer-title">{{ channelPlayer.title }}</span>
          </div>
          <div class="game-layer-frame" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;color:#fff">
            <div style="font-size:56px">{{ channelPlayer.cover }}</div>
            <div>{{ channelPlayer.title }}</div>
            <div style="opacity:.75;font-size:13px">{{ channelPlayer.author }} · ❤️ {{ channelPlayer.likes }}</div>
            <div style="opacity:.55;font-size:12px">演示播放页（预留视频流接口）</div>
          </div>
        </div>
      </div>

      <!-- 附近的人 -->
      <div v-else-if="type === 'nearbyHello'">
        <div class="hello-bar">
          <input v-model="helloText" maxlength="40" placeholder="打招呼内容" />
        </div>
        <section class="card">
          <div v-for="u in nearby" :key="u.id" class="row person">
            <UserAvatar :name="u.name" :color="'#07c160'" :size="44" />
            <div class="person-main">
              <div class="person-name">{{ u.name }} · {{ u.dist }}</div>
              <div class="person-sign">{{ u.gender }} · {{ u.sign }}</div>
            </div>
            <button class="hello-btn" type="button" :disabled="helloSent[u.id]" @click="sendHello(u)">
              {{ helloSent[u.id] ? '已打招呼' : '打招呼' }}
            </button>
          </div>
        </section>
      </div>

      <!-- 小程序 -->
      <div v-else-if="type === 'miniappHome'" class="mini-page">
        <div class="mini-head">小程序</div>
        <div class="mini-section-title">最近使用</div>
        <div class="mini-grid">
          <button v-for="m in (recentApps.length ? recentApps : miniapps.slice(0,3))" :key="'r'+m.id" class="mini-cell" type="button" @click="openMini(m)">
            <span class="mini-icon">{{ m.icon }}</span>
            <span class="mini-name">{{ m.name }}</span>
          </button>
        </div>
        <div class="mini-section-title">我的小程序</div>
        <div class="mini-grid">
          <button v-for="m in miniapps" :key="m.id" class="mini-cell" type="button" @click="openMini(m)">
            <span class="mini-icon">{{ m.icon }}</span>
            <span class="mini-name">{{ m.name }}</span>
            <span class="mini-desc">{{ m.desc }}</span>
          </button>
        </div>
      </div>

      <!-- 游戏中心 -->
      <div v-else-if="type === 'gameHome'" class="game-page">
        <div class="game-section-title">小游戏</div>
        <div class="game-list">
          <button v-for="g in games" :key="g.id" class="game-row" type="button" @click="openGame(g)">
            <span class="game-icon">{{ g.icon }}</span>
            <span class="game-main">
              <span class="game-name">{{ g.name }}</span>
              <span class="game-desc">{{ g.desc }}</span>
            </span>
            <span class="game-play">开始</span>
          </button>
        </div>
      </div>

      <!-- 服务（对齐微信） -->
      <div v-else-if="type === 'servicesHome'" class="svc-page">
        <div class="svc-hero">
          <button class="svc-hero-item" type="button" @click="onService({ key: 'pay', label: '收付款' })">
            <div class="svc-hero-ico">
              <svg viewBox="0 0 48 48" width="40" height="40" fill="none" stroke="#fff" stroke-width="2.2"><path d="M10 18V14a4 4 0 014-4h4M38 18V14a4 4 0 00-4-4h-4M10 30v4a4 4 0 004 4h4M38 30v4a4 4 0 01-4 4h-4"/><path d="M16 24l5 5 11-12"/></svg>
            </div>
            <div class="svc-hero-label">收付款</div>
          </button>
          <button class="svc-hero-item" type="button" @click="onService({ key: 'wallet', label: '钱包' })">
            <div class="svc-hero-ico">
              <svg viewBox="0 0 48 48" width="40" height="40" fill="none" stroke="#fff" stroke-width="2.2"><rect x="8" y="14" width="32" height="22" rx="3"/><path d="M8 20h32"/><circle cx="32" cy="28" r="2.2" fill="#fff" stroke="none"/></svg>
            </div>
            <div class="svc-hero-label">钱包</div>
            <div class="svc-hero-sub">¥{{ Number(balance || 0).toFixed(2) }}</div>
          </button>
        </div>
        <section v-for="g in serviceGroups" :key="g.title" class="svc-card">
          <div class="svc-card-title">{{ g.title }}</div>
          <div class="svc-grid">
            <button v-for="s in g.items" :key="s.key" class="svc-cell" type="button" @click="onService({ key: s.key, label: s.label })">
              <span class="svc-icon">{{ s.icon }}</span>
              <span>{{ s.label }}</span>
            </button>
          </div>
        </section>
      </div>

      <!-- 表情详情 -->
      <div v-else-if="type === 'stickerDetail'" class="sticker-page">
        <div class="sticker-hero">
          <div class="sticker-preview">{{ stickerDetail?.emoji || favStickers[0] || '😊' }}</div>
          <div class="sticker-name">{{ stickerDetail?.name || '我的收藏表情' }}</div>
          <div class="sticker-desc">添加后可在聊天表情面板使用，与内置表情一致发送。</div>
        </div>
        <div class="sticker-actions">
          <button type="button" class="sticker-btn primary" @click="toggleFavSticker(stickerDetail?.emoji || STICKER_POOL[0])">
            {{ favStickers.includes(stickerDetail?.emoji || STICKER_POOL[0]) ? '移出收藏' : '添加到表情' }}
          </button>
        </div>
        <div class="mini-section-title">全部表情</div>
        <div class="sticker-grid">
          <button
            v-for="e in STICKER_POOL"
            :key="e"
            type="button"
            class="sticker-cell"
            :class="{ on: favStickers.includes(e) }"
            @click="stickerDetail = { emoji: e, name: e }; toggleFavSticker(e)"
          >{{ e }}</button>
        </div>
      </div>

      <!-- 状态主页：选状态 → 编辑页 -->
      <div v-else-if="type === 'statusHome'" class="status-host">
        <StatusView
          :me="me"
          @close="emit('back')"
          @back="emit('back')"
          @updated="(u) => { emit('back', { then: 'status-updated', user: u }); }"
        />
      </div>

      <!-- 群聊列表 -->
      <section v-else-if="type === 'groupList'" class="card">
        <button v-for="g in groups" :key="g.id || g.conversationId" class="row person" type="button" @click="openGroup(g)">
          <div class="group-avatars">
            <span v-for="(a, i) in (g.avatars || []).slice(0, 4)" :key="i" class="g-av">{{ a }}</span>
            <span v-if="!(g.avatars || []).length" class="g-av">👥</span>
          </div>
          <div class="person-main">
            <div class="person-name">{{ g.name }}</div>
            <div class="person-sign">{{ g.lastMessage || '暂无消息' }}</div>
          </div>
          <span class="arrow">›</span>
        </button>
        <div v-if="!groups.length" class="empty-tip">暂无群聊</div>
      </section>

      <!-- 卡包详情 -->
      <div v-else-if="type === 'cardDetail'" class="card-detail">
        <div class="card-face" :style="{ background: card?.color || '#07c160' }">
          <div class="card-kind">{{ card?.kind || 'coupon' }}</div>
          <div class="card-title">{{ card?.title || '演示卡券' }}</div>
          <div class="card-sub">{{ card?.subtitle || '可在钱包/卡包查看' }}</div>
        </div>
        <section class="card">
          <div class="row"><span class="label">使用说明</span><span class="value">演示券，无真实核销</span></div>
          <div class="row"><span class="label">有效期</span><span class="value">长期有效</span></div>
          <div class="row"><span class="label">适用范围</span><span class="value">全场演示商品</span></div>
        </section>
      </div>

      <div v-else class="empty-tip" style="padding:40px">页面建设中</div>
    </main>

    <!-- 全屏游戏层 -->
    <div v-if="gameFrame" class="game-layer">
      <div class="game-layer-bar">
        <button class="game-layer-back" type="button" @click="closeGame">‹ 返回</button>
        <span class="game-layer-title">{{ gameFrame.name }}</span>
        <button class="game-layer-side game-layer-ext" type="button" @click="openGameInNewTab">新窗口</button>
      </div>
      <div v-if="gameFrameBusy || gameFrame.status === 'loading'" class="game-layer-loading">游戏加载中…</div>
      <div v-else-if="gameFrame.status === 'error'" class="game-layer-loading">
        <p>游戏页面加载失败</p>
        <button class="hud-btn" type="button" @click="openGameInNewTab">在新窗口打开</button>
      </div>
      <iframe
        :key="gameFrame.url"
        :src="gameFrame.url"
        class="game-layer-frame"
        allow="autoplay; fullscreen; gamepad; clipboard-write"
        referrerpolicy="same-origin"
        @load="onGameFrameLoad"
        @error="onGameFrameError"
      />
    </div>
  </div>
</template>

<style scoped>
.page { flex: 1; display: flex; flex-direction: column; min-height: 0; background: var(--bg); width: 100%; }
/* 状态页为 fixed 全屏，宿主只需占位 */
.status-host { min-height: 1px; }
.nav-bar {
  height: var(--nav-h); flex-shrink: 0; display: flex; align-items: center; justify-content: center;
  position: relative; background: var(--bg); border-bottom: 0.5px solid var(--divider); padding: 0 8px;
}
.nav-back { position: absolute; left: 0; top: 0; bottom: 0; margin: auto 0; }
.nav-right { width: 44px; }
.nav-title { font-size: 17px; font-weight: 600; color: var(--text); }
.content { flex: 1; min-height: 0; padding-bottom: 24px; background: var(--bg); }

/* 服务页 */
.svc-page { background: var(--bg); min-height: 100%; padding-bottom: 24px; }
.svc-hero {
  margin: 10px 12px 0; border-radius: 12px; padding: 28px 16px 24px;
  background: linear-gradient(135deg, #55b685 0%, #3ea56f 55%, #2f9460 100%);
  display: grid; grid-template-columns: 1fr 1fr; color: #fff;
}
.svc-hero-item {
  border: 0; background: transparent; color: #fff;
  display: flex; flex-direction: column; align-items: center; gap: 8px; min-height: 96px;
}
.svc-hero-ico { width: 48px; height: 48px; display: flex; align-items: center; justify-content: center; }
.svc-hero-label { font-size: 18px; font-weight: 600; }
.svc-hero-sub { font-size: 16px; opacity: 0.92; }
.svc-card {
  margin: 12px 12px 0; background: var(--white); border-radius: 12px; overflow: hidden;
  padding: 8px 0 14px;
}
.svc-card-title {
  padding: 10px 16px 6px; font-size: 14px; color: var(--text-2);
}
.svc-grid {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px 6px; padding: 10px 8px 4px;
}
.svc-grid.three { grid-template-columns: repeat(3, 1fr); }
.svc-cell {
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  border: 0; background: transparent; font-size: 12px; color: var(--text); min-height: 72px;
}
.svc-icon {
  width: 46px; height: 46px; border-radius: 12px; background: var(--divider-soft);
  display: flex; align-items: center; justify-content: center; font-size: 22px;
}

/* 小程序 */
.mini-page { background: var(--bg); min-height: 100%; padding-bottom: 24px; }
.mini-head { padding: 14px 16px 4px; font-size: 20px; font-weight: 600; color: var(--text); }
.mini-section-title { padding: 12px 16px 4px; font-size: 13px; color: var(--text-3); }
.mini-grid {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; padding: 8px 12px 4px;
}
.mini-cell {
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  padding: 16px 8px; background: var(--white); border: 0; border-radius: 12px; min-height: 104px;
}
.mini-icon {
  width: 48px; height: 48px; border-radius: 12px; background: var(--divider-soft);
  display: flex; align-items: center; justify-content: center; font-size: 24px;
}
.mini-name { font-size: 13px; color: var(--text); }
.mini-desc { font-size: 11px; color: var(--text-3); }

/* 游戏中心 */
.game-page { background: var(--bg); min-height: 100%; padding-bottom: 24px; }
.game-section-title { padding: 14px 16px 6px; font-size: 13px; color: var(--text-3); }
.game-list { margin: 0 12px; background: var(--white); border-radius: 12px; overflow: hidden; }
.game-row {
  width: 100%; display: flex; align-items: center; gap: 12px;
  padding: 14px; border-bottom: 0.5px solid var(--divider-soft); text-align: left;
}
.game-row:last-child { border-bottom: 0; }
.game-row:active { background: var(--press); }
.game-icon {
  width: 52px; height: 52px; border-radius: 12px; background: var(--divider-soft);
  display: flex; align-items: center; justify-content: center; font-size: 26px; flex-shrink: 0;
}
.game-main { flex: 1; display: flex; flex-direction: column; gap: 3px; }
.game-name { font-size: 16px; color: var(--text); font-weight: 500; }
.game-desc { font-size: 12px; color: var(--text-3); }
.game-play {
  font-size: 13px; color: #07c160; border: 1px solid rgba(7,193,96,0.6);
  border-radius: 14px; padding: 4px 14px; flex-shrink: 0;
}
.game-layer {
  position: fixed; inset: 0; z-index: 4000; background: #111;
  display: flex; flex-direction: column;
}
.game-layer-bar {
  height: 44px; flex-shrink: 0; display: flex; align-items: center; justify-content: space-between;
  background: #1c1c1c; color: #fff; padding: 0 10px;
}
.game-layer-back { color: #fff; font-size: 15px; min-height: 36px; padding: 0 6px; }
.game-layer-title { font-size: 15px; }
.game-layer-side { width: 56px; }
.game-layer-ext {
  width: auto; min-width: 56px; color: #9ecbff; font-size: 13px;
  border: 0; background: transparent; cursor: pointer; padding: 6px 4px;
}
.game-layer-loading {
  position: absolute; inset: 44px 0 0; z-index: 1;
  display: grid; place-items: center; gap: 10px;
  color: #c9d1d9; font-size: 14px; background: #111;
  pointer-events: none;
}
.game-layer-loading .hud-btn,
.game-layer-loading button { pointer-events: auto; }
.game-layer-frame { flex: 1; width: 100%; border: 0; background: #111; position: relative; z-index: 0; }

/* 视频号 */
.channels-page {
  margin: -0 0;
  min-height: 100%;
  background: #0d0d0d;
  display: flex; flex-direction: column;
}
.ch-tabs {
  display: flex; gap: 16px; justify-content: center;
  padding: 8px 12px; background: #0d0d0d;
  border-bottom: 0.5px solid rgba(255,255,255,0.08);
  position: sticky; top: 0; z-index: 2;
}
.ch-tab {
  border: 0; background: transparent; color: rgba(255,255,255,0.55);
  font-size: 15px; min-height: 36px; padding: 0 8px; cursor: pointer;
}
.ch-tab.on { color: #fff; font-weight: 600; }
.ch-feed {
  flex: 1; min-height: 0; overflow-y: auto; padding: 8px 10px 24px;
  display: flex; flex-direction: column; gap: 12px;
}
.ch-card {
  position: relative; border: 0; padding: 0; background: transparent;
  text-align: left; cursor: pointer; border-radius: 12px; overflow: hidden;
  min-height: 220px;
}
.ch-cover {
  position: relative; width: 100%; min-height: 220px;
  background: linear-gradient(160deg, #1f2937 0%, #0f172a 55%, #111827 100%);
  display: flex; align-items: center; justify-content: center;
}
.ch-emoji { font-size: 64px; opacity: 0.9; }
.ch-play {
  position: absolute; inset: 0; display: grid; place-items: center;
  color: rgba(255,255,255,0.85); font-size: 28px;
  text-shadow: 0 2px 8px rgba(0,0,0,0.4);
}
.ch-bottom {
  position: absolute; left: 12px; right: 56px; bottom: 12px;
  color: #fff;
}
.ch-author { font-size: 14px; font-weight: 600; margin-bottom: 4px; }
.ch-title { font-size: 13px; opacity: 0.92; line-height: 1.4; }
.ch-side {
  position: absolute; right: 10px; bottom: 16px;
  display: flex; flex-direction: column; gap: 12px; align-items: center;
  color: #fff; font-size: 12px;
}
.ch-side span { display: block; margin-top: 2px; font-size: 11px; }


/* 表情 */
.sticker-page { background: var(--bg); min-height: 100%; padding-bottom: 24px; }
.sticker-hero {
  background: var(--white); margin-top: 0; padding: 28px 16px 20px; text-align: center;
}
.sticker-preview {
  width: 96px; height: 96px; margin: 0 auto 12px; border-radius: 20px;
  background: var(--divider-soft); display: flex; align-items: center; justify-content: center;
  font-size: 48px;
}
.sticker-name { font-size: 18px; font-weight: 600; color: var(--text); }
.sticker-desc { margin-top: 8px; font-size: 13px; color: var(--text-3); line-height: 1.5; }
.sticker-actions { background: var(--white); padding: 0 16px 16px; }
.sticker-btn {
  width: 100%; min-height: 44px; border: 0; border-radius: 8px;
  background: var(--divider-soft); color: var(--text); font-size: 15px;
}
.sticker-btn.primary { background: #07c160; color: #fff; }
.sticker-grid {
  display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; padding: 8px 12px 12px;
}
.sticker-cell {
  aspect-ratio: 1; border: 2px solid transparent; border-radius: 12px;
  background: var(--white); font-size: 26px; min-height: 48px;
  display: flex; align-items: center; justify-content: center;
}
.sticker-cell.on { border-color: #07c160; background: rgba(7,193,96,0.08); }
.card { background: var(--white); margin-top: 10px; }
.row {
  width: 100%; display: flex; align-items: center; gap: 12px; padding: 12px 16px;
  border-bottom: 0.5px solid var(--divider-soft); background: var(--white);
  text-align: left; min-height: 56px; border-left: 0; border-right: 0; border-top: 0; color: var(--text);
}
.label { flex: 1; font-size: 16px; color: var(--text); }
.value { font-size: 14px; color: var(--text-2); }
.arrow { color: #c0c0c0; font-size: 18px; }
.sec-title { padding: 12px 16px 4px; font-size: 13px; color: var(--text-3); }
.empty-tip { font-size: 12px; color: var(--text-3); text-align: center; padding: 16px; }

.article { padding: 20px 18px; background: var(--white); margin-top: 10px; }
.article h1 { font-size: 22px; line-height: 1.35; color: var(--text); margin: 0 0 10px; }
.article-meta { font-size: 12px; color: var(--text-3); margin-bottom: 16px; }
.article-body p { font-size: 15px; line-height: 1.7; color: var(--text); margin: 0 0 12px; }
.article-actions { display: flex; gap: 8px; margin-top: 20px; }
.article-actions button {
  flex: 1; min-height: 40px; border: 0; border-radius: 8px; background: var(--divider-soft); color: var(--text); font-size: 13px;
}
.article-actions button:active { opacity: 0.85; }
.article-actions button.on { background: #07c160; color: #fff; }
.ch-tabs { display: flex; gap: 8px; padding: 10px 12px 0; }
.ch-tab {
  border: 0; border-radius: 16px; min-height: 30px; padding: 0 12px;
  background: var(--divider-soft); color: var(--text-2); font-size: 13px;
}
.ch-tab.on { background: #07c160; color: #fff; }

.video-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; padding: 12px; }
.video-card {
  border: 0; border-radius: 10px; overflow: hidden; background: var(--white); text-align: left; padding: 0 0 10px;
}
.video-cover {
  aspect-ratio: 3/4; background: linear-gradient(160deg, #2c3e50, #1a1a2e);
  display: flex; align-items: center; justify-content: center; font-size: 48px;
}
.video-title { padding: 8px 10px 2px; font-size: 14px; color: var(--text); }
.video-meta { padding: 0 10px; font-size: 11px; color: var(--text-3); }

.hello-bar { padding: 10px 12px; background: var(--white); margin-top: 10px; }
.hello-bar input {
  width: 100%; box-sizing: border-box; height: 40px; border: 0; border-radius: 8px;
  background: var(--divider-soft); padding: 0 12px; font-size: 14px; color: var(--text);
}
.person-main { flex: 1; min-width: 0; }
.person-name { font-size: 16px; color: var(--text); }
.person-sign { font-size: 12px; color: var(--text-3); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hello-btn {
  min-width: 72px; min-height: 32px; border: 0; border-radius: 16px; background: #07c160; color: #fff; font-size: 12px;
}
.hello-btn:disabled { background: var(--divider-soft); color: var(--text-3); }

.mini-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; padding: 8px 12px 16px; }
.mini-cell {
  display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 16px 8px;
  background: var(--white); border: 0; border-radius: 10px; min-height: 88px;
}
.mini-icon { font-size: 28px; }
.mini-name { font-size: 14px; color: var(--text); }
.mini-desc { font-size: 11px; color: var(--text-3); }
.svc-page { padding-bottom: 24px; }
.svc-hero {
  display: flex; background: linear-gradient(135deg, #3ecf6e, #07c160);
  margin: 0; padding: 28px 16px; gap: 24px;
}
.svc-hero-item {
  flex: 1; border: 0; background: transparent; color: #fff;
  display: flex; flex-direction: column; align-items: center; gap: 8px;
}
.svc-hero-ico {
  width: 48px; height: 48px; border-radius: 10px; background: rgba(255,255,255,0.2);
  display: flex; align-items: center; justify-content: center; font-size: 22px;
}
.svc-hero-label { font-size: 15px; font-weight: 500; }
.svc-hero-sub { font-size: 13px; opacity: 0.9; margin-top: -2px; }
.svc-card { background: var(--white); margin-top: 10px; padding: 4px 0 8px; }
.svc-card-title { padding: 12px 16px 4px; font-size: 14px; color: var(--text-2); }
.mini-page { padding-bottom: 24px; }
.mini-section-title { padding: 14px 16px 8px; font-size: 13px; color: var(--text-3); background: var(--bg); }
.sticker-detail { padding: 24px 16px; text-align: center; }
.sticker-preview {
  font-size: 72px; line-height: 1; margin: 12px auto 16px;
  width: 120px; height: 120px; border-radius: 24px; background: var(--white);
  display: flex; align-items: center; justify-content: center;
}
.sticker-name { font-size: 18px; font-weight: 600; color: var(--text); }
.sticker-desc { margin-top: 8px; font-size: 13px; color: var(--text-3); line-height: 1.5; }
.sticker-actions { display: flex; gap: 10px; margin: 20px 0 8px; justify-content: center; flex-wrap: wrap; }
.sticker-btn {
  min-height: 42px; padding: 0 18px; border-radius: 8px; border: 1px solid var(--divider);
  background: var(--white); color: var(--text); font-size: 14px;
}
.sticker-btn.primary { background: #07c160; border-color: #07c160; color: #fff; }
.sticker-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; padding: 8px 8px 20px; }
.sticker-cell {
  aspect-ratio: 1; border: 2px solid transparent; border-radius: 10px;
  background: var(--white); font-size: 24px; min-height: 44px;
}
.sticker-cell.on { border-color: #07c160; background: rgba(7,193,96,0.1); }

.svc-grid {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px 8px;
  padding: 20px 12px; background: var(--white); margin-top: 10px;
}
.svc-cell {
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  border: 0; background: transparent; font-size: 12px; color: var(--text); min-height: 64px;
}
.svc-icon {
  width: 44px; height: 44px; border-radius: 10px; background: var(--divider-soft);
  display: flex; align-items: center; justify-content: center; font-size: 20px;
}

.status-pick { display: flex; flex-wrap: wrap; gap: 8px; padding: 8px 14px 14px; }
.status-chip {
  border: 1px solid var(--divider); background: var(--white); color: var(--text);
  border-radius: 16px; min-height: 34px; padding: 0 12px; font-size: 13px;
}
.status-chip.on { border-color: #07c160; background: rgba(7,193,96,0.1); color: #07c160; }
.status-emoji { font-size: 24px; }

.group-avatars { display: grid; grid-template-columns: 1fr 1fr; gap: 2px; width: 44px; height: 44px; }
.g-av {
  background: var(--divider-soft); border-radius: 2px; font-size: 12px;
  display: flex; align-items: center; justify-content: center; overflow: hidden;
}

.card-detail { padding: 16px 12px; }
.card-face {
  border-radius: 12px; color: #fff; padding: 24px 18px; min-height: 140px;
  display: flex; flex-direction: column; justify-content: flex-end; gap: 4px;
}
.card-kind { font-size: 12px; opacity: 0.85; text-transform: uppercase; }
.card-title { font-size: 22px; font-weight: 600; }
.card-sub { font-size: 13px; opacity: 0.9; }
</style>
