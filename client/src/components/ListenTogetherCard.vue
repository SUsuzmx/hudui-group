<script setup>
// 一起听邀请卡片（聊天消息内）
const props = defineProps({
  ext: { type: Object, default: () => ({}) },
  isMine: { type: Boolean, default: false },
  memberCount: { type: Number, default: 0 },
  status: { type: String, default: '' },
});
const emit = defineEmits(['join']);

const ended = () => Boolean(props.ext?.ended || props.status === 'ended');
const title = () => props.ext?.title || '一起听';
const artist = () => props.ext?.artist || '';
const cover = () => props.ext?.cover || '';
const hostName = () => props.ext?.hostName || props.ext?.nickname || '好友';
</script>

<template>
  <div class="lt-card" :class="{ ended: ended() }" role="button" tabindex="0" @click="!ended() && emit('join')">
    <div class="lt-card-cover">
      <img v-if="cover()" :src="cover()" alt="" />
      <span v-else class="lt-card-fallback">🎵</span>
    </div>
    <div class="lt-card-body">
      <div class="lt-card-title">{{ hostName() }} 正在听《{{ title() }}》</div>
      <div class="lt-card-sub">
        {{ artist() }}
      </div>
      <div class="lt-card-meta">
        <span v-if="ended()">本次一起听已结束</span>
        <span v-else>{{ Math.max(1, memberCount) }} 位朋友正在听</span>
      </div>
    </div>
    <div class="lt-card-cta">
      <span v-if="ended()">已结束</span>
      <span v-else>进去听听</span>
    </div>
  </div>
</template>

<style scoped>
.lt-card {
  display: flex !important;
  align-items: center;
  gap: 10px;
  width: 260px;
  max-width: 100%;
  border: 0;
  border-radius: 14px;
  padding: 12px;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.95), rgba(224, 247, 250, 0.92));
  color: #172b27;
  text-align: left;
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(20, 120, 110, 0.12);
}
.lt-card.ended {
  opacity: 0.72;
  cursor: default;
}
.lt-card-cover {
  width: 48px;
  height: 48px;
  border-radius: 10px;
  overflow: hidden;
  background: #d9f5ef;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.lt-card-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.lt-card-fallback {
  font-size: 22px;
}
.lt-card-body {
  flex: 1;
  min-width: 0;
}
.lt-card-title {
  font-size: 14px;
  font-weight: 700;
  color: #0b1f1c;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.lt-card-sub {
  font-size: 11px;
  color: #5b756f;
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.lt-card-meta {
  font-size: 11px;
  margin-top: 4px;
  color: #6b857f;
}
.lt-card-cta {
  font-size: 12px;
  padding: 7px 12px;
  border-radius: 999px;
  background: linear-gradient(135deg, #4fd1c5, #22d3ee);
  color: #fff;
  font-weight: 600;
  flex-shrink: 0;
}
.lt-card.ended .lt-card-cta {
  background: #9ab5b0;
}
</style>
