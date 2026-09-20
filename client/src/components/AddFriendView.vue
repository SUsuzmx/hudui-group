<script setup>
import { ref } from 'vue';
import { api } from '../api.js';
import UserAvatar from './UserAvatar.vue';
import { toast } from '../toast.js';

const emit = defineEmits(['back', 'added']);

const q = ref('');
const results = ref([]);
const searched = ref(false);
const loading = ref(false);
const message = ref('');
const greeting = ref('');
const pendingUser = ref(null);
const sending = ref(false);

async function search() {
  const keyword = q.value.trim();
  if (!keyword) return;
  loading.value = true;
  message.value = '';
  try {
    if (/hudui:U:|^\d+$|^[a-zA-Z][\w-]{2,}$/.test(keyword)) {
      try {
        const r = await api.resolveUser(keyword);
        if (r.user) {
          results.value = [r.user];
          searched.value = true;
          return;
        }
      } catch { /* fallback */ }
    }
    const data = await api.searchFriends(keyword);
    results.value = data.users || [];
    searched.value = true;
    if (!data.users.length) message.value = '该用户不存在';
  } catch (e) {
    message.value = e.message;
  } finally {
    loading.value = false;
  }
}

function openVerify(u) {
  if (u.isFriend || u.isAI) {
    if (u.isAI) message.value = 'AI 群友仅在群聊中互动，无法添加为好友';
    return;
  }
  pendingUser.value = u;
  greeting.value = '我是' + '';
}

function closeVerify() {
  pendingUser.value = null;
}

async function confirmAdd() {
  const u = pendingUser.value;
  if (!u || sending.value) return;
  sending.value = true;
  try {
    const note = (greeting.value || '').trim() || '我是';
    await api.sendFriendRequest(u.id, note.slice(0, 40));
    toast('已发送添加申请，等待对方验证');
    message.value = `已向「${u.nickname}」发送申请`;
    pendingUser.value = null;
  } catch (e) {
    message.value = e.message;
  } finally {
    sending.value = false;
  }
}

async function add(u) {
  openVerify(u);
}
</script>

<template>
  <div class="page">
    <header class="nav">
      <button class="nav-back" type="button" @click="emit('back')">‹</button>
      <div class="nav-title">添加朋友</div>
      <div class="nav-right"></div>
    </header>

    <main class="content">
      <div class="search-box">
        <span class="icon">🔍</span>
        <input
          v-model="q"
          placeholder="微信号 / 昵称 / 名片码"
          maxlength="80"
          @keydown.enter="search"
        />
        <button class="search-btn" :disabled="loading || !q.trim()" @click="search">
          {{ loading ? '…' : '搜索' }}
        </button>
      </div>
      <p class="hint-tip">也可用「发现 → 扫一扫」解析对方二维码名片</p>

      <p v-if="message" class="tip">{{ message }}</p>

      <div v-if="searched" class="section-label">搜索结果</div>
      <div
        v-for="u in results"
        :key="u.id"
        class="user-row"
      >
        <UserAvatar :name="u.nickname" :avatar="u.avatar" :color="u.avatarColor" :size="44" />
        <div class="user-info">
          <div class="user-name">{{ u.nickname }}<span v-if="u.isAI" class="ai-tag">AI</span></div>
          <div class="user-wxid">微信号: {{ u.wxid || '未设置' }}</div>
        </div>
        <button
          class="add-btn"
          :class="{ done: u.isFriend || u.reqSent }"
          :disabled="u.isFriend || u.reqSent"
          @click="add(u)"
        >{{ u.isFriend ? '已添加' : u.reqSent ? '已申请' : '添加' }}</button>
      </div>

      <div v-if="!searched" class="hint-card">
        <p>输入对方的微信号或昵称来添加朋友</p>
        <p>发送验证申请后，对方同意即可成为好友</p>
      </div>
    </main>

    <!-- 微信验证申请弹层 -->
    <div v-if="pendingUser" class="verify-mask" @click.self="closeVerify">
      <div class="verify-panel">
        <div class="verify-title">发送添加朋友验证</div>
        <div class="verify-user">
          <UserAvatar
            :name="pendingUser.nickname"
            :avatar="pendingUser.avatar"
            :color="pendingUser.avatarColor"
            :size="48"
          />
          <div>
            <div class="verify-name">{{ pendingUser.nickname }}</div>
            <div class="verify-sub">微信号 {{ pendingUser.wxid || '未设置' }}</div>
          </div>
        </div>
        <div class="verify-label">发送添加朋友验证</div>
        <textarea
          v-model="greeting"
          class="verify-input"
          rows="3"
          maxlength="40"
          placeholder="我是…"
        ></textarea>
        <div class="verify-actions">
          <button type="button" class="ghost" @click="closeVerify">取消</button>
          <button type="button" class="ok" :disabled="sending" @click="confirmAdd">
            {{ sending ? '发送中…' : '发送' }}
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
  background: #ededed;
}
.nav {
  height: 52px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #ededed;
  border-bottom: 0.5px solid #e0e0e0;
  padding: 0 8px;
}
.nav-back {
  width: 44px; height: 44px; border: 0; background: transparent;
  font-size: 28px; color: #111; cursor: pointer;
}
.nav-title { font-size: 17px; font-weight: 600; color: #111; }
.nav-right { width: 44px; }
.content { flex: 1; min-height: 0; overflow-y: auto; padding-bottom: 24px; }
.search-box {
  margin: 12px 16px;
  background: #fff;
  border-radius: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
}
.search-box .icon { opacity: 0.5; }
.search-box input {
  flex: 1; border: 0; outline: none; font-size: 15px; background: transparent; min-width: 0;
}
.search-btn {
  border: 0; background: #07c160; color: #fff; border-radius: 4px;
  padding: 6px 12px; font-size: 13px; cursor: pointer; min-height: 32px;
}
.search-btn:disabled { opacity: 0.5; }
.hint-tip { margin: 0 16px 8px; font-size: 12px; color: #888; }
.tip { margin: 0 16px 8px; font-size: 13px; color: #fa5151; }
.section-label { padding: 12px 16px 6px; font-size: 12px; color: #888; }
.user-row {
  display: flex; align-items: center; gap: 12px;
  background: #fff; margin: 0 0 0.5px; padding: 12px 16px;
}
.user-info { flex: 1; min-width: 0; }
.user-name { font-size: 16px; color: #111; font-weight: 500; }
.ai-tag {
  margin-left: 6px; font-size: 10px; color: #07c160;
  border: 1px solid rgba(7,193,96,0.4); border-radius: 2px; padding: 0 3px;
}
.user-wxid { margin-top: 3px; font-size: 12px; color: #888; }
.add-btn {
  border: 0; background: #07c160; color: #fff;
  border-radius: 4px; padding: 6px 12px; font-size: 13px;
  min-height: 32px; cursor: pointer;
}
.add-btn.done { background: #e5e5e5; color: #999; }
.hint-card {
  margin: 24px 16px; padding: 20px; background: #fff; border-radius: 8px;
  color: #888; font-size: 13px; line-height: 1.7;
}
.verify-mask {
  position: fixed; inset: 0; z-index: 80;
  background: rgba(0,0,0,0.4);
  display: flex; align-items: flex-end; justify-content: center;
}
.verify-panel {
  width: 100%; max-width: 480px;
  background: #f7f7f7;
  border-radius: 12px 12px 0 0;
  padding: 16px 16px calc(16px + env(safe-area-inset-bottom, 0px));
}
.verify-title {
  text-align: center; font-size: 16px; font-weight: 600; color: #111; margin-bottom: 14px;
}
.verify-user {
  display: flex; align-items: center; gap: 12px;
  background: #fff; border-radius: 8px; padding: 12px; margin-bottom: 12px;
}
.verify-name { font-size: 16px; font-weight: 500; }
.verify-sub { font-size: 12px; color: #888; margin-top: 2px; }
.verify-label { font-size: 13px; color: #888; margin-bottom: 6px; }
.verify-input {
  width: 100%; box-sizing: border-box;
  border: 0; border-radius: 8px; background: #fff;
  padding: 10px 12px; font-size: 15px; resize: none; outline: none;
  font-family: inherit;
}
.verify-actions {
  display: flex; gap: 10px; margin-top: 16px;
}
.verify-actions button {
  flex: 1; min-height: 44px; border: 0; border-radius: 6px;
  font-size: 16px; cursor: pointer;
}
.verify-actions .ghost { background: #fff; color: #111; }
.verify-actions .ok { background: #07c160; color: #fff; font-weight: 500; }
.verify-actions .ok:disabled { opacity: 0.6; }
</style>
