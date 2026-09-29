<script setup>
// 叠塔对战：直接内嵌 games/tower_game 同款（client/public/tower-game），只做双人邀请与比分
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import {
  towerBattle,
  createRoom,
  joinByInvite,
  leaveRoom,
  rematch,
  sendInvite,
  syncNow,
  remainingMs,
  countdownRemainingMs,
  serverNow,
} from '../tower-battle-store.js';
import { titleFor } from '../tower-engine.js';
import GameInvitePicker from './GameInvitePicker.vue';
import UserAvatar from './UserAvatar.vue';

const props = defineProps({
  me: { type: Object, default: null },
  autoCreate: { type: Boolean, default: false },
  pendingInviteId: { type: String, default: '' },
});
const emit = defineEmits(['back', 'open-chat']);

const frameRef = ref(null);
const showPicker = ref(false);
const invitedMap = ref({});
const busy = ref(false);
const flashMsg = ref('');
const soundOn = ref(true);
const confirmLeave = ref(false);
const gameStarted = ref(false);

const state = towerBattle.state;
const phase = computed(() => state.phase || 'idle');
const room = computed(() => state.room);
const myPlayer = computed(() => towerBattle.myPlayer);
const ranking = computed(() => state.ranking || []);
const playerCount = computed(() => (room.value?.players || []).filter((p) => !p.retired).length);

const remainLabel = computed(() => {
  const s = Math.ceil(remainingMs() / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
});
const countdownLabel = computed(() => {
  const s = Math.ceil(countdownRemainingMs() / 1000);
  return s <= 0 ? '开叠！' : String(s);
});

const champion = computed(() => ranking.value[0] || null);

onMounted(async () => {
  try {
    soundOn.value = sessionStorage.getItem('hudui_tower_sound') !== '0';
  } catch { /* ignore */ }
  window.addEventListener('message', onFrameMessage);
  try {
    if (props.pendingInviteId) await joinViaInvite(props.pendingInviteId);
    else if (props.autoCreate && !state.room) await startCreate();
    else if (!state.room) await syncNow();
  } catch (e) {
    flashMsg.value = e?.message || '没连上服务器，再试一次。';
  }
});

onBeforeUnmount(() => {
  window.removeEventListener('message', onFrameMessage);
});

watch(
  () => props.pendingInviteId,
  (id, prev) => { if (id && id !== prev) joinViaInvite(id); }
);

// 进入比赛后通知 iframe 原版游戏开局
watch(phase, (p) => {
  if (p === 'playing' && !gameStarted.value) {
    gameStarted.value = true;
    nextTick(() => postToGame({ type: 'start' }));
  }
  if (p === 'countdown') {
    gameStarted.value = false;
  }
});

function postToGame(msg) {
  try {
    frameRef.value?.contentWindow?.postMessage({ source: 'tower-battle', ...msg }, '*');
  } catch { /* ignore */ }
}

function onFrameMessage(ev) {
  const msg = ev?.data || {};
  if (msg.source !== 'tower-practice') return;
  const d = msg.data || {};
  if (msg.type === 'score' || msg.type === 'gameover') {
    reportScore(d, msg.type === 'gameover');
    if (msg.type === 'gameover') {
      flashMsg.value = '本局叠完了，看看谁更高。';
      setTimeout(() => { if (flashMsg.value) flashMsg.value = ''; }, 1600);
    }
  } else if (msg.type === 'error') {
    flashMsg.value = d.message || '游戏加载失败';
  }
}

let lastReport = 0;
function reportScore(d, done = false) {
  const t = Date.now();
  if (!done && t - lastReport < 200) return;
  lastReport = t;
  reportScoreRemote(d, done);
}

async function reportScoreRemote(d, done = false) {
  try {
    const mod = await import('../tower-battle-store.js');
    await mod.reportGameScore?.({
      score: d.score || 0,
      layers: d.layers || 0,
      failed: d.failed || 0,
      done,
    });
  } catch { /* ignore */ }
}

async function joinViaInvite(inviteId) {
  if (!inviteId) return;
  busy.value = true;
  flashMsg.value = '正在给你留位置……';
  try {
    const res = await joinByInvite(inviteId);
    flashMsg.value = res?.ok
      ? (res.restored ? '回来啦，比赛还在继续。' : '来得正好，准备开叠。')
      : (res?.error || '这场已经散了，再约一局吧。');
  } catch (e) {
    flashMsg.value = e?.message || '加入失败了，再试一次。';
  } finally {
    busy.value = false;
    setTimeout(() => { if (flashMsg.value) flashMsg.value = ''; }, 1800);
  }
}

async function startCreate() {
  busy.value = true;
  try {
    const res = await createRoom();
    if (res?.ok || res?.exists) {
      flashMsg.value = '位置留好了，叫个朋友来吧。';
      showPicker.value = true;
      setTimeout(() => { if (flashMsg.value === '位置留好了，叫个朋友来吧。') flashMsg.value = ''; }, 1800);
    } else if (res?.error) {
      flashMsg.value = res.error;
    }
  } catch (e) {
    flashMsg.value = e?.message || '开房失败了，再试一次。';
  } finally {
    busy.value = false;
  }
}

async function onSendInvite({ conversationId }) {
  try {
    const res = await sendInvite(conversationId);
    if (res?.ok) {
      invitedMap.value = { ...invitedMap.value, [conversationId]: true };
      showPicker.value = false;
    }
  } catch { /* ignore */ }
}

function toggleSound() {
  soundOn.value = !soundOn.value;
  try { sessionStorage.setItem('hudui_tower_sound', soundOn.value ? '1' : '0'); } catch { /* ignore */ }
  postToGame({ type: 'sound', on: soundOn.value });
}

async function onLeave() {
  if (phase.value === 'playing' && !confirmLeave.value) {
    confirmLeave.value = true;
    setTimeout(() => { confirmLeave.value = false; }, 3000);
    return;
  }
  try { await leaveRoom({ silent: true }); } catch { /* ignore */ }
  emit('back');
}

async function onRematch() {
  busy.value = true;
  gameStarted.value = false;
  try {
    const res = await rematch();
    if (res?.ok) flashMsg.value = '再来一局，等朋友进来就开。';
  } catch { /* ignore */ }
  busy.value = false;
}

function myTitle(p) {
  return titleFor(p, ranking.value);
}
</script>

<template>
  <div class="tb-root">
    <header class="tb-top">
      <button type="button" class="tb-back" @click="onLeave">{{ confirmLeave ? '确认退出？' : '返回' }}</button>
      <div class="tb-timer">
        {{ phase === 'countdown' ? countdownLabel : remainLabel }}
      </div>
      <div class="tb-tools">
        <button type="button" class="tb-icon" @click="toggleSound">{{ soundOn ? '🔊' : '🔇' }}</button>
      </div>
    </header>

    <!-- 发起 -->
    <section v-if="phase === 'idle' && !busy" class="tb-entry">
      <div class="tb-hero">
        <h1>叠塔对战</h1>
        <p class="tb-hero-sub">双人实时 PK · 和练习同一款游戏</p>
        <button type="button" class="tb-primary lg" @click="startCreate">发起对战</button>
      </div>
    </section>

    <!-- 等朋友 -->
    <section v-else-if="phase === 'waiting' || phase === 'finished'" class="tb-room">
      <div class="tb-room-card">
        <template v-if="phase === 'finished'">
          <div class="tb-room-badge">结算</div>
          <h2 class="tb-room-title">这一局叠完了</h2>
          <p v-if="champion" class="tb-room-champ">🏆 本局最高 · {{ champion.nickname }}</p>
          <ol class="tb-rank-list">
            <li v-for="(p, i) in ranking" :key="p.userId" :class="{ me: p.isMe }">
              <span class="tb-rank-no" :class="{ top: i === 0 }">{{ i + 1 }}</span>
              <UserAvatar :name="p.nickname" :avatar="p.avatar" :color="p.avatarColor" :size="34" />
              <span class="tb-rank-name">
                {{ p.nickname }}
                <em v-if="myTitle(p)">{{ myTitle(p) }}</em>
              </span>
              <span class="tb-rank-score">
                <strong>{{ p.score }}</strong>
                <small>{{ p.layers }} 层</small>
              </span>
            </li>
          </ol>
          <div class="tb-actions col">
            <button type="button" class="tb-primary lg" :disabled="busy" @click="onRematch">准备下一局</button>
            <div class="tb-actions-row">
              <button type="button" class="tb-ghost" @click="showPicker = true">叫朋友来</button>
              <button type="button" class="tb-ghost" @click="onLeave">先休息一下</button>
            </div>
          </div>
        </template>
        <template v-else>
          <div class="tb-room-badge">双人对战</div>
          <h2 class="tb-room-title">等朋友点邀请卡进来</h2>
          <p class="tb-room-meta">对方加入后自动开始 · 90 秒一局</p>
          <div class="tb-vs">
            <div class="tb-vs-side">
              <UserAvatar
                :name="myPlayer?.nickname || '我'"
                :avatar="myPlayer?.avatar"
                :color="myPlayer?.avatarColor"
                :size="64"
              />
              <div class="tb-vs-name">{{ myPlayer?.nickname || '我' }}</div>
            </div>
            <div class="tb-vs-mid">VS</div>
            <div class="tb-vs-side">
              <div class="tb-vs-empty">+</div>
              <div class="tb-vs-name dim">等朋友</div>
            </div>
          </div>
          <div class="tb-actions col">
            <button type="button" class="tb-primary lg" @click="showPicker = true">叫朋友来</button>
            <button type="button" class="tb-ghost" @click="onLeave">先不玩了</button>
          </div>
        </template>
      </div>
    </section>

    <!-- 比赛：原版叠塔练习 -->
    <section v-else class="tb-play">
      <div v-if="flashMsg" class="tb-flash">{{ flashMsg }}</div>
      <div v-if="phase === 'countdown'" class="tb-countdown">
        <div class="tb-count-num">{{ countdownLabel }}</div>
        <div class="tb-count-tip">稳住。</div>
      </div>
      <iframe
        ref="frameRef"
        class="tb-frame"
        src="/tower-game/embed.html"
        title="叠塔对战"
        allow="autoplay; fullscreen"
      />
      <div class="tb-opp">
        <div v-for="p in ranking.filter((x) => !x.isMe).slice(0, 1)" :key="p.userId" class="tb-opp-card">
          <UserAvatar :name="p.nickname" :avatar="p.avatar" :color="p.avatarColor" :size="28" />
          <div>
            <div class="tb-opp-name">{{ p.nickname }}</div>
            <div class="tb-opp-score">{{ p.score }} 分 · {{ p.layers }} 层</div>
          </div>
        </div>
      </div>
    </section>

    <GameInvitePicker
      v-if="showPicker"
      :invited="invitedMap"
      @close="showPicker = false"
      @send="onSendInvite"
    />
  </div>
</template>

<style scoped>
.tb-root {
  flex: 1;
  width: 100%;
  height: 100%;
  min-height: 100%;
  display: flex;
  flex-direction: column;
  background: #f95240 url('/tower/main-bg.png') center/cover;
  color: #fff;
  overflow: hidden;
}
.tb-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  gap: 8px;
  z-index: 2;
}
.tb-back {
  border: 0;
  background: rgba(255, 255, 255, 0.18);
  color: #fff;
  border-radius: 999px;
  padding: 8px 12px;
  font-size: 13px;
  cursor: pointer;
}
.tb-timer {
  font-size: 18px;
  font-weight: 800;
  min-width: 72px;
  text-align: center;
}
.tb-icon {
  border: 0;
  background: rgba(255, 255, 255, 0.18);
  color: #fff;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  cursor: pointer;
}
.tb-entry {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.tb-hero {
  text-align: center;
  padding: 32px 24px;
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.18);
}
.tb-hero h1 { margin: 0 0 8px; font-size: 30px; font-weight: 800; }
.tb-hero-sub { margin: 0 0 22px; opacity: 0.85; font-size: 14px; }
.tb-primary {
  border: 0;
  background: linear-gradient(180deg, #fff, #ffe08a);
  color: #c2410c;
  font-weight: 700;
  font-size: 15px;
  border-radius: 999px;
  padding: 12px 28px;
  cursor: pointer;
  min-height: 44px;
}
.tb-primary.lg { width: 100%; min-height: 50px; font-size: 16px; }
.tb-primary:disabled { opacity: 0.5; }
.tb-ghost {
  border: 1px solid rgba(255, 255, 255, 0.28);
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
  border-radius: 999px;
  padding: 10px 18px;
  cursor: pointer;
  min-height: 42px;
  font-size: 13px;
  font-weight: 600;
  flex: 1;
}
.tb-room {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px 16px 20px;
  overflow: auto;
}
.tb-room-card {
  width: min(420px, 100%);
  border-radius: 22px;
  padding: 22px 18px;
  background: rgba(255, 255, 255, 0.13);
  border: 1px solid rgba(255, 255, 255, 0.18);
}
.tb-room-badge {
  display: inline-flex;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.18);
  font-size: 11px;
  font-weight: 700;
}
.tb-room-title {
  margin: 10px 0 4px;
  font-size: 20px;
  font-weight: 800;
}
.tb-room-meta { margin: 0 0 12px; font-size: 13px; opacity: 0.78; }
.tb-room-champ { margin: 6px 0 12px; color: #ffe8a0; font-weight: 600; }
.tb-vs {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 20px;
  margin: 22px 0 26px;
}
.tb-vs-side {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  min-width: 88px;
}
.tb-vs-mid { font-size: 16px; font-weight: 800; opacity: 0.7; }
.tb-vs-name { font-size: 13px; font-weight: 600; }
.tb-vs-name.dim { opacity: 0.55; }
.tb-vs-empty {
  width: 64px;
  height: 64px;
  border-radius: 20px;
  border: 1.5px dashed rgba(255, 255, 255, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  opacity: 0.55;
}
.tb-actions.col { display: flex; flex-direction: column; gap: 10px; }
.tb-actions-row { display: flex; gap: 10px; }
.tb-rank-list {
  list-style: none;
  margin: 0 0 14px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.tb-rank-list li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.1);
}
.tb-rank-no { width: 20px; font-weight: 800; }
.tb-rank-no.top { color: #fbbf24; }
.tb-rank-name { flex: 1; font-size: 14px; font-weight: 600; }
.tb-rank-name em {
  font-style: normal;
  font-size: 10px;
  margin-left: 6px;
  background: #fde68a;
  color: #7c2d12;
  padding: 1px 6px;
  border-radius: 999px;
}
.tb-rank-score { text-align: right; }
.tb-rank-score strong { display: block; font-size: 15px; }
.tb-rank-score small { opacity: 0.75; font-size: 11px; }

.tb-play {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.tb-frame {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: 0;
  background: #f95240;
}
.tb-flash {
  position: absolute;
  left: 50%;
  top: 16px;
  transform: translateX(-50%);
  z-index: 5;
  background: rgba(0, 0, 0, 0.4);
  color: #fff;
  padding: 8px 14px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 700;
  pointer-events: none;
}
.tb-countdown {
  position: absolute;
  inset: 0;
  z-index: 6;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.35);
  pointer-events: none;
}
.tb-count-num {
  font-size: 72px;
  font-weight: 800;
  text-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
}
.tb-opp {
  position: absolute;
  right: 10px;
  top: 10px;
  z-index: 4;
}
.tb-opp-card {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(0, 0, 0, 0.28);
  border-radius: 12px;
  padding: 6px 10px;
}
.tb-opp-name { font-size: 12px; font-weight: 700; }
.tb-opp-score { font-size: 11px; opacity: 0.85; }
</style>
