<script setup>
import { ref, onMounted } from 'vue';
import { api } from '../api.js';
import { toast } from '../toast.js';
import UserAvatar from './UserAvatar.vue';

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
  servicesHome: '服务',
  statusHome: '状态',
  groupList: '群聊',
  cardDetail: '卡包详情',
  stickerSend: '', // handled in chat
};
const title = ref(titleMap[props.type] || '详情');

const lookItem = ref(props.payload.item || {
  title: 'AI 群友如何改变社交产品',
  sub: '科技早报 · 1.2万阅读',
  body: '当群聊里出现足够像真人的 AI 成员，社交产品的「在线感」会被重新定义。本文讨论人设一致性、消息节奏与媒体生成在即时通讯中的落地方式。',
});
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

async function load() {
  if (props.type === 'groupList') {
    try {
      const d = await api.chats();
      groups.value = (d.chats || []).filter((c) => c.type === 'group');
    } catch { groups.value = []; }
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
  if (s.key === 'wallet') emit('back', { then: 'wallet' });
  else if (s.key === 'mobile' || s.key === 'bills' || s.key === 'traffic') {
    toast(`${s.label}：请到「我 → 服务」演示支付`);
    emit('back', { then: 'services' });
  } else toast(`${s.label} · 演示入口`);
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
  emit('open-chat', {
    conversationId: g.conversationId || g.id,
    groupId: g.groupId ?? null,
    kind: g.kind || null,
    name: g.name,
    isDefault: g.isDefault !== false,
  });
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
          <button type="button" @click="toast('已标记在看')">👀 在看</button>
          <button type="button" @click="toast('已收藏')">⭐ 收藏</button>
          <button type="button" @click="toast('已分享到聊天')">↗ 分享</button>
        </div>
      </article>

      <!-- 视频号 -->
      <div v-else-if="type === 'videoChannels'" class="video-grid">
        <button v-for="v in videos" :key="v.id" class="video-card" type="button" @click="toast(`播放：${v.title}`)">
          <div class="video-cover">{{ v.cover }}</div>
          <div class="video-title">{{ v.title }}</div>
          <div class="video-meta">{{ v.author }} · ❤️ {{ v.likes }}</div>
        </button>
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
      <div v-else-if="type === 'miniappHome'" class="mini-grid">
        <button v-for="m in miniapps" :key="m.id" class="mini-cell" type="button" @click="toast(`打开小程序：${m.name}`)">
          <span class="mini-icon">{{ m.icon }}</span>
          <span class="mini-name">{{ m.name }}</span>
          <span class="mini-desc">{{ m.desc }}</span>
        </button>
      </div>

      <!-- 服务九宫格 -->
      <div v-else-if="type === 'servicesHome'" class="svc-grid">
        <button v-for="s in services" :key="s.key" class="svc-cell" type="button" @click="onService(s)">
          <span class="svc-icon">{{ s.icon }}</span>
          <span>{{ s.label }}</span>
        </button>
      </div>

      <!-- 状态主页 -->
      <div v-else-if="type === 'statusHome'">
        <section class="card">
          <div class="sec-title">我的状态</div>
          <div class="status-pick">
            <button v-for="s in ['😊 心情不错','😷 有点累','🎯 专注中','🍜 干饭中','🎮 开黑中']" :key="s"
              type="button" class="status-chip" :class="{ on: statusPick === s }" @click="setStatus(s)">{{ s }}</button>
          </div>
        </section>
        <section class="card">
          <div class="sec-title">好友状态</div>
          <div v-for="s in statuses" :key="s.id" class="row status-row">
            <span class="status-emoji">{{ s.emoji }}</span>
            <div class="person-main">
              <div class="person-name">{{ s.name }}</div>
              <div class="person-sign">{{ s.text }} · {{ s.time }}</div>
            </div>
          </div>
        </section>
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
  </div>
</template>

<style scoped>
.page { flex: 1; display: flex; flex-direction: column; min-height: 0; background: var(--bg); width: 100%; }
.nav-bar {
  height: var(--nav-h); flex-shrink: 0; display: flex; align-items: center; justify-content: center;
  position: relative; background: var(--bg); border-bottom: 0.5px solid var(--divider); padding: 0 8px;
}
.nav-back { position: absolute; left: 0; top: 0; bottom: 0; margin: auto 0; }
.nav-right { width: 44px; }
.nav-title { font-size: 17px; font-weight: 600; color: var(--text); }
.content { flex: 1; min-height: 0; padding-bottom: 24px; }
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

.mini-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; padding: 16px 12px; }
.mini-cell {
  display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 16px 8px;
  background: var(--white); border: 0; border-radius: 10px; min-height: 100px;
}
.mini-icon { font-size: 28px; }
.mini-name { font-size: 14px; color: var(--text); }
.mini-desc { font-size: 11px; color: var(--text-3); }

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
