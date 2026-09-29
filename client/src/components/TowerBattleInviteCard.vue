<script setup>
// 叠塔对战邀请卡片（聊天消息内）
const props = defineProps({
  ext: { type: Object, default: () => ({}) },
  isMine: { type: Boolean, default: false },
});
const emit = defineEmits(['join']);

const statusText = () => {
  const n = Number(props.ext?.playerCount) || 1;
  const max = Number(props.ext?.maxPlayers) || 6;
  const st = String(props.ext?.status || 'waiting');
  if (st === 'full') return '人齐了，准备开场';
  if (st === 'countdown') return '马上开场';
  if (st === 'playing') return '他们已经开叠了';
  if (st === 'finished') return '这一局已经结束';
  if (st === 'closed') return '邀请已经散场';
  return `${n}/${max}人 · 等你来叠`;
};

const canJoin = () => {
  const st = String(props.ext?.status || 'waiting');
  return st === 'waiting';
};

const ctaText = () => {
  const st = String(props.ext?.status || 'waiting');
  if (st === 'waiting') return '加入对战';
  if (st === 'full') return '已满';
  if (st === 'countdown') return '马上开场';
  if (st === 'playing') return '进行中';
  if (st === 'finished') return '已结束';
  return '已散场';
};

function onClick() {
  // 已在房间的成员点任意有效状态都回房间；其他人仅 waiting 可加入
  emit('join', { inviteId: props.ext?.inviteId, status: props.ext?.status, canJoin: canJoin() });
}
</script>

<template>
  <div
    class="tower-invite-card"
    :class="{ disabled: !canJoin() && !isMine, playing: ext?.status === 'playing' || ext?.status === 'countdown' }"
    role="button"
    tabindex="0"
    @click="onClick"
    @keydown.enter.prevent="onClick"
  >
    <div class="tower-invite-icon" aria-hidden="true">
      <div class="mini-stack">
        <span /><span /><span /><span />
      </div>
    </div>
    <div class="tower-invite-body">
      <div class="tower-invite-title">叠塔对战</div>
      <div class="tower-invite-sub">{{ ext?.inviterName || '好友' }} 等你来比一局</div>
      <div class="tower-invite-meta">{{ statusText() }}</div>
    </div>
    <div class="tower-invite-cta" :class="{ dim: !canJoin() }">{{ ctaText() }}</div>
  </div>
</template>

<style scoped>
.tower-invite-card {
  display: flex !important;
  align-items: center;
  gap: 12px;
  width: 268px;
  max-width: 100%;
  border: 0;
  border-radius: 14px;
  padding: 12px;
  background: linear-gradient(145deg, #1b2a4a 0%, #243b6b 55%, #2d4a8a 100%);
  color: #eef3ff;
  text-align: left;
  cursor: pointer;
  box-shadow: 0 6px 18px rgba(30, 60, 140, 0.28);
}
.tower-invite-card.disabled {
  opacity: 0.78;
}
.tower-invite-icon {
  width: 52px;
  height: 52px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.1);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding-bottom: 8px;
  flex-shrink: 0;
}
.mini-stack {
  display: flex;
  flex-direction: column-reverse;
  gap: 3px;
  align-items: center;
}
.mini-stack span {
  display: block;
  height: 6px;
  border-radius: 2px;
  background: linear-gradient(90deg, #7dd3fc, #38bdf8);
}
.mini-stack span:nth-child(1) { width: 28px; background: #fbbf24; }
.mini-stack span:nth-child(2) { width: 22px; }
.mini-stack span:nth-child(3) { width: 18px; background: #a78bfa; }
.mini-stack span:nth-child(4) { width: 14px; background: #34d399; }
.tower-invite-body {
  flex: 1;
  min-width: 0;
}
.tower-invite-title {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.02em;
}
.tower-invite-sub {
  font-size: 12px;
  opacity: 0.88;
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tower-invite-meta {
  font-size: 11px;
  margin-top: 5px;
  opacity: 0.72;
}
.tower-invite-cta {
  font-size: 12px;
  padding: 8px 12px;
  border-radius: 999px;
  background: linear-gradient(135deg, #60a5fa, #22d3ee);
  color: #0b1b33;
  font-weight: 700;
  flex-shrink: 0;
}
.tower-invite-cta.dim {
  background: rgba(255, 255, 255, 0.18);
  color: rgba(255, 255, 255, 0.85);
}
.tower-invite-card.playing .tower-invite-cta {
  background: rgba(255, 255, 255, 0.16);
  color: rgba(255, 255, 255, 0.9);
}
</style>
