<script setup>
const props = defineProps({
  percent: { type: Number, default: 0 },
  label: { type: String, default: '上传中' },
});
</script>

<template>
  <div class="up-mask">
    <div class="up-box">
      <div class="up-ring">
        <svg viewBox="0 0 48 48" width="56" height="56">
          <circle cx="24" cy="24" r="20" fill="none" stroke="#e5e5e5" stroke-width="4" />
          <circle
            cx="24" cy="24" r="20"
            fill="none" stroke="#07c160" stroke-width="4"
            stroke-linecap="round"
            :stroke-dasharray="125.6"
            :stroke-dashoffset="125.6 * (1 - Math.max(0, Math.min(100, percent)) / 100)"
            transform="rotate(-90 24 24)"
          />
        </svg>
        <div class="up-pct">{{ percent < 0 ? '…' : Math.round(percent) + '%' }}</div>
      </div>
      <div class="up-label">{{ label }}</div>
    </div>
  </div>
</template>

<style scoped>
.up-mask {
  position: fixed; inset: 0; z-index: 9100;
  background: rgba(0,0,0,0.35);
  display: grid; place-items: center;
}
.up-box {
  background: #fff; border-radius: 12px; padding: 20px 28px;
  min-width: 120px; text-align: center;
  box-shadow: 0 8px 24px rgba(0,0,0,0.12);
}
.up-ring { position: relative; width: 56px; height: 56px; margin: 0 auto 8px; }
.up-pct {
  position: absolute; inset: 0;
  display: grid; place-items: center;
  font-size: 12px; font-weight: 600; color: #07c160;
}
.up-label { font-size: 14px; color: #333; }
</style>
