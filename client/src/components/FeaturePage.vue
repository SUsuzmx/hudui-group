<script setup>
import { computed, ref, onMounted } from 'vue';
import { api } from '../api.js';
import UserAvatar from './UserAvatar.vue';

const props = defineProps({
  type: { type: String, required: true },
  me: { type: Object, default: null },
});
const emit = defineEmits(['back']);

const meta = computed(() => {
  const map = {
    favorites: { title: '收藏', icon: '⭐', empty: '暂无收藏', tip: '在聊天中长按消息可收藏' },
    services: { title: '服务', icon: '💳', empty: '', tip: '' },
    cards: { title: '卡包', icon: '🎴', empty: '暂无卡券', tip: '会员卡、优惠券会出现在这里' },
    stickers: { title: '表情', icon: '😊', empty: '暂无添加的表情', tip: '可在这里管理收藏的表情' },
    scan: { title: '扫一扫', icon: '▦', empty: '对准好友二维码添加', tip: '演示环境请用「添加朋友 → 搜索微信号」' },
    nearby: { title: '附近的人', icon: '📍', empty: '附近暂无更多人', tip: '演示环境不获取真实位置' },
    shopping: { title: '购物', icon: '🛒', empty: '暂无购物内容', tip: '' },
    games: { title: '游戏', icon: '🎮', empty: '暂无游戏', tip: '' },
    miniapp: { title: '小程序', icon: '📦', empty: '暂无使用过的小程序', tip: '' },
    look: { title: '看一看', icon: '👀', empty: '暂无推荐内容', tip: '' },
    search: { title: '搜一搜', icon: '🔍', empty: '请从微信首页搜索框使用全局搜索', tip: '联系人、群聊、聊天记录一处搜' },
    tags: { title: '标签', icon: '🏷', empty: '暂无标签', tip: '给联系人分组管理' },
    official: { title: '公众号', icon: '📢', empty: '暂无关注的公众号', tip: '' },
    newfriends: { title: '新的朋友', icon: '👤', empty: '暂无新的朋友申请', tip: '可通过用户 ID 添加' },
    status: { title: '状态', icon: '💬', empty: '未设置状态', tip: '设置此刻的心情或状态' },
    album: { title: '相册', icon: '🖼', empty: '暂无照片', tip: '朋友圈图片会汇总到这里' },
    wallet: { title: '钱包', icon: '💰', empty: '¥ 0.00 · 演示钱包', tip: '演示环境无真实支付' },
  };
  return map[props.type] || { title: '功能页', icon: '💬', empty: '建设中', tip: '' };
});

const demoList = ref([]);
const status = ref('');
const tagName = ref('');
const pending = ref(0);
const addUserId = ref('');
const friendOptions = ref([]);
const editingTag = ref(null);
const tagChecked = ref({});
const walletBalance = ref(0);
const walletTxs = ref([]);
const servicesBalance = ref(null);
const favPreview = ref(null);
const scanCode = ref('');
const scanResult = ref(null);
const scanMsg = ref('');
const scanning = ref(false);
const albumImages = ref([]);
const albumPreview = ref(null);
const paySheet = ref(null); // { note, amount }
const payAmountText = ref('');
const payBusy = ref(false);
let scanStream = null;
let scanTimer = null;

async function refresh() {
  status.value = 'loading';
  try {
    if (props.type === 'newfriends') {
      const data = await api.friendRequests();
      const list = [];
      for (const r of data.incoming || []) {
        if (r.status !== 'pending') continue;
        list.push({
          key: 'req-' + r.id,
          title: r.user?.nickname || '用户',
          sub: r.message || '请求添加你为朋友',
          action: 'accept',
          reqId: r.id,
        });
      }
      demoList.value = list;
      pending.value = data.pending || 0;
    } else if (props.type === 'tags') {
      const data = await api.tags();
      const allFriends = await api.friends().catch(() => ({ friends: [] }));
      friendOptions.value = (allFriends.friends || []).map((f) => ({
        id: f.id,
        name: f.displayName || f.nickname,
        avatar: f.avatar,
        color: f.avatarColor,
      }));
      demoList.value = (data.tags || []).map((t) => ({
        key: 'tag-' + t.id,
        title: t.name,
        sub: `${(t.members || []).length} 位联系人`,
        action: 'open-tag',
        tagId: t.id,
        members: t.members || [],
      }));
    } else if (props.type === 'favorites') {
      const data = await api.favorites();
      demoList.value = (data.favorites || []).map((f) => ({
        key: 'fav-' + f.id,
        title: f.content || (f.kind === 'image' ? '[图片]' : f.kind === 'voice' ? '[语音]' : '收藏'),
        sub: `${f.fromName || f.kind}${f.mediaUrl ? ' · 含媒体' : ''}`,
        action: 'fav-open',
        favId: f.id,
        mediaUrl: f.mediaUrl,
        kind: f.kind,
        content: f.content,
      }));
    } else if (props.type === 'wallet') {
      try {
        const w = await api.wallet();
        walletBalance.value = w.balance ?? 0;
        walletTxs.value = (w.txs || []).map((t) => ({
          id: t.id,
          type: t.type,
          amount: t.amount,
          note: t.note,
          createdAt: t.createdAt,
        }));
      } catch {
        walletBalance.value = 0;
        walletTxs.value = [];
      }
      demoList.value = [];
    } else if (props.type === 'official') {
      const data = await api.official();
      demoList.value = (data.official || []).map((o) => ({
        key: 'oa-' + o.id,
        title: o.name,
        sub: o.intro + (o.followed ? ' · 已关注' : ''),
        action: 'oa',
        oaId: o.id,
        followed: o.followed,
      }));
    } else if (props.type === 'status') {
      demoList.value = [
        { key: 's1', title: '😊 心情不错', sub: '点击设置', action: 'status', val: '心情不错' },
        { key: 's2', title: '😷 有点累', sub: '点击设置', action: 'status', val: '有点累' },
        { key: 's3', title: '🎯 专注中', sub: '点击设置', action: 'status', val: '专注中' },
      ];
    } else if (props.type === 'services') {
      try {
        const w = await api.wallet();
        servicesBalance.value = w.balance ?? 0;
        walletBalance.value = w.balance ?? 0;
        walletTxs.value = (w.txs || []).map((t) => ({
          id: t.id,
          type: t.type,
          amount: t.amount,
          note: t.note,
          createdAt: t.createdAt,
        }));
      } catch {
        servicesBalance.value = 0;
      }
      demoList.value = [
        { key: 'w', title: '收付款', icon: '💳', action: 'wallet', sub: '零钱收付与流水' },
        { key: 'b', title: '钱包', icon: '💰', action: 'wallet', sub: `余额 ¥${Number(servicesBalance.value || 0).toFixed(2)}` },
        { key: 'm', title: '手机充值', icon: '📱', action: 'pay', pay: { note: '手机充值', amount: 50 } },
        { key: 'l', title: '生活缴费', icon: '🏠', action: 'pay', pay: { note: '生活缴费', amount: 100 } },
        { key: 'q', title: 'Q币充值', icon: '🪙', action: 'pay', pay: { note: 'Q币充值', amount: 30 } },
        { key: 't', title: '交通出行', icon: '🚌', action: 'pay', pay: { note: '交通出行', amount: 20 } },
      ];
    } else if (props.type === 'cards') {
      demoList.value = [
        { key: '1', title: '交通卡', sub: '未添加', action: 'noop' },
        { key: '2', title: '会员卡', sub: '未添加', action: 'noop' },
        { key: '3', title: '优惠券', sub: '未添加', action: 'noop' },
      ];
    } else if (props.type === 'stickers') {
      demoList.value = [
        { key: '1', title: '添加的表情', sub: '0', action: 'noop' },
        { key: '2', title: '聊天输入面板中的表情', sub: '已内置', action: 'noop' },
      ];
    } else if (props.type === 'album') {
      try {
        const data = await api.myMoments();
        const imgs = [];
        for (const m of data.moments || []) {
          for (const u of m.images || []) imgs.push({ url: u, momentId: m.id, createdAt: m.createdAt });
        }
        albumImages.value = imgs.slice(0, 60);
      } catch {
        albumImages.value = [];
      }
      demoList.value = [];
    }
    status.value = '';
  } catch (e) {
    status.value = e.message || '加载失败';
    demoList.value = [];
  }
}

onMounted(refresh);

async function onItem(item) {
  if (!item) return;
  if (item.action === 'add') {
    emit('back', { then: 'add-friend' });
    return;
  }
  if (item.action === 'group') {
    emit('back', { then: 'create-group' });
    return;
  }
  if (item.action === 'accept') {
    try {
      await api.handleFriendRequest(item.reqId, 'accept');
      demoList.value = demoList.value.filter((x) => x.key !== item.key);
      pending.value = Math.max(0, pending.value - 1);
    } catch (e) {
      alert(e.message);
    }
    return;
  }
  if (item.action === 'reject') {
    try {
      await api.handleFriendRequest(item.reqId, 'reject');
      demoList.value = demoList.value.filter((x) => x.key !== item.key);
      pending.value = Math.max(0, pending.value - 1);
    } catch (e) {
      alert(e.message);
    }
    return;
  }
  if (item.action === 'oa') {
    try {
      if (item.followed) {
        await api.unfollowOfficial(item.oaId);
      } else {
        await api.followOfficial(item.oaId);
      }
      await refresh();
    } catch (e) {
      alert(e.message);
    }
    return;
  }
  if (item.action === 'open-tag') {
    const selected = {};
    for (const uid of item.members || []) selected[uid] = true;
    editingTag.value = { tagId: item.tagId, title: item.title };
    tagChecked.value = selected;
    return;
  }
  if (item.action === 'fav-open') {
    if (item.mediaUrl && item.kind === 'image') {
      favPreview.value = item.mediaUrl;
      return;
    }
    if (item.mediaUrl) {
      window.open(item.mediaUrl, '_blank');
      return;
    }
    alert(item.content || '收藏内容');
    return;
  }
  if (item.action === 'fav-del') {
    try {
      await api.removeFavorite(item.favId);
      demoList.value = demoList.value.filter((x) => x.favId !== item.favId);
    } catch (e) {
      alert(e.message);
    }
    return;
  }
  if (item.action === 'status') {
    try {
      await api.updateMe({ signature: item.val });
      alert('状态已设置');
    } catch (e) {
      alert(e.message);
    }
    return;
  }
  if (item.action === 'wallet') {
    emit('back', { then: 'wallet' });
    return;
  }
  if (item.action === 'pay') {
    paySheet.value = { note: item.pay.note, amount: item.pay.amount };
    payAmountText.value = String(item.pay.amount);
    return;
  }
}

async function confirmPay() {
  const amount = Number(payAmountText.value);
  if (!(amount >= 0.01) || payBusy.value) {
    alert('请输入有效金额');
    return;
  }
  const note = paySheet.value?.note || '消费';
  payBusy.value = true;
  try {
    const d = await api.walletPay(amount, note);
    paySheet.value = null;
    walletBalance.value = d.balance ?? walletBalance.value;
    servicesBalance.value = d.balance ?? servicesBalance.value;
    if (props.type === 'services' || props.type === 'wallet') {
      try {
        const w = await api.wallet();
        walletBalance.value = w.balance ?? walletBalance.value;
        servicesBalance.value = w.balance ?? servicesBalance.value;
        walletTxs.value = (w.txs || []).map((t) => ({
          id: t.id,
          type: t.type,
          amount: t.amount,
          note: t.note,
          createdAt: t.createdAt,
        }));
      } catch { /* keep last balance */ }
    }
    if (props.type === 'services') await refresh();
    alert(`支付成功，零钱余额 ¥${Number(d.balance ?? walletBalance.value).toFixed(2)}`);
  } catch (e) {
    alert(e.message || '支付失败');
  } finally {
    payBusy.value = false;
  }
}

async function runScan() {
  const code = (scanCode.value || '').trim();
  if (!code) return;
  scanning.value = true;
  scanMsg.value = '';
  scanResult.value = null;
  try {
    const data = await api.resolveUser(code);
    scanResult.value = data.user;
  } catch (e) {
    scanMsg.value = e.message || '未识别';
  } finally {
    scanning.value = false;
  }
}

async function addFromScan() {
  if (!scanResult.value?.id) return;
  try {
    if (scanResult.value.isFriend) {
      scanMsg.value = '你们已经是好友';
      return;
    }
    await api.addFriend(scanResult.value.id);
    scanResult.value = { ...scanResult.value, isFriend: true };
    scanMsg.value = `已添加「${scanResult.value.nickname}」`;
  } catch (e) {
    scanMsg.value = e.message;
  }
}

function onScanFile(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  if (!('BarcodeDetector' in window)) {
    scanMsg.value = '当前浏览器不支持扫码识别，请粘贴名片码';
    return;
  }
  const detector = new BarcodeDetector({ formats: ['qr_code'] });
  createImageBitmap(file)
    .then((bmp) => detector.detect(bmp))
    .then((codes) => {
      const raw = codes?.[0]?.rawValue;
      if (!raw) {
        scanMsg.value = '未识别到二维码';
        return;
      }
      scanCode.value = raw;
      return runScan();
    })
    .catch(() => {
      scanMsg.value = '识别失败，请改用粘贴名片码';
    });
}

function fmtTxType(t) {
  return {
    redpacket_send: '发出红包',
    redpacket_claim: '领取红包',
    transfer_send: '转出',
    transfer_claim: '收款',
    pay: '消费支付',
    debit: '支出',
    credit: '收入',
  }[t] || t;
}

function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getMonth() + 1}-${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

async function createTag() {
  const name = tagName.value.trim();
  if (!name) return;
  try {
    await api.createTag(name);
    tagName.value = '';
    await refresh();
  } catch (e) {
    alert(e.message);
  }
}

async function sendRequest() {
  const id = Number(addUserId.value);
  if (!id) {
    alert('请输入用户 ID');
    return;
  }
  try {
    await api.sendFriendRequest(id, '我是' + (props.me?.nickname || ''));
    alert('已发送申请');
    addUserId.value = '';
    await refresh();
  } catch (e) {
    alert(e.message);
  }
}

function toggleTagUser(id) {
  tagChecked.value = { ...tagChecked.value, [id]: !tagChecked.value[id] };
}

async function saveTagMembers() {
  if (!editingTag.value) return;
  const members = Object.keys(tagChecked.value)
    .filter((k) => tagChecked.value[k])
    .map(Number);
  try {
    await api.setTagMembers(editingTag.value.tagId, members);
    editingTag.value = null;
    await refresh();
  } catch (e) {
    alert(e.message);
  }
}
</script>

<template>
  <div class="page">
    <header class="nav-bar">
      <button class="icon-btn nav-back" @click="emit('back')">
        <svg viewBox="0 0 24 24" width="24" height="24"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <div class="nav-title">{{ meta.title }}</div>
      <div class="nav-right"></div>
    </header>

    <main v-if="type === 'scan'" class="content scroll-y scan-page">
      <div class="scan-frame">
        <div class="scan-corners"></div>
        <div class="scan-line"></div>
      </div>
      <p class="scan-tip">对准好友的二维码名片，或粘贴名片码</p>
      <div class="tag-add">
        <input v-model="scanCode" placeholder="hudui:U:id:wxid / 微信号 / 昵称" />
        <button :disabled="scanning || !scanCode.trim()" @click="runScan">解析</button>
      </div>
      <div class="tag-add">
        <input type="file" accept="image/*" @change="onScanFile" />
      </div>
      <p v-if="scanMsg" class="empty-tip">{{ scanMsg }}</p>
      <div v-if="scanResult" class="cell-group scan-result">
        <div class="cell-row">
          <span class="cell-label">
            {{ scanResult.nickname }}
            <span class="cell-sub">微信号 {{ scanResult.wxid || '未设置' }}</span>
          </span>
        </div>
        <button class="scan-add" type="button" :disabled="scanResult.isFriend" @click="addFromScan">
          {{ scanResult.isFriend ? '已是好友' : '添加好友' }}
        </button>
      </div>
    </main>

    <main v-else-if="type === 'wallet'" class="content scroll-y">
      <div class="wallet-card">
        <div class="wallet-label">零钱（演示）</div>
        <div class="wallet-amount">¥ {{ Number(walletBalance || 0).toFixed(2) }}</div>
        <div class="wallet-tip">红包发送会扣零钱，领取/收款会入账</div>
      </div>
      <div v-if="walletTxs.length" class="cell-group">
        <div class="sec-title">交易记录</div>
        <div v-for="t in walletTxs" :key="t.id" class="cell-row tx-row">
          <span class="cell-label">
            {{ fmtTxType(t.type) }}
            <span class="cell-sub">{{ t.note }} · {{ fmtTime(t.createdAt) }}</span>
          </span>
          <span class="tx-amt" :class="t.amount < 0 ? 'neg' : 'pos'">
            {{ t.amount < 0 ? '' : '+' }}{{ Number(t.amount).toFixed(2) }}
          </span>
        </div>
      </div>
      <div v-else class="empty-wrap">
        <div class="empty-icon">💰</div>
        <div class="empty-text">暂无交易</div>
        <div class="empty-tip">在聊天中发送红包/转账即可产生流水</div>
      </div>
      <div class="cell-group">
        <div class="cell-row"><span class="cell-label">银行卡</span><span class="cell-value">未绑定</span></div>
        <div class="cell-row"><span class="cell-label">说明</span><span class="cell-value">演示账本，无真实支付</span></div>
      </div>
    </main>

    <main v-else-if="type === 'album'" class="content scroll-y">
      <div v-if="albumImages.length" class="album-grid">
        <button
          v-for="(img, i) in albumImages"
          :key="i"
          type="button"
          class="album-cell"
          @click="albumPreview = img.url"
        >
          <img :src="img.url" alt="" loading="lazy" />
        </button>
      </div>
      <div v-else class="empty-wrap">
        <div class="empty-icon">🖼</div>
        <div class="empty-text">暂无照片</div>
        <div class="empty-tip">发表朋友圈带图后，图片会汇总到这里</div>
      </div>
      <button v-if="albumImages.length" class="album-go" type="button" @click="emit('back', { then: 'moments' })">
        去朋友圈发一张
      </button>
    </main>

    <main v-else class="content scroll-y">
      <div v-if="type === 'tags'" class="tag-add">
        <input v-model="tagName" placeholder="新建标签名" maxlength="12" />
        <button @click="createTag">添加</button>
      </div>

      <div v-if="type === 'newfriends'" class="tag-add">
        <input v-model="addUserId" placeholder="输入用户 ID 申请添加" />
        <button @click="sendRequest">发送申请</button>
      </div>

      <div v-if="type === 'newfriends'" class="cell-group">
        <button class="cell-row" type="button" @click="onItem({ action: 'add' })">
          <span class="cell-label">添加朋友<span class="cell-sub">搜索微信号 / 昵称添加</span></span>
          <span class="arrow">›</span>
        </button>
        <button class="cell-row" type="button" @click="onItem({ action: 'group' })">
          <span class="cell-label">创建新的群聊<span class="cell-sub">选择好友/联系人创建群</span></span>
          <span class="arrow">›</span>
        </button>
      </div>

      <div v-if="type === 'newfriends' && demoList.length" class="cell-group">
        <div class="sec-title" style="padding:8px 16px;font-size:12px;color:var(--text-3)">待处理申请 {{ pending || demoList.length }}</div>
        <div v-for="item in demoList" :key="item.key" class="cell-row-wrap">
          <button class="cell-row" @click="onItem(item)">
            <span class="cell-label">
              {{ item.title }}
              <span v-if="item.sub" class="cell-sub">{{ item.sub }}</span>
            </span>
          </button>
          <div v-if="item.action === 'accept'" class="req-actions">
            <button class="req-btn ok" @click="onItem(item)">接受</button>
            <button class="req-btn" @click="onItem({ ...item, action: 'reject' })">拒绝</button>
          </div>
        </div>
      </div>
      <div v-else-if="type === 'newfriends'" class="empty-wrap">
        <div class="empty-icon">👤</div>
        <div class="empty-text">暂无新的朋友申请</div>
        <div class="empty-tip">可通过用户 ID 添加，或在上方创建群聊</div>
      </div>

      <div v-if="type === 'services'" class="service-balance">
        <div class="service-balance-label">零钱余额（演示支付）</div>
        <div class="service-balance-num">¥ {{ Number(servicesBalance ?? walletBalance ?? 0).toFixed(2) }}</div>
        <div class="service-balance-tip">支付从零钱扣除并记入流水，可在「钱包」查看</div>
      </div>

      <div v-if="type === 'services'" class="service-grid">
        <button v-for="item in demoList" :key="item.key" class="service-item" @click="onItem(item)">
          <span class="service-icon">{{ item.icon }}</span>
          <span>{{ item.title }}</span>
        </button>
      </div>

      <div v-else-if="type === 'favorites' && demoList.length" class="cell-group">
        <div v-for="item in demoList" :key="item.key" class="cell-row-wrap">
          <button class="cell-row" @click="onItem(item)">
            <span class="cell-label">
              <img v-if="item.mediaUrl && item.kind === 'image'" class="fav-thumb" :src="item.mediaUrl" alt="" />
              {{ item.title }}
              <span v-if="item.sub" class="cell-sub">{{ item.sub }}</span>
            </span>
            <span class="arrow">›</span>
          </button>
          <button class="fav-del" type="button" @click="onItem({ ...item, action: 'fav-del' })">删除</button>
        </div>
      </div>

      <div v-else-if="type !== 'newfriends' && type !== 'services' && demoList.length" class="cell-group">
        <div v-for="item in demoList" :key="item.key" class="cell-row-wrap">
          <button class="cell-row" @click="onItem(item)">
            <span class="cell-label">
              {{ item.title }}
              <span v-if="item.sub" class="cell-sub">{{ item.sub }}</span>
            </span>
            <span v-if="item.followed" class="tag">已关注</span>
            <span class="arrow">›</span>
          </button>
          <div v-if="item.action === 'accept'" class="req-actions">
            <button class="req-btn ok" @click="onItem(item)">接受</button>
            <button class="req-btn" @click="onItem({ ...item, action: 'reject' })">拒绝</button>
          </div>
        </div>
      </div>

      <div v-else-if="type !== 'newfriends'" class="empty-wrap">
        <div class="empty-icon">{{ meta.icon }}</div>
        <p class="empty-text">{{ status === 'loading' ? '加载中…' : (status || meta.empty) }}</p>
        <p v-if="meta.tip" class="empty-tip">{{ meta.tip }}</p>
      </div>
    </main>

    <div v-if="editingTag" class="mask" @click.self="editingTag = null">
      <div class="tag-panel">
        <div class="tag-bar">
          <button @click="editingTag = null">取消</button>
          <span>{{ editingTag.title }}</span>
          <button class="ok" @click="saveTagMembers">完成</button>
        </div>
        <div class="tag-list scroll-y">
          <button v-for="f in friendOptions" :key="f.id" class="tag-user" @click="toggleTagUser(f.id)">
            <UserAvatar :name="f.name" :avatar="f.avatar" :color="f.color" :size="40" />
            <span class="tag-name">{{ f.name }}</span>
            <span class="check" :class="{ on: tagChecked[f.id] }">✓</span>
          </button>
          <div v-if="!friendOptions.length" class="empty-tip" style="padding:24px">暂无好友可选</div>
        </div>
      </div>
    </div>
    <div v-if="favPreview" class="fav-preview" @click="favPreview = null">
      <img :src="favPreview" alt="收藏图片" />
    </div>
    <div v-if="albumPreview" class="fav-preview" @click="albumPreview = null">
      <img :src="albumPreview" alt="照片" />
    </div>
    <div v-if="paySheet" class="mask" @click.self="paySheet = null">
      <div class="pay-panel">
        <div class="pay-title">{{ paySheet.note }}</div>
        <div class="pay-amount">
          <span>¥</span>
          <input v-model="payAmountText" type="number" min="0.01" step="0.01" inputmode="decimal" />
        </div>
        <p class="pay-tip">从零钱余额扣除并记入流水（演示支付）</p>
        <div class="pay-btns">
          <button type="button" @click="paySheet = null">取消</button>
          <button type="button" class="ok" :disabled="payBusy" @click="confirmPay">
            {{ payBusy ? '支付中…' : '确认支付' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--bg);
  width: 100%;
}
.nav-bar {
  height: var(--nav-h);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  background: var(--bg);
  border-bottom: 0.5px solid var(--divider);
  padding: 0 8px;
}
.nav-back { position: absolute; left: 0; top: 0; bottom: 0; margin: auto 0; }
.nav-right { width: 44px; }
.nav-title { font-size: 17px; font-weight: 600; }
.content { flex: 1; min-height: 0; padding-bottom: 24px; }
.cell-group { background: var(--white); margin-top: 10px; }
.cell-row-wrap { border-bottom: 0.5px solid var(--divider-soft); }
.cell-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  background: var(--white);
  text-align: left;
  min-height: 52px;
}
.cell-row:active { background: var(--press); }
.cell-label {
  flex: 1;
  font-size: 16px;
  color: var(--text);
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.cell-sub { font-size: 12px; color: var(--text-3); }
.cell-value { font-size: 14px; color: var(--text-2); }
.tag {
  font-size: 11px;
  color: #07c160;
  background: rgba(7,193,96,0.1);
  padding: 2px 6px;
  border-radius: 3px;
}
.arrow { color: #c0c0c0; font-size: 18px; }
.req-actions {
  display: flex;
  gap: 8px;
  padding: 0 16px 12px;
  background: var(--white);
}
.req-btn {
  flex: 1;
  height: 36px;
  border-radius: 4px;
  background: var(--divider-soft);
  color: var(--text);
  font-size: 14px;
}
.req-btn.ok { background: #07c160; color: #fff; }
.tag-add { background: var(--white); }
.tag-add input { background: var(--divider-soft); color: var(--text); }
.service-icon { background: var(--divider-soft); }
.tag-user { background: var(--white); }
.tag-name { color: var(--text); }
.empty-text { color: var(--text); }
.req-btn.ok { background: #07c160; color: #fff; }
.tag-add {
  display: flex;
  gap: 8px;
  padding: 10px 12px;
  background: var(--white);
  margin-top: 10px;
}
.tag-add input {
  flex: 1;
  height: 40px;
  border-radius: 6px;
  background: #f5f5f5;
  padding: 0 12px;
  font-size: 14px;
}
.tag-add button {
  min-width: 72px;
  height: 40px;
  border-radius: 6px;
  background: #07c160;
  color: #fff;
  font-size: 14px;
}
.empty-wrap {
  padding: 64px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}
.empty-icon {
  width: 64px;
  height: 64px;
  border-radius: 16px;
  background: var(--white);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28px;
}
.empty-text { font-size: 15px; color: var(--text); }
.empty-tip { font-size: 12px; color: var(--text-3); text-align: center; }
.service-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 18px 8px;
  padding: 20px 12px;
  background: var(--white);
}
.service-balance {
  margin-top: 10px;
  padding: 16px;
  background: linear-gradient(135deg, #07c160, #06ad56);
  color: #fff;
}
.service-balance-label { font-size: 13px; opacity: 0.9; }
.service-balance-num { margin-top: 6px; font-size: 28px; font-weight: 600; }
.service-balance-tip { margin-top: 6px; font-size: 12px; opacity: 0.8; }
.service-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text);
  min-height: 64px;
}
.service-icon {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  background: #f7f7f7;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
}
.scan-page {
  flex: 1;
  background: #111;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 48px;
}
.scan-frame {
  width: 220px;
  height: 220px;
  position: relative;
  border: 1px solid rgba(255,255,255,0.35);
}
.scan-corners::before,
.scan-corners::after {
  content: '';
  position: absolute;
  width: 24px;
  height: 24px;
  border: 2px solid #07c160;
}
.scan-corners::before { top: -2px; left: -2px; border-right: none; border-bottom: none; }
.scan-corners::after { bottom: -2px; right: -2px; border-left: none; border-top: none; }
.scan-line {
  position: absolute;
  left: 8px; right: 8px;
  height: 2px;
  background: #07c160;
  top: 20px;
  animation: scanMove 2s linear infinite;
}
@keyframes scanMove {
  0% { top: 16px; }
  50% { top: 190px; }
  100% { top: 16px; }
}
.scan-tip { margin-top: 24px; color: rgba(255,255,255,0.75); font-size: 13px; }
.wallet-card {
  margin: 12px;
  background: #07c160;
  color: #fff;
  border-radius: 10px;
  padding: 24px 18px;
}
.wallet-label { font-size: 14px; opacity: 0.9; }
.wallet-amount { margin-top: 8px; font-size: 28px; font-weight: 600; }
.wallet-tip { margin-top: 6px; font-size: 12px; opacity: 0.75; }
.sec-title { padding: 8px 12px 4px; font-size: 12px; color: var(--text-2); }
.tx-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.tx-amt { font-size: 15px; font-weight: 600; }
.tx-amt.pos { color: #e6433d; }
.tx-amt.neg { color: #191919; }
.fav-thumb {
  width: 36px; height: 36px; border-radius: 4px; object-fit: cover;
  margin-right: 8px; vertical-align: middle; background: #eee;
}
.fav-del {
  border: 0; background: transparent; color: #e6433d; font-size: 13px;
  padding: 8px 12px;
}
.fav-preview {
  position: fixed; inset: 0; z-index: 3000; background: rgba(0,0,0,0.92);
  display: flex; align-items: center; justify-content: center;
}
.fav-preview img { max-width: 92%; max-height: 88%; object-fit: contain; }
.scan-add {
  margin: 0 12px 12px; border: 0; background: var(--green); color: #fff;
  border-radius: 8px; min-height: 40px; font-size: 14px; width: calc(100% - 24px);
}
.scan-add:disabled { opacity: 0.55; }
.scan-result .cell-sub { display: block; margin-top: 2px; }
.album-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 2px;
  background: var(--divider-soft);
}
.album-cell { aspect-ratio: 1; overflow: hidden; border: 0; padding: 0; background: #eee; }
.album-cell img { width: 100%; height: 100%; object-fit: cover; display: block; }
.album-go {
  margin: 16px 12px 24px; width: calc(100% - 24px); min-height: 44px;
  border: 0; border-radius: 8px; background: #07c160; color: #fff; font-size: 15px;
}
.pay-panel {
  margin: auto; width: 82%; background: var(--white); border-radius: 12px; padding: 20px 16px;
  display: flex; flex-direction: column; gap: 10px;
}
.pay-title { font-size: 15px; color: var(--text); text-align: center; }
.pay-amount { display: flex; align-items: baseline; gap: 6px; justify-content: center; }
.pay-amount span { font-size: 20px; color: var(--text); }
.pay-amount input {
  width: 140px; border: 0; border-bottom: 0.5px solid var(--divider);
  font-size: 28px; text-align: center; color: var(--text); background: transparent;
}
.pay-tip { font-size: 12px; color: var(--text-3); text-align: center; }
.pay-btns { display: flex; gap: 10px; margin-top: 6px; }
.pay-btns button {
  flex: 1; min-height: 42px; border-radius: 8px; border: 0; font-size: 15px;
  background: var(--divider-soft); color: var(--text);
}
.pay-btns button.ok { background: #07c160; color: #fff; }
.pay-btns button.ok:disabled { opacity: 0.5; }
.mask {
  position: absolute; inset: 0; background: var(--mask); z-index: 50;
  display: flex; animation: fadeIn 160ms var(--ease);
}
.tag-panel {
  width: 100%; max-height: 75%; margin-top: auto;
  background: var(--bg); border-radius: 12px 12px 0 0;
  display: flex; flex-direction: column;
  animation: panelUp 200ms var(--ease);
}
.tag-bar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 14px; background: var(--white);
  border-radius: 12px 12px 0 0; font-size: 15px;
}
.tag-bar button { min-height: 40px; color: var(--text-2); }
.tag-bar button.ok { color: #07c160; font-weight: 500; }
.tag-list { flex: 1; min-height: 0; background: var(--white); }
.tag-user {
  width: 100%; display: flex; align-items: center; gap: 12px;
  padding: 10px 14px; min-height: 60px; text-align: left;
  border-bottom: 0.5px solid var(--divider-soft);
}
.tag-name { flex: 1; font-size: 16px; color: var(--text); }
.check {
  width: 22px; height: 22px; border-radius: 50%;
  border: 1.5px solid #ccc; color: transparent;
  display: flex; align-items: center; justify-content: center;
  font-size: 14px; flex-shrink: 0;
}
.check.on { background: #07c160; border-color: #07c160; color: #fff; }
</style>
