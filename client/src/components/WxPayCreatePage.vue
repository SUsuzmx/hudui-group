// 微信风红包/转账创建页: 拼手气/专属 + 封面 + 个数
<script setup>
import { computed } from 'vue';

const props = defineProps({
  kind: { type: String, default: 'redpacket' },
  amountText: { type: String, default: '' },
  note: { type: String, default: '' },
  peerName: { type: String, default: '' },
  peerWxid: { type: String, default: '' },
  peerAvatar: { type: String, default: null },
  balance: { type: [Number, String], default: null },
  submitting: { type: Boolean, default: false },
  rpType: { type: String, default: 'exclusive' }, // exclusive | lucky
  rpCount: { type: Number, default: 1 },
  cover: { type: String, default: 'classic' },
  isGroup: { type: Boolean, default: false },
});
const emit = defineEmits([
  'update:amountText',
  'update:note',
  'update:rpType',
  'update:rpCount',
  'update:cover',
  'submit',
  'close',
]);

const COVERS = [
  { id: 'classic', emoji: '🧧', label: '经典红包', from: '#e8534a', to: '#c20c0c' },
  { id: 'gold', emoji: '💰', label: '金色财富', from: '#f5a623', to: '#e08900' },
  { id: 'luck', emoji: '🍀', label: '好运连连', from: '#34c759', to: '#0f8a3c' },
  { id: 'love', emoji: '❤️', label: '甜蜜告白', from: '#fa5151', to: '#9b0c0c' },
  { id: 'fest', emoji: '🎊', label: '节日庆典', from: '#fa9d3b', to: '#e8534a' },
];

const isRP = computed(() => props.kind === 'redpacket');
const title = computed(() => (isRP.value ? '发红包' : '转账'));
const isLucky = computed(() => props.rpType === 'lucky');
const coverObj = computed(() => COVERS.find((c) => c.id === props.cover) || COVERS[0]);

const bigAmt = computed(() => String(props.amountText || '0.00'));

function onKey(k) {
  let t = String(props.amountText || '');
  if (k === 'del') t = t.slice(0, -1);
  else if (k === '.') {
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

function setRpType(t) {
  if (!isRP.value) return;
  emit('update:rpType', t);
  if (t === 'lucky' && Number(props.rpCount) < 2) emit('update:rpCount', props.isGroup ? 5 : 2);
  if (t === 'exclusive') emit('update:rpCount', 1);
}

function onCount(delta) {
  let n = Number(props.rpCount || 1) + delta;
  n = Math.max(1, Math.min(props.isGroup ? 50 : 10, n));
  emit('update:rpCount', n);
}

function pickCover(id) {
  emit('update:cover', id);
}

function canSubmit() {
  const amt = Number(props.amountText);
  if (!(amt > 0) || props.submitting) return false;
  if (isRP.value && isLucky.value) {
    return amt >= Number(props.rpCount || 1) * 0.01;
  }
  return true;
}

const countLabel = computed(() => {
  const amt = Number(props.amountText) || 0;
  const n = Number(props.rpCount) || 1;
  if (!isLucky.value) return '';
  return `总金额 ¥${amt.toFixed(2)} · ${n} 个 · 均值 ¥${(amt / n).toFixed(2)}`;
});
</script>

<template>
  <div class="pay-page" :class="{ tf: !isRP }">
    <header class="pay-nav">
      <button class="pay-back" type="button" aria-label="返回" @click="emit('close')">‹</button>
      <div class="pay-nav-title">{{ title }}</div>
      <div class="pay-nav-right"><span v-if="isRP" class="pay-more">···</span></div>
    </header>

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

    <template v-if="isRP">
      <!-- 拼手气 / 专属 -->
      <div class="rp-card type-card">
        <button type="button" class="type-btn" :class="{ on: !isLucky }" @click="setRpType('exclusive')">专属红包</button>
        <button type="button" class="type-btn" :class="{ on: isLucky }" @click="setRpType('lucky')">拼手气红包</button>
      </div>

      <div class="rp-card amount-card">
        <span class="rp-label">{{ isLucky ? '总金额' : '金额' }}</span>
        <span class="rp-amt" :class="{ empty: !amountText }">{{ amountText ? `¥${amountText}` : '¥0.00' }}</span>
      </div>

      <div v-if="isLucky" class="rp-card count-card">
        <span class="rp-label">红包个数</span>
        <div class="count-ctrl">
          <button type="button" @click="onCount(-1)">−</button>
          <span>{{ rpCount }}</span>
          <button type="button" @click="onCount(1)">+</button>
        </div>
      </div>
      <div v-if="isLucky && countLabel" class="count-hint">{{ countLabel }}</div>

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

      <div class="rp-card cover-card" style="display:block;padding:12px 16px">
        <div class="rp-label" style="margin-bottom:8px">红包封面</div>
        <div class="cover-grid">
          <button
            v-for="c in COVERS"
            :key="c.id"
            type="button"
            class="cover-item"
            :class="{ on: cover === c.id }"
            :style="{ background: `linear-gradient(135deg, ${c.from}, ${c.to})` }"
            @click="pickCover(c.id)"
          >
            <span class="cover-emoji">{{ c.emoji }}</span>
            <span class="cover-label">{{ c.label }}</span>
          </button>
        </div>
      </div>

      <div class="rp-mid" :style="{ background: `linear-gradient(180deg, ${coverObj.from}22, transparent)` }">
        <div class="rp-cover-preview" :style="{ background: `linear-gradient(135deg, ${coverObj.from}, ${coverObj.to})` }">
          <span class="cover-emoji-lg">{{ coverObj.emoji }}</span>
        </div>
        <div class="rp-big-amt"><span class="yen">¥</span>{{ bigAmt === '0.00' || !amountText ? '0.00' : bigAmt }}</div>
        <button class="rp-submit" type="button" :disabled="!canSubmit()" @click="emit('submit')">塞钱进红包</button>
      </div>
      <div class="pay-foot">可直接使用收到的零钱发红包 · 24 小时未领完将退回</div>
    </template>

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
        <div class="tf-hint">对方超过 24 小时未确认，金额将原路退回</div>
      </div>
    </template>

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
  position: fixed; inset: 0; z-index: 4000; background: #ededed;
  display: flex; flex-direction: column; overflow: auto; color: #191919;
}
.pay-nav {
  flex-shrink: 0; height: 48px; display: flex; align-items: center; justify-content: center;
  position: relative; padding: 0 8px; background: #ededed;
}
.pay-back {
  position: absolute; left: 4px; top: 0; bottom: 0; width: 44px; border: 0;
  background: transparent; font-size: 28px; color: #191919; line-height: 1;
}
.pay-nav-title { font-size: 17px; font-weight: 600; }
.pay-nav-right { position: absolute; right: 12px; top: 0; bottom: 0; display: flex; align-items: center; }
.pay-more { font-size: 20px; letter-spacing: 1px; color: #191919; }
.rp-card {
  margin: 10px 16px 0; background: #fff; border-radius: 10px; min-height: 56px;
  display: flex; align-items: center; padding: 0 16px; box-sizing: border-box;
}
.rp-label { font-size: 17px; color: #191919; }
.rp-amt { margin-left: auto; font-size: 18px; color: #b2b2b2; }
.rp-note-input {
  flex: 1; border: 0; outline: none; background: transparent;
  font-size: 17px; color: #191919; min-height: 56px;
}
.rp-note-input::placeholder { color: #b2b2b2; }
.rp-emoji { margin-left: 8px; font-size: 22px; color: #b2b2b2; }
.cover-card { margin-top: 10px; margin-bottom: 8px; }
.type-card { padding: 6px; gap: 6px; }
.type-btn {
  flex: 1; min-height: 40px; border: 0; border-radius: 8px; background: #f2f2f2;
  color: #666; font-size: 14px;
}
.type-btn.on { background: rgba(250,81,81,0.12); color: #fa5151; font-weight: 600; }
.count-card { gap: 12px; }
.count-ctrl { margin-left: auto; display: flex; align-items: center; gap: 12px; }
.count-ctrl button {
  width: 32px; height: 32px; border-radius: 50%; border: 0; background: #f2f2f2; font-size: 18px; color: #191919;
}
.count-ctrl span { min-width: 24px; text-align: center; font-size: 17px; font-weight: 600; }
.count-hint { margin: 6px 20px 0; font-size: 12px; color: #888; }
.cover-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.cover-item {
  min-height: 64px; border: 2px solid transparent; border-radius: 8px; color: #fff;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
  font-size: 11px;
}
.cover-item.on { border-color: #191919; }
.cover-emoji { font-size: 22px; }
.cover-label { opacity: 0.95; }
.rp-mid {
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 20px 24px 12px; min-height: 200px;
}
.rp-cover-preview {
  width: 72px; height: 72px; border-radius: 16px; display: flex; align-items: center; justify-content: center;
  margin-bottom: 12px; box-shadow: 0 8px 20px rgba(0,0,0,0.15);
}
.cover-emoji-lg { font-size: 36px; }
.rp-big-amt {
  font-size: 48px; font-weight: 700; letter-spacing: -1px; color: #000; margin-bottom: 20px;
}
.rp-big-amt .yen { font-size: 36px; font-weight: 600; margin-right: 4px; }
.rp-submit {
  width: min(280px, 72vw); min-height: 50px; border: 0; border-radius: 8px;
  background: #fa5151; color: #fff; font-size: 18px; font-weight: 500;
}
.rp-submit:disabled { opacity: 0.45; }
.pay-foot { text-align: center; font-size: 12px; color: #b2b2b2; padding: 8px 16px 20px; }
.tf-peer { display: flex; align-items: center; gap: 12px; padding: 20px 20px 24px; background: #ededed; }
.tf-peer-main { flex: 1; min-width: 0; }
.tf-peer-title { font-size: 20px; font-weight: 600; color: #191919; line-height: 1.35; }
.tf-peer-wx { margin-top: 8px; font-size: 14px; color: #888; }
.tf-peer-avatar {
  width: 56px; height: 56px; border-radius: 6px; overflow: hidden; background: #07c160; color: #fff;
  display: flex; align-items: center; justify-content: center; font-size: 22px; font-weight: 600; flex-shrink: 0;
}
.tf-peer-avatar img { width: 100%; height: 100%; object-fit: cover; }
.tf-sheet {
  background: #fff; border-radius: 12px 12px 0 0; padding: 22px 20px 16px; flex: 1;
}
.tf-field-label { font-size: 15px; color: #888; }
.tf-amount-row { display: flex; align-items: center; gap: 8px; margin-top: 14px; padding-bottom: 10px; }
.tf-yen { font-size: 40px; font-weight: 700; color: #000; }
.tf-amount-input {
  flex: 1; border: 0; outline: none; font-size: 40px; font-weight: 600; color: #07c160;
  background: transparent; min-width: 0; caret-color: #07c160;
}
.tf-divider { height: 1px; background: #ececec; }
.tf-note-btn { width: 100%; border: 0; background: transparent; padding: 16px 0 8px; text-align: left; }
.tf-note-input {
  width: 100%; border: 0; outline: none; background: transparent; font-size: 16px; color: #576b95;
}
.tf-hint { margin-top: 16px; font-size: 12px; color: #b2b2b2; }
.keypad {
  flex-shrink: 0; background: #f7f7f7; padding: 8px 6px calc(8px + env(safe-area-inset-bottom, 0px));
  display: grid; grid-template-columns: 1fr 1fr 1fr 1.05fr; gap: 6px; position: sticky; bottom: 0;
}
.keypad-grid { grid-column: 1 / 4; display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.key {
  min-height: 48px; border: 0; border-radius: 6px; background: #fff; font-size: 22px;
  font-weight: 500; color: #191919; box-shadow: 0 1px 0 rgba(0,0,0,0.04);
}
.key-submit {
  grid-column: 4; grid-row: 1 / 3; border: 0; border-radius: 6px; background: #07c160;
  color: #fff; font-size: 18px; font-weight: 600; min-height: 100%;
}
.key-submit.rp { background: #fa5151; }
.key-submit:disabled { opacity: 0.4; }
.pay-page:not(.tf) .keypad { margin-top: auto; }
.pay-page:not(.tf) .rp-mid { padding-bottom: 8px; }
</style>
