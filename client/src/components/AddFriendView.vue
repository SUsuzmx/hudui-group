<script setup>
import { ref } from 'vue';
import { api } from '../api.js';
import UserAvatar from './UserAvatar.vue';

const emit = defineEmits(['back', 'added']);

const q = ref('');
const results = ref([]);
const searched = ref(false);
const loading = ref(false);
const message = ref('');

async function search() {
  const keyword = q.value.trim();
  if (!keyword) return;
  loading.value = true;
  message.value = '';
  try {
    // 名片码优先走 resolve
    if (/hudui:U:|^\d+$|^[a-zA-Z][\w-]{2,}$/.test(keyword)) {
      try {
        const r = await api.resolveUser(keyword);
        if (r.user) {
          results.value = [r.user];
          searched.value = true;
          return;
        }
      } catch { /* fallback to name search */ }
    }
    const data = await api.searchFriends(keyword);
    results.value = data.users;
    searched.value = true;
    if (!data.users.length) message.value = '没有找到相关用户';
  } catch (e) {
    message.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function add(u) {
  if (u.isFriend || u.isAI) {
    if (u.isAI) message.value = 'AI 群友仅在群聊中互动，无法添加为好友';
    return;
  }
  try {
    await api.addFriend(u.id);
    u.isFriend = true;
    emit('added', u);
    message.value = `已添加「${u.nickname}」`;
  } catch (e) {
    message.value = e.message;
  }
}
</script>

<template>
  <div class="page">
    <header class="nav">
      <button class="nav-back" @click="emit('back')">‹</button>
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
          <div class="user-name">{{ u.nickname }}</div>
          <div class="user-wxid">微信号: {{ u.wxid || '未设置' }}</div>
        </div>
        <button
          class="add-btn"
          :class="{ done: u.isFriend }"
          :disabled="u.isFriend"
          @click="add(u)"
        >{{ u.isFriend ? '已添加' : '添加' }}</button>
      </div>

      <div v-if="!searched" class="hint-card">
        <p>输入对方的微信号或昵称来添加朋友</p>
        <p>也可以在通讯录的群成员里直接添加</p>
      </div>
    </main>
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
  background: #ededed;
  border-bottom: 1px solid #d9d9d9;
  display: flex;
  align-items: center;
  padding: 0 14px;
  flex-shrink: 0;
}
.nav-back {
  width: 36px;
  background: none;
  font-size: 30px;
  color: #111;
  line-height: 1;
  padding-bottom: 4px;
  margin-left: -8px;
}
.nav-title {
  flex: 1;
  text-align: center;
  font-size: 17px;
  font-weight: 500;
}
.nav-right { width: 36px; }

.content {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

.search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 12px;
  background: #fff;
  border-radius: 8px;
  padding: 10px 12px;
}
.search-box .icon { font-size: 14px; }
.search-box input {
  flex: 1;
  border: none;
  font-size: 15px;
  background: transparent;
}
.search-btn {
  background: #07c160;
  color: #fff;
  border-radius: 6px;
  padding: 6px 12px;
  font-size: 13px;
}
.search-btn:disabled {
  background: #a8e6c3;
}

.tip {
  text-align: center;
  color: #576b95;
  font-size: 13px;
  padding: 8px 16px;
}
.section-label {
  font-size: 12px;
  color: #999;
  padding: 8px 14px 4px;
}
.user-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  background: #fff;
  border-bottom: 1px solid #f0f0f0;
}
.user-info { flex: 1; min-width: 0; }
.user-name {
  font-size: 16px;
  color: #111;
}
.user-wxid {
  font-size: 12px;
  color: #999;
  margin-top: 3px;
}
.add-btn {
  background: #07c160;
  color: #fff;
  border-radius: 4px;
  padding: 6px 14px;
  font-size: 13px;
}
.add-btn.done,
.add-btn:disabled {
  background: #e5e5e5;
  color: #999;
}

.hint-card {
  margin: 40px 24px;
  text-align: center;
  color: #b2b2b2;
  font-size: 13px;
  line-height: 1.8;
}
</style>
