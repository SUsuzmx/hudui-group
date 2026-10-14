<script setup>
const props = defineProps({
  total: { type: Number, default: 0 },
  limit: { type: Number, default: 20 },
  offset: { type: Number, default: 0 },
  unit: { type: String, default: '条' },
});
const emit = defineEmits(['change']);

function page() {
  return Math.floor(props.offset / props.limit) + 1;
}

function pages() {
  return Math.max(1, Math.ceil(props.total / props.limit));
}

function go(p) {
  const next = Math.min(Math.max(p, 1), pages());
  emit('change', (next - 1) * props.limit);
}
</script>

<template>
  <div class="pager">
    <span>共 {{ total }} {{ unit }}</span>
    <div class="spacer"></div>
    <button type="button" class="btn sm" :disabled="offset <= 0" @click="go(page() - 1)">上一页</button>
    <span>第 {{ page() }} / {{ pages() }} 页</span>
    <button type="button" class="btn sm" :disabled="offset + limit >= total" @click="go(page() + 1)">下一页</button>
  </div>
</template>
