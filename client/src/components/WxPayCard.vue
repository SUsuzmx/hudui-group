<script setup>
const props = defineProps({
  kind: { type: String, required: true },
  amount: { type: [Number, String], default: null },
  note: { type: String, default: '' },
  status: { type: String, default: '' },
  isMine: { type: Boolean, default: false },
  content: { type: String, default: '' },
  rpType: { type: String, default: 'exclusive' },
  claimedCount: { type: [Number, String], default: null },
  totalCount: { type: [Number, String], default: null },
  coverEmoji: { type: String, default: '' },
  remaining: { type: [Number, String], default: null },
  expired: { type: Boolean, default: false },
});
const emit = defineEmits(['open']);

function statusText() {
  if (props.kind === 'redpacket') {
    if (props.expired || props.status === 'expired') return '已过期';
    const cc = Number(props.claimedCount || (props.status === 'claimed' ? 1 : 0));
    const tc = Number(props.totalCount || 1);
    if (props.status === 'claimed') {
      return props.rpType === 'lucky' ? `${cc}/${tc} 已领取` : '已被领取';
    }
    return props.isMine ? (props.rpType === 'lucky' ? `你发出的拼手气 · ${cc}/${tc}` : '你发出的红包') : '领取红包';
  }
  if (props.status === 'claimed' || props.status === 'success') return '已完成';
  if (props.status === 'expired') return '已退回';
  return props.isMine ? '你发起的转账' : '待你确认收款';
}

function amt() {
  const n = Number(props.amount);
  if (Number.isFinite(n) && n > 0) return n.toFixed(2);
  const m = /¥\s*([0-9]+(?:\.[0-9]{1,2})?)/.exec(props.content || '');
  return m ? Number(m[1]).toFixed(2) : '0.00';
}

function typeLabel() {
  if (props.kind !== 'redpacket') return '转账';
  return props.rpType === 'lucky' ? '拼手气红包' : '微信红包';
}
</script>

<template>
  <button
    v-if="kind === 'redpacket'"
    class="wx-rp-card"
    type="button"
    @click.stop="emit('open')"
  >
    <span class="wx-rp-icon">{{ coverEmoji || '🧧' }}</span>
    <span class="wx-rp-body">
      <span class="wx-rp-title">{{ typeLabel() }}</span>
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
  width: 240px;
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
  display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1;
}
.wx-rp-title { font-size: 15px; font-weight: 600; color: #fff; }
.wx-rp-sub {
  font-size: 12px; color: rgba(255,255,255,0.92);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.wx-tf-icon {
  width: 36px; height: 36px; border-radius: 4px; background: #07c160; color: #fff;
  display: inline-flex; align-items: center; justify-content: center;
  font-weight: 700; font-size: 18px; flex-shrink: 0;
}
.wx-tf-amt { font-size: 16px; font-weight: 600; color: #191919; }
.wx-tf-sub {
  font-size: 12px; color: #888; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
</style>
