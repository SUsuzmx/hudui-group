<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import { api } from '../api.js';
import { fmtTime, fmtAgo, toast, toastError } from '../utils.js';

const props = defineProps({
  can: { type: Function, required: true },
  admin: { type: Object, default: null },
});
const emit = defineEmits(['logout']);

const sessions = ref([]);
const loading = ref(true);
const busy = ref(false);
const pwd = reactive({ oldPassword: '', newPassword: '', confirm: '' });

const myPermissions = computed(() => props.admin?.permissions || []);

async function load() {
  loading.value = true;
  try {
    const r = await api.sessions();
    sessions.value = r.sessions || [];
  } catch (e) {
    toastError(e);
  } finally {
    loading.value = false;
  }
}

async function submitPassword() {
  if (busy.value) return;
  if (pwd.newPassword.length < 8) {
    toast('新密码至少 8 位，且需包含字母和数字', 'error');
    return;
  }
  if (pwd.newPassword !== pwd.confirm) {
    toast('两次输入的新密码不一致', 'error');
    return;
  }
  busy.value = true;
  try {
    await api.changePassword(pwd.oldPassword, pwd.newPassword);
    toast('密码已修改，其它设备已下线', 'ok');
    pwd.oldPassword = '';
    pwd.newPassword = '';
    pwd.confirm = '';
    await load();
  } catch (e) {
    toastError(e);
  } finally {
    busy.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="grid cols-2">
    <div class="card">
      <div class="card-head">账号信息</div>
      <div class="card-body">
        <div class="kv">
          <span class="k">用户名</span><span class="v mono">{{ props.admin?.username }}</span>
          <span class="k">显示名</span><span class="v">{{ props.admin?.displayName }}</span>
          <span class="k">角色</span>
          <span class="v"><span class="tag" :class="props.admin?.role === 'super' ? 'purple' : 'blue'">{{ props.admin?.roleLabel }}</span></span>
          <span class="k">最近登录</span><span class="v">{{ fmtTime(props.admin?.lastLoginAt) }}</span>
          <span class="k">登录 IP</span><span class="v mono">{{ props.admin?.lastLoginIp || '—' }}</span>
        </div>
        <div class="divider"></div>
        <div class="muted" style="font-size:12px;margin-bottom:8px">我的权限</div>
        <div class="btn-group">
          <span v-for="p in myPermissions" :key="p" class="tag gray">{{ p }}</span>
          <span v-if="!myPermissions.length" class="muted">无</span>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-head">修改密码</div>
      <div class="card-body">
        <div class="field">
          <label>原密码</label>
          <input v-model="pwd.oldPassword" class="input" type="password" autocomplete="current-password" />
        </div>
        <div class="field">
          <label>新密码</label>
          <input v-model="pwd.newPassword" class="input" type="password" autocomplete="new-password" placeholder="至少 8 位，含字母和数字" />
        </div>
        <div class="field">
          <label>确认新密码</label>
          <input v-model="pwd.confirm" class="input" type="password" autocomplete="new-password" />
        </div>
        <div class="row-flex">
          <span class="hint" style="margin:0">修改后其它设备的后台会话会立即失效。</span>
          <div class="spacer"></div>
          <button type="button" class="btn primary" :disabled="busy" @click="submitPassword">
            {{ busy ? '提交中…' : '修改密码' }}
          </button>
        </div>
      </div>
    </div>
  </div>

  <div class="card">
    <div class="card-head">
      我的登录会话
      <div class="spacer"></div>
      <button type="button" class="btn sm" @click="load">刷新</button>
      <button type="button" class="btn sm danger" @click="emit('logout')">退出登录</button>
    </div>
    <div class="card-body tight">
      <table class="tbl">
        <thead>
          <tr>
            <th style="width:110px">会话</th>
            <th style="width:150px">IP</th>
            <th>客户端</th>
            <th style="width:170px">最近活动</th>
            <th style="width:170px">过期时间</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(s, i) in sessions" :key="i">
            <td class="mono">{{ s.token }}</td>
            <td class="mono">{{ s.ip || '—' }}</td>
            <td class="ellip muted">{{ s.userAgent || '—' }}</td>
            <td class="muted nowrap">{{ fmtAgo(s.lastSeenAt) }}</td>
            <td class="muted nowrap">{{ fmtTime(s.expiresAt) }}</td>
          </tr>
          <tr v-if="!loading && !sessions.length"><td colspan="5" class="empty">暂无会话</td></tr>
          <tr v-if="loading"><td colspan="5" class="loading">加载中…</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
