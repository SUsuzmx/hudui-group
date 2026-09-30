<script setup>
// 猜歌抢答主界面 —— 音乐综艺舞台风
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import {
  guessSong,
  createRoom,
  joinByInvite,
  leaveRoom,
  setReady,
  setSongCount,
  setTheme,
  startMatch,
  rematch,
  buzz,
  answer,
  answerArtist,
  sendInvite,
  syncNow,
  unlockBuzz,
} from '../guess-song-store.js';
import GameInvitePicker from './GameInvitePicker.vue';
import UserAvatar from './UserAvatar.vue';

const props = defineProps({
  me: { type: Object, default: null },
  autoCreate: { type: Boolean, default: false },
  pendingInviteId: { type: String, default: '' },
});
const emit = defineEmits(['back', 'open-chat']);

const THEMES = [
  { key: 'random', label: '曲库小王子', desc: '随机热歌', emoji: '🎲' },
  { key: 'artist:周杰伦', label: '周杰伦', desc: '杰迷专场', emoji: '🎤' },
  { key: 'artist:林俊杰', label: '林俊杰', desc: '行走的CD', emoji: '🎧' },
  { key: 'artist:陈奕迅', label: '陈奕迅', desc: 'Eason 金曲', emoji: '🎸' },
  { key: 'artist:邓紫棋', label: '邓紫棋', desc: '高音炸场', emoji: '✨' },
  { key: 'artist:薛之谦', label: '薛之谦', desc: '段子手情歌', emoji: '🌙' },
  { key: 'artist:五月天', label: '五月天', desc: '青春摇滚', emoji: '🔥' },
  { key: 'artist:孙燕姿', label: '孙燕姿', desc: '天后精选', emoji: '🌈' },
];

const showPicker = ref(false);
const invitedMap = ref({});
const busy = ref(false);
const flashMsg = ref('');
const confirmLeave = ref(false);
const answerBusy = ref(false);
const buzzBusy = ref(false);
const songCount = ref(10);
const themeKey = ref('random');
const nowTick = ref(Date.now());

let tickTimer = 0;

const state = guessSong.state;
const room = computed(() => state.room);
const phase = computed(() => state.phase || 'idle');
const isHost = computed(() => guessSong.isHost);
const myPlayer = computed(() => guessSong.myPlayer);
const ranking = computed(() => state.ranking || []);
const players = computed(() => room.value?.players || []);
const onlineCount = computed(() => players.value.filter((p) => p.online !== false).length);
const round = computed(() => state.round);
const options = computed(() => state.options);
const artistOptions = computed(() => state.artistOptions);
const canBuzz = computed(() => guessSong.canBuzz);

const themeLabel = computed(() => room.value?.themeLabel || '曲库小王子');
const themeDesc = computed(() => {
  const t = THEMES.find((x) => x.key === (room.value?.theme || themeKey.value));
  return t?.desc || '随机热歌';
});

const phaseLabel = computed(() => {
  const p = round.value?.phase;
  if (phase.value === 'waiting') return '等待开场';
  if (phase.value === 'finished') return '本局结束';
  if (p === 'loading') return '加载片段…';
  if (p === 'prep') return '准备';
  if (p === 'playing') return '听歌抢答';
  if (p === 'answering') return state.buzzedName ? `${state.buzzedName} 作答中` : '有人作答中';
  if (p === 'main_reveal') return '公布答案';
  if (p === 'artist') return '歌手抢分';
  if (p === 'round_end') return '下一首';
  return '猜歌抢答';
});

const hintTexts = computed(() => {
  const level = Number(round.value?.hintLevel) || 0;
  const hints = [];
  if (level >= 1) hints.push('注意旋律走向，副歌很抓耳');
  if (level >= 2) hints.push('歌名大约 2–5 个字');
  if (level >= 3) hints.push('前奏一响就知道是谁的歌');
  return hints;
});

function remaining(deadline) {
  if (!deadline) return 0;
  return Math.max(0, deadline - nowTick.value);
}
function remainLabel(deadline) {
  return (remaining(deadline) / 1000).toFixed(1);
}
const answerRemain = computed(() => remainLabel(state.answerDeadline));
const artistRemain = computed(() => remainLabel(state.artistDeadline));

/** 领奖台：1 中间最高，2 左，3 右 */
const podiumOrder = computed(() => {
  const list = ranking.value || [];
  return [
    { no: 2, player: list.find((r) => r.rank === 2) || null },
    { no: 1, player: list.find((r) => r.rank === 1) || null },
    { no: 3, player: list.find((r) => r.rank === 3) || null },
  ];
});

function scoreBarWidth(score) {
  const max = Math.max(...(ranking.value || []).map((r) => Number(r.score) || 0), 1);
  return Math.max(8, Math.round(((Number(score) || 0) / max) * 100));
}

function flash(msg) {
  flashMsg.value = msg;
  setTimeout(() => {
    if (flashMsg.value === msg) flashMsg.value = '';
  }, 2200);
}

async function joinViaInvite(inviteId) {
  if (!inviteId) return;
  busy.value = true;
  flashMsg.value = '正在给你留位置……';
  const res = await joinByInvite(inviteId);
  busy.value = false;
  flashMsg.value = res?.ok
    ? res.restored
      ? '回来啦，比赛还在继续。'
      : '来得正好，准备开猜。'
    : res?.error || '这场已经散了，再约一局吧。';
  setTimeout(() => {
    if (flashMsg.value) flashMsg.value = '';
  }, 1800);
}

async function startCreate() {
  if (busy.value) return;
  busy.value = true;
  try {
    const th = THEMES.find((x) => x.key === themeKey.value) || THEMES[0];
    const res = await createRoom({
      songCount: songCount.value,
      theme: th.key,
      themeLabel: th.key === 'random' ? th.label : th.label,
    });
    if (res?.ok || res?.exists) {
      flash('房间开好了，叫上朋友吧');
      showPicker.value = true;
    } else {
      flash(res?.error || '开房失败，再点一次试试');
    }
  } catch (e) {
    flash(e?.message || '开房失败，再点一次试试');
  } finally {
    busy.value = false;
  }
}

async function onReady() {
  try {
    await setReady(!myPlayer.value?.ready);
  } catch {
    /* ignore */
  }
}

async function onChangeSongCount(n) {
  songCount.value = n;
  if (isHost.value) {
    try {
      await setSongCount(n);
    } catch {
      /* ignore */
    }
  }
}

async function onChangeTheme(key) {
  themeKey.value = key;
  if (!isHost.value) return;
  const th = THEMES.find((x) => x.key === key) || THEMES[0];
  try {
    await setTheme(th.key, th.key === 'random' ? '曲库小王子' : th.label);
  } catch {
    /* ignore */
  }
}

async function onStart() {
  busy.value = true;
  try {
    const th = THEMES.find((x) => x.key === (room.value?.theme || themeKey.value)) || THEMES[0];
    const res = await startMatch({
      songCount: songCount.value,
      theme: th.key,
      themeLabel: th.key === 'random' ? '曲库小王子' : th.label,
    });
    if (!res?.ok && res?.error) flash(res.error);
  } catch (e) {
    flash(e?.message || '开始失败');
  } finally {
    busy.value = false;
  }
}

async function onRematch() {
  busy.value = true;
  try {
    await rematch();
    flash('新一局，歌曲重新抽');
  } catch {
    flash('再来一局失败');
  } finally {
    busy.value = false;
  }
}

async function onBuzz() {
  if (buzzBusy.value || !canBuzz.value) return;
  buzzBusy.value = true;
  try {
    const res = await buzz();
    if (res?.ok) flash('抢到！快选');
    else if (res?.error && res.code !== 'already_buzzed') flash(res.error);
  } finally {
    unlockBuzz();
    setTimeout(() => {
      buzzBusy.value = false;
    }, 350);
  }
}

async function onAnswer(opt) {
  if (answerBusy.value || !opt?.optionId) return;
  answerBusy.value = true;
  try {
    const res = await answer(opt.optionId);
    if (res?.correct) flash(`答对了！+${res.delta}`);
    else if (res?.ok) flash(`答错了 ${res.delta}`);
    else flash(res?.error || '没选上');
  } finally {
    answerBusy.value = false;
  }
}

async function onArtist(opt) {
  if (answerBusy.value || !opt?.optionId) return;
  answerBusy.value = true;
  try {
    const res = await answerArtist(opt.optionId);
    if (res?.correct) flash(`歌手对啦 +${res.delta}`);
    else if (res?.ok) flash(`差一点 ${res.delta}`);
  } finally {
    answerBusy.value = false;
  }
}

async function onSendInvite({ conversationId }) {
  if (!conversationId) return;
  if (invitedMap.value[conversationId]) {
    flash('已经叫过他们啦。');
    return;
  }
  busy.value = true;
  try {
    const res = await sendInvite(conversationId);
    if (res?.ok) {
      invitedMap.value = { ...invitedMap.value, [conversationId]: true };
      flash(res.duplicated ? '这个会话已经发过邀请了' : '邀请卡已发出');
      if (!res.duplicated) showPicker.value = false;
    } else {
      flash(res?.error || '发送失败');
    }
  } finally {
    busy.value = false;
  }
}

async function onLeave() {
  try {
    await leaveRoom();
  } catch {
    /* ignore */
  }
  emit('back');
}

onMounted(async () => {
  tickTimer = setInterval(() => {
    nowTick.value = Date.now();
  }, 100);
  try {
    if (props.pendingInviteId) await joinViaInvite(props.pendingInviteId);
    else if (props.autoCreate && !state.room) await startCreate();
    else if (!state.room) await syncNow();
    if (room.value?.theme) themeKey.value = room.value.theme;
    if (room.value?.songCount) songCount.value = room.value.songCount;
  } catch (e) {
    flash(e?.message || '进入失败，请重试');
    busy.value = false;
  }
});

watch(
  () => props.pendingInviteId,
  (id, prev) => {
    if (id && id !== prev) void joinViaInvite(id).catch(() => {});
  }
);

onBeforeUnmount(() => {
  if (tickTimer) clearInterval(tickTimer);
});
</script>

<template>
  <div class="gs-page">
    <!-- 顶部 -->
    <header class="gs-top">
      <button type="button" class="gs-icon-btn" aria-label="返回" @click="confirmLeave = true">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M15 6l-6 6 6 6" /></svg>
      </button>
      <div class="gs-brand">
        <span class="gs-brand-name">猜歌抢答</span>
        <span v-if="room" class="gs-brand-sub">{{ themeLabel }} · {{ themeDesc }}</span>
      </div>
      <button v-if="phase === 'waiting' || phase === 'finished'" type="button" class="gs-pill" @click="showPicker = true">邀请</button>
      <div v-else class="gs-round-chip">
        {{ round ? `${(round.index ?? 0) + 1}/${round.total || room?.songCount || 10}` : '' }}
      </div>
    </header>

    <div v-if="flashMsg || state.flash" class="gs-toast">{{ flashMsg || state.flash }}</div>

    <!-- ========== 等待厅 / 落地页 ========== -->
    <section v-if="!room || phase === 'waiting'" class="gs-wait">
      <div class="gs-hero">
        <div class="gs-disc" aria-hidden="true">
          <div class="gs-disc-ring" />
          <div class="gs-disc-hole" />
          <div class="gs-eq"><i /><i /><i /><i /><i /></div>
        </div>
        <h1 class="gs-title">谁是中华小曲库</h1>
        <p class="gs-lead">听片段 · 抢答歌名 · 再抢歌手分</p>
      </div>

      <!-- 未建房：先选曲库 -->
      <div v-if="!room" class="gs-panel">
        <div class="gs-panel-label">选曲库</div>
        <div class="gs-themes">
          <button
            v-for="t in THEMES"
            :key="t.key"
            type="button"
            class="gs-theme"
            :class="{ on: themeKey === t.key }"
            @click="themeKey = t.key"
          >
            <span class="gs-theme-emoji">{{ t.emoji }}</span>
            <span class="gs-theme-name">{{ t.label }}</span>
            <span class="gs-theme-desc">{{ t.desc }}</span>
          </button>
        </div>
        <div class="gs-panel-label">歌曲数量</div>
        <div class="gs-seg">
          <button
            v-for="n in [5, 10, 15]"
            :key="n"
            type="button"
            class="gs-seg-btn"
            :class="{ on: songCount === n }"
            @click="songCount = n"
          >
            {{ n }} 首
          </button>
        </div>
        <button type="button" class="gs-cta" :disabled="busy" @click="startCreate">
          <span class="gs-cta-icon">⚡</span>
          {{ busy ? '正在进入…' : '发起对战' }}
        </button>
        <p class="gs-fine">2–8 人 · 不用房间码 · 发邀请卡就能玩</p>
      </div>

      <!-- 已建房 -->
      <template v-else>
        <div class="gs-panel">
          <div class="gs-panel-row">
            <div>
              <div class="gs-panel-label">本局曲库</div>
              <div class="gs-theme-now">
                <span class="gs-theme-emoji">{{ THEMES.find((x) => x.key === (room.theme || 'random'))?.emoji || '🎲' }}</span>
                {{ themeLabel }}
              </div>
            </div>
            <div class="gs-count-now">{{ room.songCount || songCount }} 首</div>
          </div>

          <div v-if="isHost" class="gs-themes compact">
            <button
              v-for="t in THEMES"
              :key="t.key"
              type="button"
              class="gs-theme sm"
              :class="{ on: (room.theme || 'random') === t.key }"
              @click="onChangeTheme(t.key)"
            >
              <span class="gs-theme-emoji">{{ t.emoji }}</span>
              <span class="gs-theme-name">{{ t.label }}</span>
            </button>
          </div>
          <div class="gs-seg">
            <button
              v-for="n in [5, 10, 15]"
              :key="n"
              type="button"
              class="gs-seg-btn"
              :class="{ on: (room.songCount || songCount) === n }"
              :disabled="!isHost"
              @click="onChangeSongCount(n)"
            >
              {{ n }} 首
            </button>
          </div>

          <div class="gs-panel-label">玩家 {{ players.length }}/8</div>
          <div class="gs-players">
            <div
              v-for="p in players"
              :key="p.userId"
              class="gs-player"
              :class="{ me: p.isMe, offline: p.online === false }"
            >
              <UserAvatar :name="p.nickname" :avatar="p.avatar" :color="p.avatarColor" :size="44" />
              <div class="gs-player-meta">
                <div class="gs-player-name">
                  {{ p.nickname }}
                  <span v-if="p.isHost" class="gs-tag host">房主</span>
                  <span v-if="p.isMe" class="gs-tag me">我</span>
                </div>
                <div class="gs-player-ready">
                  <i class="dot" :class="{ ok: p.ready }" />
                  {{ p.ready ? '已准备' : p.online === false ? '离线' : '未准备' }}
                </div>
              </div>
              <div class="gs-player-score">{{ p.score || 0 }}</div>
            </div>
          </div>

          <button type="button" class="gs-cta ghost" :class="{ on: myPlayer?.ready }" @click="onReady">
            {{ myPlayer?.ready ? '已准备 · 点击取消' : '我准备好了' }}
          </button>
          <button
            v-if="isHost"
            type="button"
            class="gs-cta"
            :disabled="busy || onlineCount < 2"
            @click="onStart"
          >
            {{ onlineCount < 2 ? '再来一位就开场' : '开始比赛' }}
          </button>
          <p class="gs-fine">
            <template v-if="onlineCount < 2">邀请好友来抢答</template>
            <template v-else-if="!players.every((p) => p.ready || p.online === false)">等大家准备好</template>
            <template v-else>人齐了，随时开场</template>
          </p>
          <button type="button" class="gs-link" @click="showPicker = true">邀请好友 / 群聊</button>
        </div>
      </template>
    </section>

    <!-- ========== 对局中 ========== -->
    <section v-else-if="phase === 'playing'" class="gs-play">
      <div class="gs-stage">
        <div class="gs-stage-glow" />
        <div class="gs-stage-status">
          <span class="gs-phase-tag">{{ phaseLabel }}</span>
          <span v-if="round?.phase === 'answering'" class="gs-timer">{{ answerRemain }}s</span>
          <span v-else-if="round?.phase === 'artist'" class="gs-timer">{{ artistRemain }}s</span>
        </div>

        <!-- 均衡器动画 -->
        <div class="gs-wave" :class="{ active: state.audioStarted && round?.phase === 'playing' }" aria-hidden="true">
          <i v-for="n in 18" :key="n" />
        </div>

        <div v-if="hintTexts.length && round?.phase === 'playing'" class="gs-hints">
          <div v-for="(h, i) in hintTexts" :key="i" class="gs-hint">{{ h }}</div>
        </div>

        <!-- 揭晓答案 -->
        <div v-if="round?.revealed || state.lastResult" class="gs-reveal">
          <img
            v-if="round?.answerCover || state.lastResult?.cover"
            class="gs-cover"
            :src="round?.answerCover || state.lastResult?.cover"
            alt=""
          />
          <div v-else class="gs-cover placeholder">♪</div>
          <div class="gs-reveal-text">
            <div class="gs-reveal-kicker">正确答案</div>
            <div class="gs-reveal-title">{{ round?.answerTitle || state.lastResult?.correctTitle || '…' }}</div>
            <div class="gs-reveal-artist">{{ round?.answerArtist || state.lastResult?.correctArtist || '' }}</div>
            <div v-if="state.lastResult?.winnerName" class="gs-reveal-winner">
              🏆 {{ state.lastResult.winnerName }} 抢答成功
            </div>
            <div v-else-if="String(room?.theme || '').startsWith('artist:')" class="gs-reveal-winner">
              {{ themeLabel }} 专场 · 不设歌手抢分
            </div>
          </div>
        </div>
      </div>

      <!-- 作答选项 -->
      <div v-if="options && options.length" class="gs-options">
        <div class="gs-q">这首歌叫什么？</div>
        <button
          v-for="o in options"
          :key="o.optionId"
          type="button"
          class="gs-opt"
          :disabled="answerBusy"
          @click="onAnswer(o)"
        >
          {{ o.title }}
        </button>
      </div>

      <div
        v-else-if="round?.phase === 'answering' && state.buzzedUserId && state.buzzedUserId !== myPlayer?.userId"
        class="gs-waiting"
      >
        <div class="gs-pulse" />
        <p class="gs-waiting-name">{{ state.buzzedName || '有人' }} 正在作答</p>
        <p class="gs-waiting-sub">{{ answerRemain }} 秒内选出歌名</p>
      </div>

      <div v-if="artistOptions && artistOptions.length && round?.phase === 'artist'" class="gs-options">
        <div class="gs-q">歌手是谁？抢分！</div>
        <button
          v-for="o in artistOptions"
          :key="o.optionId"
          type="button"
          class="gs-opt artist"
          :disabled="answerBusy"
          @click="onArtist(o)"
        >
          {{ o.label || o.title }}
        </button>
      </div>

      <!-- 抢答 -->
      <div class="gs-buzz-wrap">
        <button
          type="button"
          class="gs-buzz"
          :class="{ ready: canBuzz, locked: !canBuzz }"
          :disabled="!canBuzz || buzzBusy"
          @click="onBuzz"
        >
          <span class="gs-buzz-ring" />
          <span class="gs-buzz-label">我知道</span>
          <span class="gs-buzz-sub">
            {{
              !state.audioStarted
                ? '音频未就绪'
                : round?.phase !== 'playing'
                  ? phaseLabel
                  : buzzBusy
                    ? '发送中…'
                    : '抢先答对拿主分'
            }}
          </span>
        </button>
      </div>

      <div class="gs-scores">
        <div
          v-for="p in players"
          :key="p.userId"
          class="gs-chip"
          :class="{ me: p.isMe, wrong: p.mainWrong }"
        >
          <UserAvatar :name="p.nickname" :avatar="p.avatar" :color="p.avatarColor" :size="28" />
          <span class="gs-chip-name">{{ p.nickname.slice(0, 4) }}</span>
          <span class="gs-chip-num">{{ p.score }}</span>
        </div>
      </div>
    </section>

    <!-- ========== 结算 ========== -->
    <section v-else-if="phase === 'finished'" class="gs-finish">
      <div class="gs-finish-glow" aria-hidden="true" />
      <p class="gs-finish-kicker">MATCH OVER</p>
      <h2 class="gs-finish-title">本局名次</h2>
      <p class="gs-finish-sub">{{ themeLabel }} · 共 {{ room?.songCount || 10 }} 首</p>

      <!-- 前三领奖台 -->
      <div v-if="ranking.length" class="gs-podium">
        <div
          v-for="slot in podiumOrder"
          :key="slot.no"
          class="gs-podium-slot"
          :class="'p' + slot.no"
        >
          <template v-if="slot.player">
            <UserAvatar
              :name="slot.player.nickname"
              :avatar="slot.player.avatar"
              :color="slot.player.avatarColor"
              :size="slot.no === 1 ? 56 : 44"
            />
            <div class="gs-podium-name">{{ slot.player.nickname }}</div>
            <div class="gs-podium-score">{{ slot.player.score }} 分</div>
            <div class="gs-podium-bar">
              <span class="gs-podium-rank">{{ slot.no }}</span>
            </div>
          </template>
        </div>
      </div>

      <!-- 完整名次 -->
      <div class="gs-rank-card">
        <div
          v-for="r in ranking"
          :key="r.userId"
          class="gs-rank-row"
          :class="{ me: r.userId === myPlayer?.userId, top: r.rank === 1 }"
        >
          <span class="gs-rank-no" :class="{ gold: r.rank === 1, silver: r.rank === 2, bronze: r.rank === 3 }">
            {{ r.rank }}
          </span>
          <UserAvatar :name="r.nickname" :avatar="r.avatar" :color="r.avatarColor" :size="36" />
          <div class="gs-rank-meta">
            <div class="gs-rank-name">
              {{ r.nickname }}
              <span v-if="r.userId === myPlayer?.userId" class="gs-tag me">我</span>
            </div>
            <div class="gs-rank-bar">
              <i :style="{ width: scoreBarWidth(r.score) + '%' }" />
            </div>
          </div>
          <div class="gs-rank-score">{{ r.score }}</div>
        </div>
      </div>

      <div class="gs-finish-actions">
        <button type="button" class="gs-cta" :disabled="busy" @click="onRematch">
          {{ busy ? '准备中…' : '再来一局' }}
        </button>
        <button type="button" class="gs-cta ghost" @click="showPicker = true">邀请朋友</button>
        <button type="button" class="gs-link" @click="confirmLeave = true">离开房间</button>
      </div>
    </section>

    <section v-else class="gs-loading">
      <div class="gs-spinner" />
      <p>正在进入…</p>
    </section>

    <!-- 离开确认 -->
    <div v-if="confirmLeave" class="gs-mask" @click.self="confirmLeave = false">
      <div class="gs-dialog">
        <p>确定离开这场猜歌吗？</p>
        <div class="gs-dialog-actions">
          <button type="button" class="gs-cta ghost" @click="confirmLeave = false">再想想</button>
          <button type="button" class="gs-cta" @click="onLeave">离开</button>
        </div>
      </div>
    </div>

    <GameInvitePicker
      v-if="showPicker"
      :invited="invitedMap"
      :sending="busy"
      @close="showPicker = false"
      @send="onSendInvite"
    />
  </div>
</template>

<style scoped>
.gs-page {
  min-height: 0;
  flex: 1;
  color: #f7f2ff;
  background:
    radial-gradient(1200px 600px at 80% -10%, rgba(255, 92, 120, 0.22), transparent 55%),
    radial-gradient(900px 500px at 10% 20%, rgba(120, 80, 255, 0.22), transparent 50%),
    linear-gradient(165deg, #12081f 0%, #1a0f2e 45%, #0d0718 100%);
  padding-bottom: calc(32px + var(--safe-b, 0px));
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

/* ---- top ---- */
.gs-top {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: calc(12px + var(--safe-t, 0px)) 14px 8px;
}
.gs-icon-btn {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.06);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.gs-brand {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.gs-brand-name {
  font-size: 17px;
  font-weight: 700;
  letter-spacing: 0.02em;
}
.gs-brand-sub {
  font-size: 11px;
  opacity: 0.7;
}
.gs-pill {
  height: 34px;
  padding: 0 14px;
  border-radius: 999px;
  border: 0;
  background: linear-gradient(135deg, #ff6b6b, #ff8e53);
  color: #fff;
  font-weight: 600;
  font-size: 13px;
}
.gs-round-chip {
  height: 32px;
  padding: 0 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.1);
  display: flex;
  align-items: center;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}

.gs-toast {
  margin: 8px 16px 0;
  padding: 10px 14px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 13px;
  text-align: center;
}

/* ---- hero ---- */
.gs-hero {
  padding: 22px 20px 8px;
  text-align: center;
}
.gs-disc {
  width: 112px;
  height: 112px;
  margin: 0 auto 14px;
  border-radius: 50%;
  background:
    radial-gradient(circle at 50% 50%, #2a1848 0 28%, transparent 29%),
    conic-gradient(from 210deg, #ff6b6b, #c084fc, #60a5fa, #f472b6, #ff6b6b);
  position: relative;
  box-shadow: 0 18px 40px rgba(255, 100, 120, 0.25);
}
.gs-disc-ring {
  position: absolute;
  inset: 10px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.18);
}
.gs-disc-hole {
  position: absolute;
  inset: 42%;
  border-radius: 50%;
  background: #1a0f2e;
  border: 2px solid rgba(255, 255, 255, 0.2);
}
.gs-eq {
  position: absolute;
  left: 50%;
  bottom: 22px;
  transform: translateX(-50%);
  display: flex;
  gap: 3px;
  align-items: flex-end;
  height: 22px;
}
.gs-eq i {
  width: 3px;
  border-radius: 2px;
  background: #fff;
  animation: gs-eq 1s ease-in-out infinite;
}
.gs-eq i:nth-child(1) { height: 8px; animation-delay: 0s; }
.gs-eq i:nth-child(2) { height: 16px; animation-delay: 0.15s; }
.gs-eq i:nth-child(3) { height: 12px; animation-delay: 0.3s; }
.gs-eq i:nth-child(4) { height: 18px; animation-delay: 0.1s; }
.gs-eq i:nth-child(5) { height: 10px; animation-delay: 0.25s; }
@keyframes gs-eq {
  0%, 100% { transform: scaleY(0.6); }
  50% { transform: scaleY(1.15); }
}

.gs-title {
  margin: 0 0 6px;
  font-size: 28px;
  font-weight: 800;
  letter-spacing: 0.04em;
  background: linear-gradient(90deg, #ffe29a, #ff8fab, #c4b5fd);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.gs-lead {
  margin: 0;
  opacity: 0.78;
  font-size: 13px;
}

/* ---- panel ---- */
.gs-panel {
  margin: 14px 14px 0;
  padding: 16px;
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(16px);
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.gs-panel-label {
  font-size: 12px;
  opacity: 0.65;
  letter-spacing: 0.08em;
}
.gs-panel-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.gs-theme-now {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 18px;
  font-weight: 700;
}
.gs-count-now {
  font-size: 15px;
  opacity: 0.85;
  padding: 6px 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
}

.gs-themes {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}
.gs-themes.compact {
  grid-template-columns: repeat(4, 1fr);
}
.gs-theme {
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.05);
  border-radius: 14px;
  padding: 10px 8px;
  color: #fff;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  min-height: 72px;
}
.gs-theme.sm {
  min-height: 52px;
  padding: 8px 4px;
}
.gs-theme.on {
  background: linear-gradient(145deg, rgba(255, 107, 107, 0.35), rgba(192, 132, 252, 0.3));
  border-color: rgba(255, 160, 180, 0.55);
  box-shadow: 0 8px 22px rgba(255, 100, 130, 0.2);
}
.gs-theme-emoji {
  font-size: 20px;
  line-height: 1;
}
.gs-theme.sm .gs-theme-emoji {
  font-size: 16px;
}
.gs-theme-name {
  font-size: 13px;
  font-weight: 600;
}
.gs-theme-desc {
  font-size: 10px;
  opacity: 0.65;
}
.gs-theme.sm .gs-theme-desc {
  display: none;
}

.gs-seg {
  display: flex;
  gap: 8px;
}
.gs-seg-btn {
  flex: 1;
  min-height: 42px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.05);
  color: #fff;
  font-size: 14px;
  font-weight: 600;
}
.gs-seg-btn.on {
  background: linear-gradient(135deg, rgba(255, 107, 107, 0.4), rgba(255, 142, 83, 0.35));
  border-color: rgba(255, 160, 140, 0.55);
}
.gs-seg-btn:disabled {
  opacity: 0.55;
}

.gs-players {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 260px;
  overflow: auto;
}
.gs-player {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.05);
}
.gs-player.offline {
  opacity: 0.5;
}
.gs-player-meta {
  flex: 1;
  min-width: 0;
}
.gs-player-name {
  font-size: 14px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 6px;
}
.gs-player-ready {
  font-size: 11px;
  opacity: 0.75;
  margin-top: 3px;
  display: flex;
  align-items: center;
  gap: 5px;
}
.gs-player-ready .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #888;
}
.gs-player-ready .dot.ok {
  background: #34d399;
  box-shadow: 0 0 8px rgba(52, 211, 153, 0.7);
}
.gs-tag {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 999px;
  font-weight: 600;
}
.gs-tag.host {
  background: rgba(251, 191, 36, 0.22);
  color: #fbbf24;
}
.gs-tag.me {
  background: rgba(96, 165, 250, 0.22);
  color: #93c5fd;
}
.gs-player-score {
  font-size: 16px;
  font-weight: 700;
  color: #ffd08a;
}

.gs-cta {
  min-height: 48px;
  border-radius: 16px;
  border: 0;
  background: linear-gradient(135deg, #ff6b6b, #ff8e53 55%, #ffb347);
  color: #fff;
  font-size: 16px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  box-shadow: 0 12px 28px rgba(255, 110, 90, 0.28);
}
.gs-cta:disabled {
  opacity: 0.55;
  box-shadow: none;
}
.gs-cta.ghost {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: none;
}
.gs-cta.ghost.on {
  background: rgba(52, 211, 153, 0.22);
  border-color: rgba(52, 211, 153, 0.4);
}
.gs-cta-icon {
  font-size: 18px;
}
.gs-fine {
  margin: 0;
  text-align: center;
  font-size: 12px;
  opacity: 0.65;
}
.gs-link {
  border: 0;
  background: transparent;
  color: #d8b4fe;
  font-size: 13px;
  min-height: 36px;
}

/* ---- play stage ---- */
.gs-play {
  padding: 4px 14px 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.gs-stage {
  position: relative;
  border-radius: 22px;
  padding: 18px 16px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  overflow: hidden;
}
.gs-stage-glow {
  position: absolute;
  inset: -40%;
  background: radial-gradient(circle at 50% 30%, rgba(255, 120, 140, 0.22), transparent 55%);
  pointer-events: none;
}
.gs-stage-status {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.gs-phase-tag {
  font-size: 13px;
  padding: 6px 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.1);
}
.gs-timer {
  font-size: 22px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  color: #ffb4c8;
}

.gs-wave {
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 4px;
  height: 56px;
  margin: 8px 0 12px;
}
.gs-wave i {
  width: 4px;
  height: 12px;
  border-radius: 3px;
  background: linear-gradient(180deg, #ff8fab, #c084fc);
  opacity: 0.45;
  transform: scaleY(0.5);
}
.gs-wave.active i {
  animation: gs-wave 1.1s ease-in-out infinite;
  opacity: 1;
}
.gs-wave i:nth-child(odd) { animation-duration: 0.9s; }
.gs-wave i:nth-child(3n) { animation-delay: 0.15s; }
.gs-wave i:nth-child(4n) { animation-delay: 0.28s; }
@keyframes gs-wave {
  0%, 100% { transform: scaleY(0.45); }
  50% { transform: scaleY(1.35); }
}

.gs-hints {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.gs-hint {
  font-size: 12px;
  padding: 8px 12px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.06);
  opacity: 0.85;
}

.gs-reveal {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 12px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.08);
  margin-top: 8px;
}
.gs-cover {
  width: 68px;
  height: 68px;
  border-radius: 12px;
  object-fit: cover;
  background: #2a1848;
  flex-shrink: 0;
}
.gs-cover.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28px;
  color: #c4b5fd;
}
.gs-reveal-kicker {
  font-size: 11px;
  opacity: 0.65;
  letter-spacing: 0.08em;
}
.gs-reveal-title {
  font-size: 18px;
  font-weight: 800;
}
.gs-reveal-artist {
  font-size: 13px;
  opacity: 0.85;
  margin-top: 2px;
}
.gs-reveal-winner {
  margin-top: 6px;
  font-size: 12px;
  color: #86efac;
}

.gs-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.gs-q {
  font-size: 15px;
  font-weight: 700;
  margin-bottom: 2px;
}
.gs-opt {
  min-height: 48px;
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.07);
  color: #fff;
  font-size: 15px;
  font-weight: 600;
  text-align: left;
  padding: 0 16px;
}
.gs-opt:active {
  background: rgba(255, 120, 140, 0.3);
}
.gs-opt.artist {
  background: rgba(192, 132, 252, 0.18);
}

.gs-waiting {
  text-align: center;
  padding: 28px 12px;
}
.gs-pulse {
  width: 18px;
  height: 18px;
  margin: 0 auto 12px;
  border-radius: 50%;
  background: #ff6b6b;
  animation: gs-pulse 1s infinite;
}
@keyframes gs-pulse {
  0% { transform: scale(0.85); opacity: 1; }
  70% { transform: scale(1.3); opacity: 0.45; }
  100% { transform: scale(0.85); opacity: 1; }
}
.gs-waiting-name {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
}
.gs-waiting-sub {
  margin: 6px 0 0;
  opacity: 0.7;
  font-size: 12px;
}

.gs-buzz-wrap {
  padding: 4px 0 2px;
}
.gs-buzz {
  position: relative;
  width: 100%;
  height: 108px;
  border-radius: 28px;
  border: 0;
  cursor: pointer;
  overflow: hidden;
  background: linear-gradient(145deg, #4b5563, #374151);
  color: rgba(255, 255, 255, 0.65);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
}
.gs-buzz.ready {
  background: linear-gradient(145deg, #ff4d6d, #ff6b6b 50%, #ff8e53);
  color: #fff;
}
.gs-buzz.ready .gs-buzz-ring {
  position: absolute;
  inset: -20%;
  background: radial-gradient(circle, rgba(255, 255, 255, 0.28), transparent 60%);
  animation: gs-glow 1.4s infinite;
}
.gs-buzz:disabled {
  cursor: not-allowed;
}
.gs-buzz-label {
  font-size: 30px;
  font-weight: 900;
  letter-spacing: 0.16em;
  position: relative;
}
.gs-buzz-sub {
  font-size: 12px;
  opacity: 0.85;
  position: relative;
}
@keyframes gs-glow {
  0%, 100% { opacity: 0.35; transform: scale(0.95); }
  50% { opacity: 0.85; transform: scale(1.05); }
}

.gs-scores {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.gs-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px 6px 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  font-size: 12px;
}
.gs-chip.wrong {
  opacity: 0.5;
}
.gs-chip.me {
  outline: 1px solid rgba(255, 160, 180, 0.5);
}
.gs-chip-num {
  font-weight: 800;
  color: #ffd08a;
}

/* ---- finish ---- */
.gs-finish {
  position: relative;
  padding: 28px 16px calc(28px + var(--safe-b, 0px));
  text-align: center;
  overflow: hidden;
}
.gs-finish-glow {
  position: absolute;
  left: 50%;
  top: -40px;
  width: 320px;
  height: 220px;
  transform: translateX(-50%);
  background: radial-gradient(circle, rgba(251, 191, 36, 0.22), transparent 70%);
  pointer-events: none;
}
.gs-finish-kicker {
  margin: 0;
  font-size: 11px;
  letter-spacing: 0.22em;
  opacity: 0.55;
}
.gs-finish-title {
  margin: 6px 0 0;
  font-size: 26px;
  font-weight: 800;
}
.gs-finish-sub {
  margin: 6px 0 18px;
  opacity: 0.7;
  font-size: 13px;
}

.gs-podium {
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 10px;
  min-height: 180px;
  margin: 8px 0 18px;
}
.gs-podium-slot {
  width: 96px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}
.gs-podium-slot.p2 { order: 1; }
.gs-podium-slot.p1 { order: 2; width: 112px; }
.gs-podium-slot.p3 { order: 3; }
.gs-podium-name {
  max-width: 96px;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.gs-podium-score {
  font-size: 12px;
  color: #ffd08a;
  font-weight: 700;
}
.gs-podium-bar {
  width: 100%;
  border-radius: 12px 12px 0 0;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.18), rgba(255, 255, 255, 0.06));
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 10px;
}
.gs-podium-slot.p1 .gs-podium-bar {
  height: 88px;
  background: linear-gradient(180deg, rgba(251, 191, 36, 0.55), rgba(251, 191, 36, 0.12));
}
.gs-podium-slot.p2 .gs-podium-bar {
  height: 64px;
  background: linear-gradient(180deg, rgba(203, 213, 225, 0.45), rgba(203, 213, 225, 0.1));
}
.gs-podium-slot.p3 .gs-podium-bar {
  height: 52px;
  background: linear-gradient(180deg, rgba(217, 119, 6, 0.45), rgba(217, 119, 6, 0.1));
}
.gs-podium-rank {
  font-size: 18px;
  font-weight: 800;
  opacity: 0.85;
}

.gs-rank-card {
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 18px;
}
.gs-rank-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px;
  border-radius: 12px;
  text-align: left;
}
.gs-rank-row.me {
  background: rgba(255, 140, 180, 0.12);
}
.gs-rank-row.top {
  background: rgba(251, 191, 36, 0.1);
}
.gs-rank-no {
  width: 22px;
  height: 22px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 800;
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.75);
  flex-shrink: 0;
}
.gs-rank-no.gold {
  background: linear-gradient(135deg, #fbbf24, #f59e0b);
  color: #2a1a00;
}
.gs-rank-no.silver {
  background: linear-gradient(135deg, #e2e8f0, #94a3b8);
  color: #1e293b;
}
.gs-rank-no.bronze {
  background: linear-gradient(135deg, #d97706, #b45309);
  color: #fff7ed;
}
.gs-rank-meta {
  flex: 1;
  min-width: 0;
}
.gs-rank-name {
  font-size: 14px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 6px;
}
.gs-rank-bar {
  margin-top: 6px;
  height: 5px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.1);
  overflow: hidden;
}
.gs-rank-bar i {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #ff8fab, #ffd08a);
}
.gs-rank-score {
  font-size: 18px;
  font-weight: 800;
  color: #ffd08a;
  min-width: 36px;
  text-align: right;
}
.gs-finish-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.gs-loading {
  padding: 64px 20px;
  text-align: center;
  opacity: 0.8;
}
.gs-spinner {
  width: 36px;
  height: 36px;
  margin: 0 auto 14px;
  border-radius: 50%;
  border: 3px solid rgba(255, 255, 255, 0.15);
  border-top-color: #ff8fab;
  animation: gs-spin 0.8s linear infinite;
}
@keyframes gs-spin {
  to { transform: rotate(360deg); }
}

.gs-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 40;
}
.gs-dialog {
  width: min(320px, 86vw);
  border-radius: 18px;
  background: #241536;
  padding: 20px;
  text-align: center;
  border: 1px solid rgba(255, 255, 255, 0.1);
}
.gs-dialog p {
  margin: 0 0 16px;
}
.gs-dialog-actions {
  display: flex;
  gap: 10px;
}
.gs-dialog-actions button {
  flex: 1;
}
</style>
