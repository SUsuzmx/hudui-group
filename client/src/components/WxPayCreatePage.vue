// 发红包 / 转账 创建页：按微信截图复刻
<script setup>
import { computed, ref } from 'vue';
import UserAvatar from './UserAvatar.vue';

const props = defineProps({
  kind: { type: String, default: 'redpacket' },
  amountText: { type: String, default: '' },
  note: { type: String, default: '' },
  peerName: { type: String, default: '' },
  peerWxid: { type: String, default: '' },
  peerAvatar: { type: String, default: null },
  balance: { type: [Number, String], default: null },
  submitting: { type: Boolean, default: false },
  rpType: { type: String, default: 'exclusive' },
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
const coverObj = computed(() => COVERS.find((c) => c.id === props.cover) || COVERS[0]);
const showCoverSheet = ref(false);
// 红包默认不显示键盘，点金额后展开；转账页默认展开键盘
const keypadOpen = ref(props.kind !== 'redpacket');

const amountDisplay = computed(() => {
  const t = String(props.amountText || '').trim();
  return t || '0.00';
});

const canSubmit = computed(() => {
  const amt = Number(props.amountText);
  return Number.isFinite(amt) && amt > 0 && !props.submitting;
});

function onKey(k) {
  let t = String(props.amountText || '');
  if (k === 'del') t = t.slice(0, -1);
  else if (k === '.') {
    if (t.includes('.')) return;
    t = t ? `${t}.` : '0.';
  } else {
    if (t.includes('.') && t.split('.')[1]?.length >= 2) return;
    t = t === '0' ? k : t + k;
    const num = Number(t);
    if (Number.isFinite(num) && num > 99999.99) return;
  }
  emit('update:amountText', t);
}

function openAmountKeypad() {
  keypadOpen.value = true;
}

function pickCover(id) {
  emit('update:cover', id);
  showCoverSheet.value = false;
}

function onMore() {
  if (!isRP.value) return;
  const lucky = props.isGroup && props.rpType !== 'lucky';
  if (lucky) {
    emit('update:rpType', 'lucky');
    emit('update:rpCount', Math.max(2, Number(props.rpCount) || 2));
  } else {
    emit('update:rpType', 'exclusive');
    emit('update:rpCount', 1);
  }
}

function maskName(name) {
  const n = String(name || '好友');
  if (n.length <= 2) return `${n.slice(0, 1)}(**)`;
  return `${n.slice(0, 2)}(**${n.slice(-1)})`;
}
</script>

<template>
  <div class="pay-page" :class="{ 'is-tf': !isRP }">
    <!-- 发红包 -->
    <template v-if="isRP">
      <header class="nav rp-nav">
        <button class="nav-back" type="button" aria-label="返回" @click="emit('close')">
          <svg viewBox="0 0 24 24" width="24" height="24"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <div class="nav-title">发红包</div>
        <button class="nav-more" type="button" aria-label="更多" @click="onMore">
          <svg viewBox="0 0 24 24" width="22" height="22"><circle cx="5" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="19" cy="12" r="1.8" fill="currentColor"/></svg>
        </button>
      </header>

      <main class="rp-body">
        <button class="rp-card amount-card" type="button" @click="openAmountKeypad">
          <span class="rp-label">金额</span>
          <span class="rp-amt" :class="{ empty: !amountText }">¥{{ amountDisplay }}</span>
        </button>

        <div class="rp-card note-card">
          <input
            class="rp-note-input"
            type="text"
            maxlength="30"
            :value="note"
            placeholder="恭喜发财，大吉大利"
            @input="emit('update:note', $event.target.value)"
          />
          <span class="rp-emoji-btn" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.5">
              <circle cx="12" cy="12" r="9"/>
              <circle cx="9" cy="10.5" r="0.9" fill="currentColor" stroke="none"/>
              <circle cx="15" cy="10.5" r="0.9" fill="currentColor" stroke="none"/>
              <path d="M8.2 14c1.1 1.5 2.4 2.2 3.8 2.2s2.7-.7 3.8-2.2" stroke-linecap="round"/>
              <path d="M18.5 7.5h3M20 6v3" stroke-linecap="round"/>
            </svg>
          </span>
        </div>

        <button class="rp-card cover-card" type="button" @click="showCoverSheet = true">
          <span class="rp-label">红包封面</span>
          <span class="cell-arrow"></span>
        </button>

        <div class="rp-mid">
          <div class="rp-big">
            <span class="yen">¥</span>{{ amountDisplay }}
          </div>
          <button
            class="rp-submit"
            type="button"
            :disabled="!canSubmit"
            @click="emit('submit')"
          >塞钱进红包</button>
        </div>

        <div class="rp-foot">未领取的红包，将于24小时后发起退款</div>
      </main>

      <div v-if="keypadOpen" class="keypad">
        <div class="keypad-grid">
          <button class="key" type="button" @click="onKey('1')">1</button>
          <button class="key" type="button" @click="onKey('2')">2</button>
          <button class="key" type="button" @click="onKey('3')">3</button>
          <button class="key" type="button" @click="onKey('4')">4</button>
          <button class="key" type="button" @click="onKey('5')">5</button>
          <button class="key" type="button" @click="onKey('6')">6</button>
          <button class="key" type="button" @click="onKey('7')">7</button>
          <button class="key" type="button" @click="onKey('8')">8</button>
          <button class="key" type="button" @click="onKey('9')">9</button>
          <button class="key zero" type="button" @click="onKey('0')">0</button>
          <button class="key dot" type="button" @click="onKey('.')">.</button>
        </div>
        <div class="keypad-side">
          <button class="key del" type="button" aria-label="删除" @click="onKey('del')">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6">
              <path d="M9 6h10a2 2 0 012 2v8a2 2 0 01-2 2H9l-6-6 6-6z"/>
              <path d="M13 10l4 4M17 10l-4 4" stroke-linecap="round"/>
            </svg>
          </button>
          <button
            class="key-submit rp"
            type="button"
            :disabled="!canSubmit"
            @click="emit('submit')"
          >塞钱进红包</button>
        </div>
      </div>

      <div v-if="showCoverSheet" class="sheet-mask" @click.self="showCoverSheet = false">
        <div class="cover-sheet">
          <div class="sheet-title">红包封面</div>
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
          <button class="sheet-cancel" type="button" @click="showCoverSheet = false">取消</button>
        </div>
      </div>
    </template>

    <!-- 转账 -->
    <template v-else>
      <header class="nav tf-nav">
        <button class="nav-back" type="button" aria-label="返回" @click="emit('close')">
          <svg viewBox="0 0 24 24" width="24" height="24"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </header>

      <div class="tf-peer">
        <div class="tf-peer-main">
          <div class="tf-peer-title">转账给 {{ maskName(peerName) }}</div>
          <div class="tf-peer-wx">微信号: {{ peerWxid || '—' }}</div>
        </div>
        <div class="tf-peer-avatar">
          <UserAvatar
            :name="peerName || '友'"
            :avatar="peerAvatar"
            :size="64"
          />
        </div>
      </div>

      <div class="tf-sheet">
        <div class="tf-label">转账金额</div>
        <div class="tf-amount" @click="keypadOpen = true">
          <span class="tf-yen">¥</span>
          <span class="tf-num" :class="{ empty: !amountText }">{{ amountText }}</span>
        </div>
        <div class="tf-divider"></div>
        <input
          class="tf-note"
          type="text"
          maxlength="30"
          :value="note"
          placeholder="添加转账说明"
          @input="emit('update:note', $event.target.value)"
        />
      </div>

      <div class="keypad tf-keypad">
        <div class="keypad-grid">
          <button class="key" type="button" @click="onKey('1')">1</button>
          <button class="key" type="button" @click="onKey('2')">2</button>
          <button class="key" type="button" @click="onKey('3')">3</button>
          <button class="key" type="button" @click="onKey('4')">4</button>
          <button class="key" type="button" @click="onKey('5')">5</button>
          <button class="key" type="button" @click="onKey('6')">6</button>
          <button class="key" type="button" @click="onKey('7')">7</button>
          <button class="key" type="button" @click="onKey('8')">8</button>
          <button class="key" type="button" @click="onKey('9')">9</button>
          <button class="key zero" type="button" @click="onKey('0')">0</button>
          <button class="key dot" type="button" @click="onKey('.')">.</button>
        </div>
        <div class="keypad-side">
          <button class="key del" type="button" aria-label="删除" @click="onKey('del')">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6">
              <path d="M9 6h10a2 2 0 012 2v8a2 2 0 01-2 2H9l-6-6 6-6z"/>
              <path d="M13 10l4 4M17 10l-4 4" stroke-linecap="round"/>
            </svg>
          </button>
          <button
            class="key-submit"
            type="button"
            :disabled="!canSubmit"
            @click="emit('submit')"
          >转账</button>
        </div>
      </div>
    </template>
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

.nav {
  flex-shrink: 0;
  height: calc(var(--nav-h, 44px) + env(safe-area-inset-top, 0px));
  padding-top: env(safe-area-inset-top, 0px);
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  background: #ededed;
}
.nav-back {
  position: absolute;
  left: 2px;
  top: env(safe-area-inset-top, 0px);
  bottom: 0;
  width: 44px;
  border: 0;
  background: transparent;
  color: #191919;
  display: flex;
  align-items: center;
  justify-content: center;
}
.nav-title {
  font-size: 17px;
  font-weight: 600;
}
.nav-more {
  position: absolute;
  right: 4px;
  top: env(safe-area-inset-top, 0px);
  bottom: 0;
  width: 44px;
  border: 0;
  background: transparent;
  color: #191919;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 发红包 */
.rp-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding-bottom: 8px;
}
.rp-card {
  margin: 14px 16px 0;
  background: #fff;
  border-radius: 12px;
  min-height: 64px;
  display: flex;
  align-items: center;
  padding: 0 20px;
  box-sizing: border-box;
  border: 0;
  width: calc(100% - 32px);
  text-align: left;
}
.rp-label {
  font-size: 18px;
  font-weight: 500;
  color: #191919;
}
.rp-amt {
  margin-left: auto;
  font-size: 20px;
  color: #b2b2b2;
  font-weight: 400;
}
.rp-amt.empty { color: #b2b2b2; }
.rp-note-input {
  flex: 1;
  border: 0;
  outline: none;
  background: transparent;
  font-size: 18px;
  color: #191919;
  min-height: 64px;
}
.rp-note-input::placeholder { color: #b2b2b2; }
.rp-emoji-btn {
  color: #b2b2b2;
  display: flex;
  align-items: center;
  margin-left: 8px;
}
.cell-arrow {
  width: 8px;
  height: 8px;
  border-right: 1.5px solid #c7c7cc;
  border-top: 1.5px solid #c7c7cc;
  transform: rotate(45deg);
  margin-left: auto;
  flex-shrink: 0;
}
.rp-mid {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px 24px 8px;
  min-height: 180px;
}
.rp-big {
  font-size: 48px;
  font-weight: 700;
  color: #000;
  letter-spacing: -1px;
  margin-bottom: 28px;
  line-height: 1.1;
}
.rp-big .yen {
  font-size: 36px;
  font-weight: 600;
  margin-right: 2px;
}
.rp-submit {
  width: min(280px, 70vw);
  min-height: 52px;
  border: 0;
  border-radius: 8px;
  background: #f05a5a;
  color: #fff;
  font-size: 18px;
  font-weight: 500;
}
.rp-submit:disabled { opacity: 0.45; }
.rp-foot {
  text-align: center;
  font-size: 14px;
  color: #888;
  padding: 12px 16px 20px;
}

/* 转账 */
.tf-nav { background: #ededed; }
.tf-peer {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  padding: 28px 24px 28px;
  background: #ededed;
}
.tf-peer-main { flex: 1; min-width: 0; padding-top: 4px; }
.tf-peer-title {
  font-size: 24px;
  font-weight: 700;
  color: #191919;
  line-height: 1.3;
}
.tf-peer-wx {
  margin-top: 10px;
  font-size: 16px;
  color: #888;
}
.tf-peer-avatar {
  width: 64px;
  height: 64px;
  border-radius: 6px;
  overflow: hidden;
  flex-shrink: 0;
  background: #ddd;
}
.tf-peer-avatar :deep(.avatar) { border-radius: 6px !important; }

.tf-sheet {
  background: #fff;
  border-radius: 12px 12px 0 0;
  padding: 28px 24px 20px;
  flex: 1;
  min-height: 0;
}
.tf-label {
  font-size: 16px;
  color: #191919;
  font-weight: 500;
}
.tf-amount {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-top: 22px;
  padding-bottom: 16px;
  min-height: 48px;
}
.tf-yen {
  font-size: 42px;
  font-weight: 700;
  color: #000;
  line-height: 1;
}
.tf-num {
  font-size: 42px;
  font-weight: 700;
  color: #000;
  line-height: 1;
  min-height: 42px;
}
.tf-num.empty { color: transparent; }
.tf-divider {
  height: 1px;
  background: #ececec;
}
.tf-note {
  width: 100%;
  border: 0;
  outline: none;
  background: transparent;
  margin-top: 22px;
  font-size: 17px;
  color: #576b95;
  min-height: 28px;
}
.tf-note::placeholder { color: #576b95; }

/* 键盘 */
.keypad {
  flex-shrink: 0;
  background: #d1d5db;
  padding: 6px 6px calc(6px + env(safe-area-inset-bottom, 0px));
  display: grid;
  grid-template-columns: 1fr 1fr 1fr 0.92fr;
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
.keypad-side {
  grid-column: 4;
  display: grid;
  grid-template-rows: auto 1fr;
  gap: 6px;
}
.key {
  min-height: 52px;
  border: 0;
  border-radius: 6px;
  background: #fff;
  font-size: 24px;
  font-weight: 500;
  color: #111;
  box-shadow: 0 1px 0 rgba(0,0,0,0.06);
}
.key.zero { grid-column: 1 / 3; }
.key.dot { grid-column: 3; }
.key.del {
  min-height: 52px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #111;
}
.key-submit {
  border: 0;
  border-radius: 6px;
  background: #4cd964;
  color: #fff;
  font-size: 20px;
  font-weight: 600;
  min-height: 100%;
  grid-row: 2;
}
.key-submit.rp { background: #f05a5a; }
.key-submit:disabled { opacity: 0.4; }

/* 红包封面 sheet */
.sheet-mask {
  position: fixed;
  inset: 0;
  z-index: 4100;
  background: rgba(0,0,0,0.45);
  display: flex;
  align-items: flex-end;
}
.cover-sheet {
  width: 100%;
  background: #fff;
  border-radius: 12px 12px 0 0;
  padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px));
}
.sheet-title {
  padding: 16px;
  text-align: center;
  font-size: 16px;
  font-weight: 600;
  border-bottom: 0.5px solid #eee;
}
.cover-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  padding: 14px;
}
.cover-item {
  min-height: 72px;
  border: 2px solid transparent;
  border-radius: 10px;
  color: #fff;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 12px;
}
.cover-item.on { border-color: #191919; }
.cover-emoji { font-size: 26px; }
.sheet-cancel {
  width: calc(100% - 28px);
  margin: 0 14px 8px;
  min-height: 48px;
  border: 0;
  border-radius: 8px;
  background: #f2f2f2;
  color: #191919;
  font-size: 16px;
}
</style>
