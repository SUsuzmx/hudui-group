<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import { api } from '../api.js';
import { fmtTime, fmtAgo, toast, toastError } from '../utils.js';

const props = defineProps({
  can: { type: Function, required: true },
  admin: { type: Object, default: null },
});

const list = ref([]);
const roles = ref([]);
const permissions = ref([]);
const loading = ref(true);
const busy = ref(false);

const dialog = reactive({
  open: false, mode: 'create', target: null,
  username: '', password: '', displayName: '', role: 'operator',
  status: 'active', perms: [],
});
const pwdDialog = reactive({ open: false, target: null, password: '' });

const canManage = computed(() => props.can('admins.manage'));

async function load() {
  loading.value = true;
  try {
    const r = await api.admins();
    list.value = r.admins || [];
    roles.value = r.roles || [];
    permissions.value = r.permissions || [];
  } catch (e) {
    toastError(e);
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  dialog.open = true;
  dialog.mode = 'create';
  dialog.target = null;
  dialog.username = '';
  dialog.password = '';
  dialog.displayName = '';
  dialog.role = 'operator';
  dialog.status = 'active';
  dialog.perms = [];
}

function openEdit(a) {
  dialog.open = true;
  dialog.mode = 'edit';
  dialog.target = a;
  dialog.username = a.username;
  dialog.displayName = a.displayName;
  dialog.role = a.role;
  dialog.status = a.status;
  // 只把角色预设之外的额外权限放进勾选
  const preset = new Set(roles.value.find((r) => r.key === a.role)?.permissions || []);
  dialog.perms = (a.permissions || []).filter((p) => !preset.has(p));
}

/** 角色预设权限（超管为全部） */
const presetPerms = computed(() => {
  if (dialog.role === 'super') return new Set(permissions.value.map((p) => p.key));
  return new Set(roles.value.find((r) => r.key === dialog.role)?.permissions || []);
});

function togglePerm(key) {
  if (presetPerms.value.has(key)) return;
  const i = dialog.perms.indexOf(key);
  if (i >= 0) dialog.perms.splice(i, 1);
  else dialog.perms.push(key);
}

async function submit() {
  if (busy.value) return;
  busy.value = true;
  try {
    if (dialog.mode === 'create') {
      await api.createAdmin({
        username: dialog.username.trim(),
        password: dialog.password,
        displayName: dialog.displayName.trim(),
        role: dialog.role,
        status: dialog.status,
        permissions: dialog.perms,
      });
      toast(`已创建管理员 ${dialog.username}`, 'ok');
    } else {
      await api.updateAdmin(dialog.target.id, {
        displayName: dialog.displayName.trim(),
        role: dialog.role,
        status: dialog.status,
        permissions: dialog.perms,
      });
      toast(`已更新 ${dialog.target.username}`, 'ok');
    }
    dialog.open = false;
    await load();
  } catch (e) {
    toastError(e);
  } finally {
    busy.value = false;
  }
}

function askPassword(a) {
  pwdDialog.open = true;
  pwdDialog.target = a;
  pwdDialog.password = '';
}

async function submitPassword() {
  if (busy.value) return;
  if (pwdDialog.password.length < 8) {
    toast('密码至少 8 位，且需含字母和数字', 'error');
    return;
  }
  busy.value = true;
  try {
    await api.resetAdminPassword(pwdDialog.target.id, pwdDialog.password);
    toast(`已重置 ${pwdDialog.target.username} 的密码并踢下线`, 'ok');
    pwdDialog.open = false;
    await load();
  } catch (e) {
    toastError(e);
  } finally {
    busy.value = false;
  }
}

async function revoke(a) {
  busy.value = true;
  try {
    await api.revokeAdminSessions(a.id);
    toast(`已强制 ${a.username} 下线`, 'ok');
  } catch (e) {
    toastError(e);
  } finally {
    busy.value = false;
  }
}

async function del(a) {
  if (!window.confirm(`确定删除管理员「${a.username}」？该操作不可恢复。`)) return;
  busy.value = true;
  try {
    await api.deleteAdmin(a.id);
    toast(`已删除 ${a.username}`, 'ok');
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
  <div class="card">
    <div class="card-head">
      管理员账号
      <span class="sub">后台账号体系与用户端完全隔离</span>
      <div class="spacer"></div>
      <button
        v-if="canManage"
        type="button"
        class="btn sm primary"
        @click="openCreate"
      >+ 新建管理员</button>
      <button type="button" class="btn sm" @click="load">刷新</button>
    </div>

    <div class="table-wrap">
      <table class="tbl">
        <thead>
          <tr>
            <th style="width:64px">ID</th>
            <th style="width:150px">用户名</th>
            <th style="width:130px">显示名</th>
            <th style="width:110px">角色</th>
            <th style="width:88px">状态</th>
            <th>权限</th>
            <th style="width:150px">最近登录</th>
            <th v-if="canManage" style="width:230px">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in list" :key="a.id">
            <td class="num">#{{ a.id }}</td>
            <td>
              <span class="mono">{{ a.username }}</span>
              <span v-if="props.admin && a.id === props.admin.id" class="tag blue" style="margin-left:6px">当前</span>
            </td>
            <td>{{ a.displayName }}</td>
            <td>
              <span class="tag" :class="a.role === 'super' ? 'purple' : a.role === 'operator' ? 'blue' : 'gray'">
                {{ a.roleLabel }}
              </span>
            </td>
            <td>
              <span class="tag" :class="a.status === 'active' ? 'green' : 'red'">
                {{ a.status === 'active' ? '启用' : '停用' }}
              </span>
            </td>
            <td class="muted" style="font-size:12px">
              {{ a.role === 'super' ? '全部权限' : `${a.permissions.length} 项权限` }}
            </td>
            <td class="muted nowrap">
              {{ a.lastLoginAt ? fmtAgo(a.lastLoginAt) : '从未登录' }}
              <div v-if="a.lastLoginIp" class="mono" style="font-size:11px">{{ a.lastLoginIp }}</div>
            </td>
            <td v-if="canManage">
              <div class="btn-group">
                <button type="button" class="btn sm" @click="openEdit(a)">编辑</button>
                <button type="button" class="btn sm" @click="askPassword(a)">改密</button>
                <button type="button" class="btn sm" :disabled="busy" @click="revoke(a)">下线</button>
                <button
                  type="button"
                  class="btn sm danger"
                  :disabled="busy || (props.admin && a.id === props.admin.id)"
                  @click="del(a)"
                >删除</button>
              </div>
            </td>
          </tr>
          <tr v-if="!loading && !list.length"><td colspan="8" class="empty">暂无管理员</td></tr>
          <tr v-if="loading"><td colspan="8" class="loading">加载中…</td></tr>
        </tbody>
      </table>
    </div>

    <div class="card-body" style="border-top:1px solid var(--line)">
      <p class="hint" style="margin:0">
        角色说明：
        <span class="tag purple">超级管理员</span> 拥有全部权限，系统始终保留至少一个启用的超管；
        <span class="tag blue">运营</span> 可处理日常举报/反馈/用户/内容，但不能改功能开关与系统设置；
        <span class="tag gray">只读</span> 仅可查看。可在角色预设之外单独勾选额外权限。
      </p>
    </div>
  </div>

  <!-- 新建 / 编辑 -->
  <div v-if="dialog.open" class="mask" @click.self="dialog.open = false">
    <div class="dialog wide">
      <div class="dialog-title">
        {{ dialog.mode === 'create' ? '新建管理员' : `编辑管理员 ${dialog.target?.username}` }}
        <button type="button" class="x" @click="dialog.open = false">×</button>
      </div>
      <div class="dialog-body">
        <div class="grid cols-2" style="gap:14px">
          <div class="field">
            <label>用户名</label>
            <input
              v-model="dialog.username"
              class="input"
              type="text"
              :disabled="dialog.mode === 'edit'"
              placeholder="3-32 位字母/数字/_.-"
            />
          </div>
          <div class="field">
            <label>显示名</label>
            <input v-model="dialog.displayName" class="input" type="text" placeholder="便于识别的名称" />
          </div>
          <div v-if="dialog.mode === 'create'" class="field">
            <label>初始密码</label>
            <input v-model="dialog.password" class="input" type="text" placeholder="至少 8 位，含字母和数字" />
          </div>
          <div class="field">
            <label>角色</label>
            <select v-model="dialog.role" class="select">
              <option v-for="r in roles" :key="r.key" :value="r.key">{{ r.label }}</option>
            </select>
          </div>
          <div class="field">
            <label>状态</label>
            <select v-model="dialog.status" class="select">
              <option value="active">启用</option>
              <option value="disabled">停用</option>
            </select>
          </div>
        </div>

        <div class="divider"></div>
        <div class="muted" style="font-size:12px;margin-bottom:8px">
          额外权限（角色预设已包含的权限不可取消；超级管理员固定拥有全部权限）
        </div>
        <div class="grid cols-2" style="gap:8px">
          <label
            v-for="p in permissions"
            :key="p.key"
            class="row-flex"
            style="gap:8px;font-size:13px;cursor:pointer"
            :style="{ opacity: presetPerms.has(p.key) ? 0.5 : 1 }"
          >
            <input
              class="chk"
              type="checkbox"
              :checked="presetPerms.has(p.key) || dialog.perms.includes(p.key)"
              :disabled="presetPerms.has(p.key)"
              @change="togglePerm(p.key)"
            />
            <span>{{ p.label }}</span>
          </label>
        </div>
      </div>
      <div class="dialog-actions">
        <button type="button" class="btn" @click="dialog.open = false">取消</button>
        <button type="button" class="btn primary" :disabled="busy" @click="submit">
          {{ busy ? '提交中…' : '确定' }}
        </button>
      </div>
    </div>
  </div>

  <!-- 重置密码 -->
  <div v-if="pwdDialog.open" class="mask" @click.self="pwdDialog.open = false">
    <div class="dialog">
      <div class="dialog-title">
        重置密码 · {{ pwdDialog.target?.username }}
        <button type="button" class="x" @click="pwdDialog.open = false">×</button>
      </div>
      <div class="dialog-body">
        <div class="field" style="margin-bottom:0">
          <label>新密码</label>
          <input v-model="pwdDialog.password" class="input" type="text" placeholder="至少 8 位，含字母和数字" />
          <div class="hint">重置后该管理员所有后台会话会被强制下线。</div>
        </div>
      </div>
      <div class="dialog-actions">
        <button type="button" class="btn" @click="pwdDialog.open = false">取消</button>
        <button type="button" class="btn primary" :disabled="busy" @click="submitPassword">
          {{ busy ? '提交中…' : '确定' }}
        </button>
      </div>
    </div>
  </div>
</template>
