<script setup>
import { computed } from 'vue';
import UserAvatar from './UserAvatar.vue';
import WxPayCreatePage from './WxPayCreatePage.vue';

const props = defineProps({
  open: { type: Boolean, default: false },
  kind: { type: String, default: 'redpacket' },
  mode: { type: String, default: 'claim' },
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
  // 红包细节
  rpType: { type: String, default: 'exclusive' },
  rpCount: { type: Number, default: 1 },
  cover: { type: String, default: 'classic' },
  isGroup: { type: Boolean, default: false },
  claims: { type: Array, default: () => [] },
  totalAmount: { type: [Number, String], default: null },
  remaining: { type: [Number, String], default: null },
  claimedCount: { type: [Number, String], default: null },
  totalCount: { type: [Number, String], default: null },
  leftCount: { type: [Number, String], default: null },
  coverEmoji: { type: String, default: '🧧' },
  coverFrom: { type: String, default: '#e8534a' },
  coverTo: { type: String, default: '#c20c0c' },
  coverLabel: { type: String, default: '经典红包' },
  isBest: { type: Boolean, default: false },
  expired: { type: Boolean, default: false },
});
const emit = defineEmits([
  'close',
  'confirm',
  'update:createAmount',
  'update:createNote',
  'update:createAmountText',
  'update:rpType',
  'update:rpCount',
  'update:cover',
  'submit',
]);

const isRP = computed(() => props.kind === 'redpacket');
const isLucky = computed(() => props.rpType === 'lucky');
const amtText = computed(() => {
  const n = Number(props.amount ?? props.totalAmount);
  return Number.isFinite(n) ? n.toFixed(2) : '--';
});
const totalText = computed(() => {
  const n = Number(props.totalAmount ?? props.amount);
  return Number.isFinite(n) ? n.toFixed(2) : '--';
});
const remainText = computed(() => {
  const n = Number(props.remaining);
  return Number.isFinite(n) ? n.toFixed(2) : '0.00';
});
const cc = computed(() => Number(props.claimedCount || 0));
const tc = computed(() => Number(props.totalCount || 1));
const leftN = computed(() => Math.max(0, Number(props.leftCount ?? (tc.value - cc.value))));

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
  if (props.expired || props.status === 'expired') return false;
  return !props.isMine && props.status !== 'claimed' && props.status !== 'success';
});

const alreadyClaimed = computed(() => {
  const claims = props.claims || [];
  // 前端无法可靠知道当前 userId 时, 用 status 推断
  return props.status === 'claimed' && !canClaim.value && !props.isMine;
});

function fmtStatus() {
  if (props.mode === 'create') return '';
  if (props.expired || props.status === 'expired') return '已过期，未领部分已退回';
  if (props.isMine) {
    if (isRP.value) {
      return leftN.value > 0
        ? `你发出的红包 · ${cc.value}/${tc.value} 已领 · 剩余 ¥${remainText.value}`
        : `你发出的红包 · ${cc.value}/${tc.value} 已领完`;
    }
    return '你发起的转账';
  }
  if (isRP.value) {
    if (props.isBest) return '手气最佳';
    if (props.status === 'claimed' || alreadyClaimed.value) {
      return isLucky.value ? `已领取 ¥${amtText.value}` : '红包已被领取';
    }
    return '领取红包';
  }
  if (props.status === 'claimed' || props.status === 'success') return '转账已收款';
  return '待确认收款';
}

const claimAmt = computed(() => {
  const claims = props.claims || [];
  const mine = claims.find((c) => c.isMe) || claims.find((c) => c.claimedByMe);
  if (mine) return Number(mine.amount).toFixed(2);
  return amtText.value;
});
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
      :rp-type="rpType"
      :rp-count="rpCount"
      :cover="cover"
      :is-group="isGroup"
      @update:amount-text="(v) => (createAmtText = v)"
      @update:note="(v) => (createNote = v)"
      @update:rp-type="(v) => emit('update:rpType', v)"
      @update:rp-count="(v) => emit('update:rpCount', v)"
      @update:cover="(v) => emit('update:cover', v)"
      @submit="emit('submit')"
      @close="emit('close')"
    />
  </div>

  <div v-else-if="open" class="wx-pay-root" @click.self="emit('close')">
    <div v-if="isRP" class="rp-page" :style="{ background: `linear-gradient(180deg, ${coverFrom} 0%, ${coverTo} 55%, ${coverTo} 100%)` }">
      <div class="rp-top">
        <button class="rp-close" type="button" @click="emit('close')">✕</button>
        <div class="rp-cover-badge">{{ coverEmoji || '🧧' }}</div>
        <UserAvatar
          :name="senderName || '好友'"
          :avatar="senderAvatar"
          :emoji="senderEmoji"
          :color="'#fff'"
          :size="64"
        />
        <div class="rp-sender">{{ senderName || '微信红包' }}</div>
        <div class="rp-note">{{ note || '恭喜发财，大吉大利' }}</div>
        <div class="rp-type-tag">{{ isLucky ? '拼手气红包' : '专属红包' }} · {{ coverLabel }}</div>
      </div>
      <div class="rp-mid">
        <div v-if="canClaim" class="rp-open-btn" role="button" tabindex="0" @click="emit('confirm')" @keyup.enter="emit('confirm')">
          <span>开</span>
        </div>
        <div v-else class="rp-amt-block">
          <div class="rp-amt-unit">¥</div>
          <div class="rp-amt">{{ isMine && isLucky ? totalText : claimAmt }}</div>
          <div class="rp-amt-status" :class="{ best: isBest }">
            <span v-if="isBest">👑 </span>{{ fmtStatus() }}
          </div>
        </div>
        <div v-if="tip" class="rp-tip">{{ tip }}</div>
        <div v-if="isRP && isLucky" class="rp-progress">
          {{ cc }}/{{tc}} 已领取 · 共 ¥{{ totalText }}<span v-if="isMine && leftN > 0"> · 剩余 ¥{{ remainText }}</span>
        </div>
        <div v-if="claims && claims.length" class="claim-list">
          <div class="claim-head">红包记录</div>
          <div v-for="(c, i) in claims" :key="i" class="claim-row">
            <span class="claim-name">{{ c.nickname }}<span v-if="c.isBest" class="best-tag">手气最佳</span></span>
            <span class="claim-amt">¥{{ Number(c.amount).toFixed(2) }}</span>
          </div>
        </div>
        <div class="rp-brand">微信支付 · 演示红包</div>
      </div>
    </div>

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
        <div class="tf-brand">微信支付 · 演示环境 · 24h 未收自动退回</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.create-root { position: fixed; inset: 0; z-index: 4000; }
.wx-pay-root {
  position: fixed; inset: 0; z-index: 4000; background: rgba(0, 0, 0, 0.55);
  display: flex; align-items: stretch; justify-content: center;
}
.rp-page {
  width: 100%; max-width: 420px; margin: 0 auto;
  display: flex; flex-direction: column; color: #fff;
}
.rp-top { padding: 28px 24px 12px; text-align: center; position: relative; }
.rp-close {
  position: absolute; left: 12px; top: 12px; width: 36px; height: 36px; border: 0;
  background: transparent; color: rgba(255,255,255,0.85); font-size: 18px;
}
.rp-cover-badge { font-size: 22px; margin-bottom: 4px; }
.rp-sender { margin-top: 10px; font-size: 17px; font-weight: 500; }
.rp-note { margin-top: 8px; font-size: 14px; opacity: 0.92; }
.rp-type-tag { margin-top: 6px; font-size: 12px; opacity: 0.8; }
.rp-mid {
  flex: 1; display: flex; flex-direction: column; align-items: center;
  padding: 16px 20px 28px; background: rgba(0,0,0,0.08);
}
.rp-open-btn {
  width: 88px; height: 88px; border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #ffd76a, #f5a623 45%, #e08900 100%);
  box-shadow: 0 8px 20px rgba(0,0,0,0.25); display: flex; align-items: center; justify-content: center;
  font-size: 36px; font-weight: 700; color: #c20c0c; cursor: pointer; user-select: none; margin-top: 12px;
}
.rp-open-btn:active { transform: scale(0.96); }
.rp-amt-block { margin-top: 20px; text-align: center; }
.rp-amt-unit { font-size: 18px; opacity: 0.9; }
.rp-amt { font-size: 42px; font-weight: 700; letter-spacing: 1px; }
.rp-amt-status { margin-top: 8px; font-size: 13px; opacity: 0.85; }
.rp-amt-status.best { color: #ffe08a; font-weight: 600; }
.rp-tip { margin-top: 12px; font-size: 13px; opacity: 0.85; }
.rp-progress { margin-top: 10px; font-size: 12px; opacity: 0.85; }
.claim-list {
  width: min(320px, 100%); margin-top: 14px; background: rgba(255,255,255,0.12);
  border-radius: 10px; padding: 10px 12px; text-align: left;
}
.claim-head { font-size: 12px; opacity: 0.8; margin-bottom: 6px; }
.claim-row { display: flex; justify-content: space-between; gap: 8px; font-size: 13px; padding: 4px 0; }
.claim-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.best-tag {
  margin-left: 6px; font-size: 10px; background: rgba(255,224,138,0.25);
  padding: 1px 4px; border-radius: 3px; color: #ffe08a;
}
.claim-amt { font-variant-numeric: tabular-nums; font-weight: 600; }
.rp-brand { margin-top: auto; padding-top: 20px; font-size: 12px; opacity: 0.55; }
.tf-page {
  width: 100%; max-width: 420px; margin: 48px auto; padding: 0 16px;
  display: flex; align-items: flex-start; justify-content: center;
}
.tf-card {
  width: 100%; background: #fff; border-radius: 12px; padding: 28px 20px 24px;
  text-align: center; display: flex; flex-direction: column; align-items: center; gap: 8px;
}
.tf-name { font-size: 17px; font-weight: 500; color: #191919; }
.tf-label { margin-top: 8px; font-size: 14px; color: #888; }
.tf-amt { font-size: 40px; font-weight: 700; color: #191919; margin: 4px 0; }
.tf-note { font-size: 14px; color: #888; }
.tf-status { font-size: 13px; color: #b2b2b2; margin-bottom: 8px; }
.tf-ok {
  width: 100%; min-height: 46px; border: 0; border-radius: 8px; background: #07c160;
  color: #fff; font-size: 17px; margin-top: 8px;
}
.tf-ok.disabled { background: #cfcfcf; }
.tf-cancel {
  width: 100%; min-height: 44px; border: 0; border-radius: 8px; background: transparent;
  color: #576b95; font-size: 16px; margin-top: 4px;
}
.tf-brand { margin-top: 10px; font-size: 12px; color: #b2b2b2; }
</style>
