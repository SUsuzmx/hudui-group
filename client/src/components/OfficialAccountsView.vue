<script setup>
import { ref, computed, onMounted } from 'vue';
import { api } from '../api.js';
import { toast } from '../toast.js';
import UserAvatar from './UserAvatar.vue';

const emit = defineEmits(['back']);

const list = ref([]);
const loading = ref(false);
const q = ref('');
const detail = ref(null); // 打开的公众号
const detailTab = ref('home'); // home | history

const filtered = computed(() => {
  const k = q.value.trim().toLowerCase();
  if (!k) return list.value;
  return list.value.filter((o) =>
    String(o.name || '').toLowerCase().includes(k)
    || String(o.intro || '').toLowerCase().includes(k)
  );
});

const followed = computed(() => filtered.value.filter((o) => o.followed));
const discover = computed(() => filtered.value.filter((o) => !o.followed));

const demoArticles = computed(() => {
  const name = detail.value?.name || '公众号';
  return [
    { id: 1, title: `【${name}】服务通知`, sub: '演示消息 · 今天', digest: '这里是公众号消息列表演示，后续可接入真实推送。' },
    { id: 2, title: '使用指南', sub: '演示消息 · 昨天', digest: '在通讯录 → 公众号中管理关注；点击条目可查看历史消息壳。' },
    { id: 3, title: '欢迎关注', sub: '演示消息 · 3天前', digest: `${name} 已接入本项目的公众号壳界面。` },
  ];
});

function oaColor(name) {
  const s = String(name || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue}, 55%, 45%)`;
}

function oaInitial(name) {
  return String(name || '公').slice(0, 1);
}

async function load() {
  loading.value = true;
  try {
    const data = await api.official();
    list.value = (data.official || []).map((o) => ({
      ...o,
      color: oaColor(o.name),
      initial: oaInitial(o.name),
    }));
  } catch (e) {
    toast(e.message || '加载失败');
  } finally {
    loading.value = false;
  }
}

async function toggleFollow(o) {
  try {
    if (o.followed) {
      await api.unfollowOfficial(o.id);
      o.followed = false;
      toast('已取消关注');
    } else {
      await api.followOfficial(o.id);
      o.followed = true;
      toast('关注成功');
    }
    if (detail.value?.id === o.id) detail.value = { ...o };
  } catch (e) {
    toast(e.message || '操作失败');
  }
}

function openDetail(o) {
  detail.value = { ...o };
  detailTab.value = 'home';
}

function closeDetail() {
  detail.value = null;
}

onMounted(load);
</script>

<template>
  <div class="page">
    <!-- 列表 -->
    <template v-if="!detail">
      <div class="oa-search">
        <span>🔍</span>
        <input v-model="q" placeholder="搜索公众号" maxlength="30" />
      </div>

      <main class="content scroll-y">
        <div v-if="loading && !list.length" class="empty">加载中…</div>

        <template v-else>
          <section v-if="followed.length" class="oa-section">
            <div class="oa-sec-title">我关注的公众号</div>
            <div class="oa-list">
              <button
                v-for="o in followed"
                :key="'f-' + o.id"
                class="oa-row"
                type="button"
                @click="openDetail(o)"
              >
                <div class="oa-avatar" :style="{ background: o.color }">{{ o.initial }}</div>
                <div class="oa-main">
                  <div class="oa-name">{{ o.name }}</div>
                  <div class="oa-intro">{{ o.intro }}</div>
                </div>
                <span class="oa-badge">已关注</span>
                <span class="arrow">›</span>
              </button>
            </div>
          </section>

          <section class="oa-section">
            <div class="oa-sec-title">{{ followed.length ? '发现公众号' : '公众号' }}</div>
            <div v-if="discover.length" class="oa-list">
              <button
                v-for="o in discover"
                :key="'d-' + o.id"
                class="oa-row"
                type="button"
                @click="openDetail(o)"
              >
                <div class="oa-avatar" :style="{ background: o.color }">{{ o.initial }}</div>
                <div class="oa-main">
                  <div class="oa-name">{{ o.name }}</div>
                  <div class="oa-intro">{{ o.intro }}</div>
                </div>
                <span class="arrow">›</span>
              </button>
            </div>
            <div v-else-if="!followed.length" class="empty">
              <div class="empty-icon">📢</div>
              <div class="empty-text">{{ q ? '未找到相关公众号' : '暂无公众号' }}</div>
              <div class="empty-tip">关注后会出现在通讯录「公众号」中</div>
            </div>
          </section>
        </template>
      </main>
    </template>

    <!-- 详情壳 -->
    <template v-else>
      <header class="nav">
        <button class="nav-back" type="button" @click="closeDetail">‹</button>
        <div class="nav-title">{{ detail.name }}</div>
        <div class="nav-side"></div>
      </header>
      <main class="content scroll-y">
        <section class="oa-hero">
          <div class="oa-avatar lg" :style="{ background: detail.color }">{{ detail.initial }}</div>
          <div class="oa-hero-main">
            <div class="oa-name">{{ detail.name }}</div>
            <div class="oa-intro">{{ detail.intro }}</div>
            <div class="oa-id">微信号：gh_demo{{ detail.id }}</div>
          </div>
          <button class="oa-follow" :class="{ on: detail.followed }" type="button" @click="toggleFollow(detail)">
            {{ detail.followed ? '已关注' : '关注' }}
          </button>
        </section>

        <div class="oa-tabs">
          <button class="oa-tab" :class="{ on: detailTab === 'home' }" type="button" @click="detailTab = 'home'">主页</button>
          <button class="oa-tab" :class="{ on: detailTab === 'history' }" type="button" @click="detailTab = 'history'">消息</button>
        </div>

        <template v-if="detailTab === 'home'">
          <section class="oa-card">
            <div class="oa-card-title">功能介绍</div>
            <div class="oa-card-body">{{ detail.intro || '暂无介绍' }}</div>
          </section>
          <section class="oa-card">
            <div class="oa-card-title">常用服务</div>
            <div class="oa-service-grid">
              <button class="oa-svc" type="button" @click="toast('服务演示中')">📁 资料</button>
              <button class="oa-svc" type="button" @click="toast('服务演示中')">🗓 活动</button>
              <button class="oa-svc" type="button" @click="toast('服务演示中')">💬 留言</button>
              <button class="oa-svc" type="button" @click="detailTab = 'history'">📰 历史消息</button>
            </div>
          </section>
          <p class="oa-hint">公众号为界面壳演示，消息与服务为占位内容。</p>
        </template>
        <template v-else>
          <div v-for="a in demoArticles" :key="a.id" class="oa-article" @click="toast('文章详情演示中')">
            <div class="oa-art-title">{{ a.title }}</div>
            <div class="oa-art-digest">{{ a.digest }}</div>
            <div class="oa-art-sub">{{ a.sub }}</div>
          </div>
          <p class="oa-hint">仅展示演示消息列表</p>
        </template>
      </main>
    </template>
  </div>
</template>

<style scoped>
.page {
  flex: 1; display: flex; flex-direction: column; min-height: 0;
  background: var(--bg, #ededed); width: 100%;
}
.nav {
  height: var(--nav-h, 44px); flex-shrink: 0;
  display: flex; align-items: center; justify-content: space-between;
  background: var(--bg); border-bottom: 0.5px solid var(--divider);
  padding: 0 8px; position: relative;
}
.nav-back {
  width: 44px; height: 44px; border: 0; background: transparent;
  color: var(--text); font-size: 28px; cursor: pointer;
}
.nav-title {
  position: absolute; left: 50%; transform: translateX(-50%);
  font-size: 17px; font-weight: 600; color: var(--text);
  max-width: 60%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.nav-side { width: 44px; }
.oa-search {
  display: flex; align-items: center; gap: 8px;
  margin: 10px 12px; padding: 8px 12px;
  background: var(--white); border-radius: 6px;
  color: var(--text-3); font-size: 14px;
}
.oa-search input {
  flex: 1; border: 0; background: transparent; color: var(--text);
  font-size: 14px; min-width: 0; outline: none;
}
.content { flex: 1; min-height: 0; overflow-y: auto; padding-bottom: 24px; }
.oa-section { margin-top: 8px; }
.oa-sec-title {
  padding: 8px 16px 6px; font-size: 12px; color: var(--text-3);
}
.oa-list { background: var(--white); }
.oa-row {
  width: 100%; display: flex; align-items: center; gap: 12px;
  padding: 12px 16px; border: 0; background: var(--white);
  border-bottom: 0.5px solid var(--divider-soft); text-align: left;
  color: var(--text); cursor: pointer;
}
.oa-row:active { background: var(--press); }
.oa-avatar {
  width: 44px; height: 44px; border-radius: 8px; flex-shrink: 0;
  display: grid; place-items: center; color: #fff; font-weight: 600; font-size: 18px;
}
.oa-avatar.lg { width: 64px; height: 64px; font-size: 26px; border-radius: 10px; }
.oa-main { flex: 1; min-width: 0; }
.oa-name { font-size: 16px; font-weight: 500; color: var(--text); }
.oa-intro {
  margin-top: 3px; font-size: 12px; color: var(--text-2);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.oa-badge {
  font-size: 11px; color: var(--green, #07c160);
  border: 1px solid rgba(7,193,96,0.35); border-radius: 2px; padding: 1px 4px;
  flex-shrink: 0;
}
.arrow { color: var(--text-3); font-size: 18px; flex-shrink: 0; }
.empty { padding: 40px 20px; text-align: center; color: var(--text-2); font-size: 13px; }
.empty-icon { font-size: 36px; margin-bottom: 10px; }
.empty-text { color: var(--text); font-size: 14px; margin-bottom: 6px; }
.empty-tip { color: var(--text-3); font-size: 12px; }

.oa-hero {
  display: flex; align-items: flex-start; gap: 12px;
  padding: 18px 16px; background: var(--white); margin-bottom: 10px;
}
.oa-hero-main { flex: 1; min-width: 0; }
.oa-id { margin-top: 6px; font-size: 12px; color: var(--text-3); }
.oa-follow {
  flex-shrink: 0; border: 0; border-radius: 4px;
  background: var(--green, #07c160); color: #fff;
  font-size: 13px; padding: 6px 14px; min-height: 32px; cursor: pointer;
}
.oa-follow.on { background: var(--divider-soft); color: var(--text-2); }
.oa-tabs {
  display: flex; background: var(--white); margin-bottom: 10px;
  border-bottom: 0.5px solid var(--divider);
}
.oa-tab {
  flex: 1; border: 0; background: transparent; color: var(--text-2);
  font-size: 15px; min-height: 44px; cursor: pointer; position: relative;
}
.oa-tab.on { color: var(--green, #07c160); font-weight: 600; }
.oa-tab.on::after {
  content: ''; position: absolute; left: 30%; right: 30%; bottom: 0;
  height: 2px; background: var(--green, #07c160); border-radius: 1px;
}
.oa-card {
  background: var(--white); margin-bottom: 10px; padding: 14px 16px;
}
.oa-card-title { font-size: 13px; color: var(--text-3); margin-bottom: 8px; }
.oa-card-body { font-size: 14px; color: var(--text); line-height: 1.6; }
.oa-service-grid {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px;
}
.oa-svc {
  border: 0; background: var(--divider-soft); border-radius: 8px;
  min-height: 64px; font-size: 12px; color: var(--text); cursor: pointer;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
}
.oa-article {
  background: var(--white); margin-bottom: 1px; padding: 14px 16px; cursor: pointer;
}
.oa-art-title { font-size: 15px; font-weight: 600; color: var(--text); margin-bottom: 6px; }
.oa-art-digest { font-size: 13px; color: var(--text-2); line-height: 1.5; }
.oa-art-sub { margin-top: 8px; font-size: 12px; color: var(--text-3); }
.oa-hint { padding: 16px; text-align: center; font-size: 12px; color: var(--text-3); }
</style>
