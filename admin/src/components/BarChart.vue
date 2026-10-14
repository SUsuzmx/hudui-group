<script setup>
// 纯 CSS 柱状趋势图，避免为后台引入图表库
const props = defineProps({
  data: { type: Array, default: () => [] }, // [{ date, count }]
  height: { type: Number, default: 132 },
  color: { type: String, default: '' },
});

function max() {
  return Math.max(1, ...props.data.map((d) => Number(d.count) || 0));
}

function h(count) {
  const v = Number(count) || 0;
  return `${Math.round((v / max()) * 100)}%`;
}

function label(date) {
  const parts = String(date || '').split('-');
  return parts.length >= 3 ? `${parts[1]}/${parts[2]}` : String(date || '');
}
</script>

<template>
  <div class="chart" :style="{ height: `${height}px` }">
    <div v-for="d in data" :key="d.date" class="bar-wrap" :title="`${d.date}：${d.count}`">
      <div
        class="bar"
        :style="{ height: h(d.count), background: color || undefined }"
      ></div>
      <span class="lbl">{{ label(d.date) }}</span>
    </div>
  </div>
</template>
