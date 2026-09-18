<script setup>
import { computed } from 'vue';
import UserAvatar from './UserAvatar.vue';
import WxPayCreatePage from './WxPayCreatePage.vue';

const props = defineProps({
  open: { type: Boolean, default: false },
  kind: { type: String, default: 'redpacket' }, // redpacket | transfer
  mode: { type: String, default: 'claim' }, // claim | create
  amount: { type: [Number, String], default: null },
  note: { type: String, default: '' },
  status: { type: String, default: '' },
  isMine: { type: Boolean, default: false },
  senderName: { type: String, default: '' },
  senderAvatar: { type: String, default: null },
  senderEmoji: { type: String, default: '🧧' },
  peerWxid: { type: String, default: '' },
  tip: { type: String, default: '' },
  createAmount: { type: Number, default: null },
  createNote: { type: String, default: '' },
  createAmountText: { type: String, default: '' },
  balance: { type: [Number, String], default: null },
});
const emit = defineEmits([
  'close',
  'confirm',
  'update:createAmount',
  'update:createNote',
  'update:createAmountText',
  'submit',
]);

const isRP = computed(() => props.kind === 'redpacket');
const amtText = computed(() => {
  const n = Number(props.amount);
  return Number.isFinite(n) ? n.toFixed(2) : '--';
});

const createAmtText = computed({
  get: () => {
    if (props.createAmountText !== undefined && props.createAmountText !== null && props.createAmountText !== '') {
      return String(props.createAmountText);
    }
    const n = Number(props.createAmount);
    return Number.isFinite(n) && n > 0 ? String(n) : '';
  },
  set: (v) => emit('update:createAmountText', v),
});

const createNote = computed({
  get: () => props.createNote,
  set: (v) => emit('update:createNote', v),
});

const canClaim = computed(() => {
  if (props.mode === 'create') return false;
  return !props.isMine && props.status !== 'claimed' && props.status !== 'success';
});

function fmtStatus() {
  if (props.mode === 'create') return '';
  if (props.isMine) return isRP.value ? '你发出的红包' : '你发起的转账';
  if (props.status === 'claimed' || props.status === 'success') {
    return isRP.value ? '红包已被领取' : '转账已收款';
  }
  return isRP.value ? '领取红包' : '待确认收款';
}
</script>

<template>
  <div v-if="open && mode === 'create'" class="create-root">
    <WxPayCreatePage
      :kind="kind"
      :amount-text="createAmtText"
      :note="createNote"
      :peer-name="senderName"
      :peer-wxid="peerWxid"
      :peer-avatar="senderAvatar"
      :balance="balance"
      @update:amount-text="(v) => (createAmtText = v)"
      @update:note="(v) => (createNote = v)"
      @submit="emit('submit')"
      @close="emit('close')"
    />
  </div>

  <div v-else-if="open" class="wx-pay-root" @click.self="emit('close')">
    <!-- 领取红包 -->
    <div v-if="isRP" class="rp-page">
      <div class="rp-top">
        <button class="rp-close" type="button" @click="emit('close')">✕</button>
        <UserAvatar
          :name="senderName || '好友'"
          :avatar="senderAvatar"
          :emoji="senderEmoji"
          :color="'#fff'"
          :size="64"
        />
        <div class="rp-sender">{{ senderName || '微信红包' }}</div>
        <div class="rp-note">{{ note || '恭喜发财，大吉大利' }}</div>
      </div>
      <div class="rp-mid">
        <div v-if="canClaim" class="rp-open-btn" role="button" tabindex="0" @click="emit('confirm')" @keyup.enter="emit('confirm')">
          <span>开</span>
        </div>
        <div v-else class="rp-amt-block">
          <div class="rp-amt-unit">¥</div>
          <div class="rp-amt">{{ amtText }}</div>
          <div class="rp-amt-status">{{ fmtStatus() }}</div>
        </div>
        <div v-if="tip" class="rp-tip">{{ tip }}</div>
        <div class="rp-brand">互怼小群红包</div>
      </div>
    </div>

    <!-- 转账确认 -->
    <div v-else class="tf-page">
      <div class="tf-card">
        <UserAvatar
          :name="senderName || '好友'"
          :avatar="senderAvatar"
          :emoji="'👤'"
          :color="'#07c160'"
          :size="48"
        />
        <div class="tf-name">{{ senderName || '好友' }}</div>
        <div class="tf-label">{{ isMine ? '转账金额' : '请你确认收款' }}</div>
        <div class="tf-amt">¥{{ amtText }}</div>
        <div v-if="note" class="tf-note">{{ note }}</div>
        <div class="tf-status">{{ fmtStatus() }}</div>
        <button v-if="canClaim" class="tf-ok" type="button" @click="emit('confirm')">确认收款</button>
        <button v-else class="tf-ok disabled" type="button" disabled>{{ fmtStatus() }}</button>
        <button class="tf-cancel" type="button" @click="emit('close')">关闭</button>
        <div class="tf-brand">微信支付 · 演示环境</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.create-root { position: fixed; inset: 0; z-index: 4000; }
.wx-pay-root {
  position: fixed;
  inset: 0;
  z-index: 4000;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: stretch;
  justify-content: center;
}
.rp-page {
  width: 100%;
  max-width: 420px;
  margin: 0 auto;
  background: linear-gradient(180deg, #e8534a 0%, #c20c0c 48%, #b00a0a 100%);
  display: flex;
  flex-direction: column;
  color: #fff;
}
.rp-top {
  padding: 28px 24px 12px;
  text-align: center;
  position: relative;
}
.rp-close {
  position: absolute;
  left: 12px;
  top: 12px;
  width: 36px;
  height: 36px;
  border: 0;
  background: transparent;
  color: rgba(255,255,255,0.85);
  font-size: 18px;
}
.rp-sender { margin-top: 10px; font-size: 17px; font-weight: 500; }
.rp-note { margin-top: 8px; font-size: 14px; opacity: 0.92; }
.rp-mid {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 24px 20px 40px;
}
.rp-open-btn {
  width: 88px;
  height: 88px;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #ffd76a, #f5a623 45%, #e08900 100%);
  box-shadow: 0 8px 20px rgba(0,0,0,0.25);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 36px;
  font-weight: 700;
  color: #c20c0c;
  cursor: pointer;
  user-select: none;
  margin-top: 20px;
}
.rp-open-btn:active { transform: scale(0.96); }
.rp-amt-block { margin-top: 28px; text-align: center; }
.rp-amt-unit { font-size: 18px; opacity: 0.9; }
.rp-amt { font-size: 42px; font-weight: 700; letter-spacing: 1px; }
.rp-amt-status { margin-top: 8px; font-size: 13px; opacity: 0.85; }
.rp-tip { margin-top: 16px; font-size: 13px; opacity: 0.85; }
.rp-brand { margin-top: auto; padding-top: 40px; font-size: 12px; opacity: 0.55; }

.tf-page {
  width: 100%;
  max-width: 420px;
  margin: 48px auto;
  padding: 0 16px;
  display: flex;
  align-items: flex-start;
  justify-content: center;
}
.tf-card {
  width: 100%;
  background: #fff;
  border-radius: 12px;
  padding: 28px 20px 24px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.tf-name { font-size: 17px; font-weight: 500; color: #191919; }
.tf-label { margin-top: 8px; font-size: 14px; color: #888; }
.tf-amt { font-size: 40px; font-weight: 700; color: #191919; margin: 4px 0; }
.tf-note { font-size: 14px; color: #888; }
.tf-status { font-size: 13px; color: #b2b2b2; margin-bottom: 8px; }
.tf-ok {
  width: 100%;
  min-height: 46px;
  border: 0;
  border-radius: 8px;
  background: #07c160;
  color: #fff;
  font-size: 17px;
  margin-top: 8px;
}
.tf-ok.disabled { background: #cfcfcf; }
.tf-ok:active:not(.disabled) { background: #06ad56; }
.tf-cancel {
  width: 100%;
  min-height: 44px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #576b95;
  font-size: 16px;
  margin-top: 4px;
}
.tf-brand { margin-top: 10px; font-size: 12px; color: #b2b2b2; }
</style>
