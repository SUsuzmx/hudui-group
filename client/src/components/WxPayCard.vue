// 微信风聊天内支付卡片: 保证可点击
<script setup>
const props = defineProps({
  kind: { type: String, required: true }, // redpacket | transfer
  amount: { type: [Number, String], default: null },
  note: { type: String, default: '' },
  status: { type: String, default: '' },
  isMine: { type: Boolean, default: false },
  content: { type: String, default: '' },
});
const emit = defineEmits(['open']);

function statusText() {
  if (props.kind === 'redpacket') {
    if (props.status === 'claimed') return '已被领取';
    return props.isMine ? '你发出的红包' : '领取红包';
  }
  if (props.status === 'claimed' || props.status === 'success') return '已完成';
  return props.isMine ? '你发起的转账' : '待你确认收款';
}

function amt() {
  const n = Number(props.amount);
  if (Number.isFinite(n) && n > 0) return n.toFixed(2);
  const m = /¥\s*([0-9]+(?:\.[0-9]{1,2})?)/.exec(props.content || '');
  return m ? Number(m[1]).toFixed(2) : '0.00';
}
</script>

<template>
  <button
    v-if="kind === 'redpacket'"
    class="wx-rp-card"
    type="button"
    @click.stop="emit('open')"
  >
    <span class="wx-rp-icon">🧧</span>
    <span class="wx-rp-body">
      <span class="wx-rp-title">微信红包</span>
      <span class="wx-rp-sub">{{ note || '恭喜发财' }} · {{ statusText() }}</span>
    </span>
  </button>
  <button
    v-else
    class="wx-tf-card"
    type="button"
    @click.stop="emit('open')"
  >
    <span class="wx-tf-icon">¥</span>
    <span class="wx-tf-body">
      <span class="wx-tf-amt">¥{{ amt() }}</span>
      <span class="wx-tf-sub">转账 · {{ statusText() }}</span>
    </span>
  </button>
</template>

<style scoped>
.wx-rp-card, .wx-tf-card {
  display: flex !important;
  align-items: center;
  gap: 10px;
  width: 232px;
  max-width: 100%;
  border: 0;
  margin: 0;
  padding: 12px 14px;
  border-radius: 6px;
  text-align: left;
  cursor: pointer;
  pointer-events: auto !important;
  touch-action: manipulation;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
  box-shadow: none;
  font: inherit;
}
.wx-rp-card {
  background: linear-gradient(90deg, #fa9d3b 0%, #e8534a 100%) !important;
  color: #fff !important;
}
.wx-rp-card:active { filter: brightness(0.94); }
.wx-tf-card {
  background: #fff !important;
  border: 0.5px solid #e5e5e5;
  color: #191919 !important;
}
.wx-tf-card:active { background: #f7f7f7 !important; }
.wx-rp-icon { font-size: 28px; line-height: 1; flex-shrink: 0; }
.wx-rp-body, .wx-tf-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}
.wx-rp-title { font-size: 15px; font-weight: 600; color: #fff; }
.wx-rp-sub {
  font-size: 12px;
  color: rgba(255,255,255,0.92);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wx-tf-icon {
  width: 36px;
  height: 36px;
  border-radius: 4px;
  background: #07c160;
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 18px;
  flex-shrink: 0;
}
.wx-tf-amt { font-size: 16px; font-weight: 600; color: #191919; }
.wx-tf-sub {
  font-size: 12px;
  color: #888;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
