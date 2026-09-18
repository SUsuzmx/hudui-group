<script setup>
import { computed } from 'vue';

const props = defineProps({
  kind: { type: String, default: 'redpacket' }, // redpacket | transfer
  amountText: { type: String, default: '' },
  note: { type: String, default: '' },
  peerName: { type: String, default: '' },
  peerWxid: { type: String, default: '' },
  peerAvatar: { type: String, default: null },
  balance: { type: [Number, String], default: null },
  submitting: { type: Boolean, default: false },
});
const emit = defineEmits(['update:amountText', 'update:note', 'submit', 'close']);

const isRP = computed(() => props.kind === 'redpacket');
const title = computed(() => (isRP.value ? '发红包' : '转账'));

const displayAmt = computed(() => {
  const t = String(props.amountText || '');
  if (!t) return isRP.value ? '¥0.00' : '';
  if (t.includes('.')) return `¥${t}`;
  return `¥${t}`;
});

const bigAmt = computed(() => {
  const t = String(props.amountText || '');
  return t || '0.00';
});

function onKey(k) {
  let t = String(props.amountText || '');
  if (k === 'del') {
    t = t.slice(0, -1);
  } else if (k === '.') {
    if (t.includes('.')) return;
    if (!t) t = '0.';
    else t += '.';
  } else {
    if (t.includes('.') && t.split('.')[1]?.length >= 2) return;
    if (t === '0' && k !== '.') t = k;
    else t += k;
    const num = Number(t);
    if (Number.isFinite(num) && num > 99999.99) return;
  }
  emit('update:amountText', t);
}

function canSubmit() {
  return Number(props.amountText) > 0 && !props.submitting;
}
</script>

<template>
  <div class="pay-page" :class="{ tf: !isRP }">
    <!-- 导航 -->
    <header class="pay-nav">
      <button class="pay-back" type="button" aria-label="返回" @click="emit('close')">‹</button>
      <div class="pay-nav-title">{{ title }}</div>
      <div class="pay-nav-right">
        <span v-if="isRP" class="pay-more">···</span>
      </div>
    </header>

    <!-- 转账: 对方信息 -->
    <div v-if="!isRP" class="tf-peer">
      <div class="tf-peer-main">
        <div class="tf-peer-title">转账给 {{ peerName || '好友' }}</div>
        <div class="tf-peer-wx">微信号: {{ peerWxid || '—' }}</div>
      </div>
      <div class="tf-peer-avatar">
        <img v-if="peerAvatar" :src="peerAvatar" alt="" />
        <span v-else>{{ (peerName || '友')[0] }}</span>
      </div>
    </div>

    <!-- 红包: 三张白卡 -->
    <template v-if="isRP">
      <div class="rp-card amount-card">
        <span class="rp-label">金额</span>
        <span class="rp-amt" :class="{ empty: !amountText }">{{ amountText ? `¥${amountText}` : '¥0.00' }}</span>
      </div>
      <div class="rp-card note-card">
        <input
          class="rp-note-input"
          type="text"
          maxlength="30"
          :value="note"
          placeholder="恭喜发财，大吉大利"
          @input="emit('update:note', $event.target.value)"
        />
        <span class="rp-emoji">☺+</span>
      </div>
      <div class="rp-card cover-card">
        <span class="rp-label">红包封面</span>
        <span class="rp-arrow">›</span>
      </div>

      <div class="rp-mid">
        <div class="rp-big-amt"><span class="yen">¥</span>{{ bigAmt === '0.00' || !amountText ? '0.00' : bigAmt }}</div>
        <button
          class="rp-submit"
          type="button"
          :disabled="!canSubmit()"
          @click="emit('submit')"
        >塞钱进红包</button>
      </div>
      <div class="pay-foot">可直接使用收到的零钱发红包</div>
    </template>

    <!-- 转账: 白底表单 -->
    <template v-else>
      <div class="tf-sheet">
        <div class="tf-field-label">转账金额</div>
        <div class="tf-amount-row">
          <span class="tf-yen">¥</span>
          <input
            class="tf-amount-input"
            type="text"
            inputmode="decimal"
            :value="amountText"
            placeholder=""
            @input="emit('update:amountText', String($event.target.value).replace(/[^\d.]/g, ''))"
          />
        </div>
        <div class="tf-divider"></div>
        <button class="tf-note-btn" type="button" @click="$refs.noteInput?.focus?.()">
          <input
            ref="noteInput"
            class="tf-note-input"
            type="text"
            maxlength="30"
            :value="note"
            placeholder="添加转账说明"
            @input="emit('update:note', $event.target.value)"
          />
        </button>
      </div>
    </template>

    <!-- 数字键盘 -->
    <div class="keypad" :class="{ tf: !isRP }">
      <div class="keypad-grid">
        <button v-for="k in ['1','2','3','4','5','6','7','8','9','.','0','del']" :key="k" class="key" type="button" @click="onKey(k)">
          <span v-if="k === 'del'">⌫</span>
          <span v-else>{{ k }}</span>
        </button>
      </div>
      <button
        class="key-submit"
        type="button"
        :class="{ rp: isRP }"
        :disabled="!canSubmit()"
        @click="emit('submit')"
      >{{ isRP ? '塞钱进红包' : '转账' }}</button>
    </div>
  </div>
</template>

<style scoped>
.pay-page {
  position: fixed;
  inset: 0;
  z-index: 4000;
  background: #ededed;
  display: flex;
  flex-direction: column;
  overflow: auto;
  color: #191919;
}
.pay-nav {
  flex-shrink: 0;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  padding: 0 8px;
  background: #ededed;
}
.pay-back {
  position: absolute;
  left: 4px;
  top: 0;
  bottom: 0;
  width: 44px;
  border: 0;
  background: transparent;
  font-size: 28px;
  color: #191919;
  line-height: 1;
}
.pay-nav-title { font-size: 17px; font-weight: 600; }
.pay-nav-right { position: absolute; right: 12px; top: 0; bottom: 0; display: flex; align-items: center; }
.pay-more { font-size: 20px; letter-spacing: 1px; color: #191919; }

/* 红包卡片 */
.rp-card {
  margin: 10px 16px 0;
  background: #fff;
  border-radius: 10px;
  min-height: 56px;
  display: flex;
  align-items: center;
  padding: 0 16px;
  box-sizing: border-box;
}
.rp-label { font-size: 17px; color: #191919; }
.rp-amt { margin-left: auto; font-size: 18px; color: #b2b2b2; }
.rp-amt.empty { color: #b2b2b2; }
.rp-note-input {
  flex: 1;
  border: 0;
  outline: none;
  background: transparent;
  font-size: 17px;
  color: #191919;
  min-height: 56px;
}
.rp-note-input::placeholder { color: #b2b2b2; }
.rp-emoji { margin-left: 8px; font-size: 22px; color: #b2b2b2; }
.cover-card { margin-top: 10px; margin-bottom: 8px; }
.rp-arrow { margin-left: auto; color: #c7c7cc; font-size: 20px; }

.rp-mid {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px 24px 12px;
  min-height: 220px;
}
.rp-big-amt {
  font-size: 48px;
  font-weight: 700;
  letter-spacing: -1px;
  color: #000;
  margin-bottom: 28px;
}
.rp-big-amt .yen {
  font-size: 36px;
  font-weight: 600;
  margin-right: 4px;
}
.rp-submit {
  width: min(280px, 72vw);
  min-height: 50px;
  border: 0;
  border-radius: 8px;
  background: #fa5151;
  color: #fff;
  font-size: 18px;
  font-weight: 500;
}
.rp-submit:disabled { opacity: 0.45; }
.rp-submit:not(:disabled):active { background: #e04646; }
.pay-foot {
  text-align: center;
  font-size: 13px;
  color: #b2b2b2;
  padding: 8px 16px 20px;
}

/* 转账头图区 */
.tf-peer {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 20px 20px 24px;
  background: #ededed;
}
.tf-peer-main { flex: 1; min-width: 0; }
.tf-peer-title {
  font-size: 20px;
  font-weight: 600;
  color: #191919;
  line-height: 1.35;
}
.tf-peer-wx { margin-top: 8px; font-size: 14px; color: #888; }
.tf-peer-avatar {
  width: 56px;
  height: 56px;
  border-radius: 6px;
  overflow: hidden;
  background: #07c160;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  font-weight: 600;
  flex-shrink: 0;
}
.tf-peer-avatar img { width: 100%; height: 100%; object-fit: cover; }

.tf-sheet {
  background: #fff;
  border-radius: 12px 12px 0 0;
  padding: 22px 20px 16px;
  flex: 1;
}
.tf-field-label { font-size: 15px; color: #888; }
.tf-amount-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 14px;
  padding-bottom: 10px;
}
.tf-yen { font-size: 40px; font-weight: 700; color: #000; }
.tf-amount-input {
  flex: 1;
  border: 0;
  outline: none;
  font-size: 40px;
  font-weight: 600;
  color: #07c160;
  background: transparent;
  min-width: 0;
  caret-color: #07c160;
}
.tf-amount-input::placeholder { color: #ddd; }
.tf-divider { height: 1px; background: #ececec; }
.tf-note-btn {
  width: 100%;
  border: 0;
  background: transparent;
  padding: 16px 0 8px;
  text-align: left;
}
.tf-note-input {
  width: 100%;
  border: 0;
  outline: none;
  background: transparent;
  font-size: 16px;
  color: #576b95;
}
.tf-note-input::placeholder { color: #576b95; }

/* 键盘 */
.keypad {
  flex-shrink: 0;
  background: #f7f7f7;
  padding: 8px 6px calc(8px + env(safe-area-inset-bottom, 0px));
  display: grid;
  grid-template-columns: 1fr 1fr 1fr 1.05fr;
  gap: 6px;
  position: sticky;
  bottom: 0;
}
.keypad-grid {
  grid-column: 1 / 4;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}
.key {
  min-height: 48px;
  border: 0;
  border-radius: 6px;
  background: #fff;
  font-size: 22px;
  font-weight: 500;
  color: #191919;
  box-shadow: 0 1px 0 rgba(0,0,0,0.04);
}
.key:active { background: #ececec; }
.key-submit {
  grid-column: 4;
  grid-row: 1 / 3;
  border: 0;
  border-radius: 6px;
  background: #07c160;
  color: #fff;
  font-size: 18px;
  font-weight: 600;
  min-height: 100%;
}
.key-submit.rp { background: #fa5151; }
.key-submit:disabled { opacity: 0.4; }
.key-submit:not(:disabled):active { filter: brightness(0.95); }

/* 红包页键盘放在底部 */
.pay-page:not(.tf) .keypad {
  margin-top: auto;
}
.pay-page:not(.tf) .rp-mid { padding-bottom: 8px; }
</style>
