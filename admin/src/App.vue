<script setup>
import { ref, computed, onMounted } from 'vue';
import { api, getToken, setToken, setUnauthorizedHandler } from './api.js';
import { toast } from './utils.js';
import ToastHost from './components/ToastHost.vue';
import LoginView from './views/LoginView.vue';
import DashboardView from './views/DashboardView.vue';
import UsersView from './views/UsersView.vue';
import DevicesView from './views/DevicesView.vue';
import ReportsView from './views/ReportsView.vue';
import FeedbackView from './views/FeedbackView.vue';
import ErrorsView from './views/ErrorsView.vue';
import ContentView from './views/ContentView.vue';
import FlagsView from './views/FlagsView.vue';
import SettingsView from './views/SettingsView.vue';
import AuditView from './views/AuditView.vue';
import AdminsView from './views/AdminsView.vue';
import AccountView from './views/AccountView.vue';

const booting = ref(true);
const admin = ref(null);
const permissions = ref([]);
const modules = ref([]);
const active = ref('dashboard');
const sideOpen = ref(false);
const badges = ref({});

const VIEWS = {
  dashboard: DashboardView,
  users: UsersView,
  devices: DevicesView,
  reports: ReportsView,
  feedback: FeedbackView,
  errors: ErrorsView,
  content: ContentView,
  flags: FlagsView,
  settings: SettingsView,
  audit: AuditView,
  admins: AdminsView,
  account: AccountView,
};

const can = (perm) => {
  if (!perm) return true;
  if (admin.value?.role === 'super') return true;
  return permissions.value.includes(perm);
};

/** 可见模块：按权限过滤；账号页永远可见 */
const navItems = computed(() => {
  const items = modules.value
    .filter((m) => can(m.perm))
    .map((m) => ({ ...m, badge: badges.value[m.key] || 0 }));
  items.push({ key: 'account', label: '我的账号', icon: '👤', badge: 0 });
  return items;
});

const currentView = computed(() => VIEWS[active.value] || DashboardView);

const currentTitle = computed(() => {
  if (active.value === 'account') return '我的账号';
  return modules.value.find((m) => m.key === active.value)?.label || '运营后台';
});

function go(key) {
  if (!VIEWS[key]) return;
  active.value = key;
  sideOpen.value = false;
  try { localStorage.setItem('hudui_admin_tab', key); } catch { /* ignore */ }
  refreshBadges();
}

async function refreshBadges() {
  if (!can('dashboard.view')) return;
  try {
    const d = await api.dashboard(7);
    badges.value = {
      reports: d.todos?.pendingReports || 0,
      feedback: d.todos?.openFeedback || 0,
      errors: d.todos?.errors24h || 0,
    };
  } catch { /* ignore */ }
}

async function loadMe() {
  const r = await api.me();
  admin.value = r.admin;
  permissions.value = r.permissions || [];
}

async function bootstrap() {
  booting.value = true;
  if (!getToken()) {
    booting.value = false;
    return;
  }
  try {
    await loadMe();
    const meta = await api.meta();
    modules.value = meta.modules || [];
    // 恢复上次所在模块（仍要有权限）
    let saved = 'dashboard';
    try { saved = localStorage.getItem('hudui_admin_tab') || 'dashboard'; } catch { /* ignore */ }
    if (VIEWS[saved] && (saved === 'account' || can(modules.value.find((m) => m.key === saved)?.perm))) {
      active.value = saved;
    } else {
      active.value = modules.value.find((m) => can(m.perm))?.key || 'account';
    }
    refreshBadges();
  } catch {
    setToken(null);
    admin.value = null;
  } finally {
    booting.value = false;
  }
}

async function onLoggedIn(payload) {
  setToken(payload.token);
  admin.value = payload.admin;
  permissions.value = payload.permissions || [];
  toast(`欢迎回来，${payload.admin.displayName}`, 'ok');
  await bootstrap();
}

async function logout() {
  try { await api.logout(); } catch { /* ignore */ }
  setToken(null);
  admin.value = null;
  permissions.value = [];
  toast('已退出登录');
}

onMounted(() => {
  setUnauthorizedHandler((msg) => {
    admin.value = null;
    permissions.value = [];
    toast(msg || '登录已失效', 'warn');
  });
  bootstrap();
});
</script>

<template>
  <div v-if="booting" class="loading" style="padding-top:22vh">运营后台加载中…</div>

  <LoginView v-else-if="!admin" @logged-in="onLoggedIn" />

  <div v-else class="shell">
    <aside class="sidebar" :class="{ open: sideOpen }">
      <div class="side-brand">
        <b>🛡️ 运营后台</b>
        <span>ADMIN CONSOLE</span>
      </div>
      <nav class="side-nav">
        <button
          v-for="m in navItems"
          :key="m.key"
          type="button"
          class="side-item"
          :class="{ on: active === m.key }"
          @click="go(m.key)"
        >
          <span class="ico">{{ m.icon }}</span>
          <span>{{ m.label }}</span>
          <span v-if="m.badge" class="badge">{{ m.badge > 99 ? '99+' : m.badge }}</span>
        </button>
      </nav>
      <div class="side-foot">
        <span class="who">{{ admin.displayName }}</span>
        <span>{{ admin.roleLabel }}</span>
      </div>
    </aside>

    <div class="main">
      <header class="topbar">
        <button
          type="button"
          class="btn sm"
          style="display:none"
          :style="{ display: 'inline-flex' }"
          @click="sideOpen = !sideOpen"
        >☰</button>
        <h1>{{ currentTitle }}</h1>
        <div class="spacer"></div>
        <span class="who">{{ admin.username }}</span>
        <button type="button" class="btn sm" @click="go('account')">账号</button>
        <button type="button" class="btn sm" @click="logout">退出</button>
      </header>

      <main class="content">
        <component
          :is="currentView"
          :key="active"
          :can="can"
          :admin="admin"
          @refresh-badges="refreshBadges"
          @navigate="go"
          @logout="logout"
        />
      </main>
    </div>
  </div>

  <ToastHost />
</template>
