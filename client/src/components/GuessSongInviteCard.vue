<script setup>
// 猜歌抢答邀请卡片（聊天消息内）
const props = defineProps({
  ext: { type: Object, default: () => ({}) },
  isMine: { type: Boolean, default: false },
});
const emit = defineEmits(['join']);

const statusText = () => {
  const n = Number(props.ext?.playerCount) || 1;
  const max = Number(props.ext?.maxPlayers) || 8;
  const songs = Number(props.ext?.songCount) || 10;
  const theme = String(props.ext?.theme || '曲库小王子');
  const st = String(props.ext?.status || 'waiting');
  if (st === 'full') return '人齐了，准备开场';
  if (st === 'countdown') return '马上开场';
  if (st === 'playing') return '他们已经开始猜了';
  if (st === 'finished') return '这一局已经结束';
  if (st === 'closed') return '邀请已经散场';
  return `${theme} · ${n}/${max}人 · 共${songs}首`;
};

const canJoin = () => {
  const st = String(props.ext?.status || 'waiting');
  return st === 'waiting' || st === 'finished';
};

const ctaText = () => {
  const st = String(props.ext?.status || 'waiting');
  if (st === 'waiting') return '加入抢答';
  if (st === 'full') return '已满';
  if (st === 'countdown') return '马上开场';
  if (st === 'playing') return '进行中';
  if (st === 'finished') return '已结束';
  return '已散场';
};

function onClick() {
  emit('join', { inviteId: props.ext?.inviteId, status: props.ext?.status, canJoin: canJoin() });
}
</script>

<template>
  <div
    class="guess-invite-card"
    :class="{ disabled: !canJoin() && !isMine, playing: ext?.status === 'playing' || ext?.status === 'countdown' }"
    role="button"
    tabindex="0"
    @click="onClick"
    @keydown.enter.prevent="onClick"
  >
    <div class="guess-invite-icon" aria-hidden="true">
      <div class="mini-note">
        <span class="n1" /><span class="n2" /><span class="n3" />
      </div>
    </div>
    <div class="guess-invite-body">
      <div class="guess-invite-title">猜歌抢答</div>
      <div class="guess-invite-sub">{{ ext?.inviterName || '好友' }} 邀你来抢麦</div>
      <div class="guess-invite-meta">{{ statusText() }}</div>
    </div>
    <div class="guess-invite-cta" :class="{ dim: !canJoin() }">{{ ctaText() }}</div>
  </div>
</template>

<style scoped>
.guess-invite-card {
  display: flex !important;
  align-items: center;
  gap: 12px;
  width: 268px;
  max-width: 100%;
  border: 0;
  border-radius: 14px;
  padding: 12px;
  background: linear-gradient(145deg, #3b1d4a 0%, #5b2d6b 55%, #7a3d8a 100%);
  color: #f8eefc;
  text-align: left;
  cursor: pointer;
  box-shadow: 0 6px 18px rgba(100, 40, 120, 0.28);
}
.guess-invite-card.disabled {
  opacity: 0.78;
}
.guess-invite-icon {
  width: 52px;
  height: 52px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.12);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.mini-note {
  display: flex;
  align-items: flex-end;
  gap: 4px;
  height: 28px;
}
.mini-note span {
  display: block;
  width: 6px;
  border-radius: 3px;
  background: #f9a8d4;
}
.mini-note .n1 { height: 16px; }
.mini-note .n2 { height: 26px; background: #c4b5fd; }
.mini-note .n3 { height: 20px; background: #67e8f9; }
.guess-invite-body {
  flex: 1;
  min-width: 0;
}
.guess-invite-title {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.02em;
}
.guess-invite-sub {
  font-size: 12px;
  opacity: 0.88;
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.guess-invite-meta {
  font-size: 11px;
  margin-top: 5px;
  opacity: 0.72;
}
.guess-invite-cta {
  font-size: 12px;
  padding: 8px 12px;
  border-radius: 999px;
  background: linear-gradient(135deg, #f472b6, #a78bfa);
  color: #2a1038;
  font-weight: 700;
  flex-shrink: 0;
}
.guess-invite-cta.dim {
  background: rgba(255, 255, 255, 0.18);
  color: rgba(255, 255, 255, 0.85);
}
.guess-invite-card.playing .guess-invite-cta {
  background: rgba(255, 255, 255, 0.16);
  color: rgba(255, 255, 255, 0.9);
}
</style>
