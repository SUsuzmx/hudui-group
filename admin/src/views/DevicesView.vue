<script setup>
import { ref, onMounted } from 'vue';
import { api } from '../api.js';
import { fmtAgo, debounce, toast, toastError } from '../utils.js';
import Pager from '../components/Pager.vue';

const props = defineProps({ can: { type: Function, required: true } });

const list = ref([]);
const total = ref(0);
const limit = ref(20);
const offset = ref(0);
const loading = ref(false);
const q = ref('');
const selected = ref([]);
const busy = ref(false);

const dialog = ref({ open: false, deviceId: '', sig: '', nickname: '', reason: '' });
const unbanDialog = ref({ open: false, deviceId: '' });

async function load() {
  loading.value = true;
  try {
    const r = await api.devices({ q: q.value.trim(), limit: limit.value, offset: offset.value });
    list.value = r.devices || [];
    total.value = r.total || 0;
    selected.value = selected.value.filter((id) => list.value.some((d) => d.deviceId === id && !d.banned));
  } catch (e) {
    toastError(e);
  } finally {
    loading.value = false;
  }
}

const search = debounce(() => { offset.value = 0; load(); }, 320);
function changePage(o) { offset.value = o; load(); }

function short(id) {
  return String(id || '').slice(0, 12) + '…';
}

function askBan(d) {
  dialog.value = { open: true, deviceId: d.deviceId, sig: d.sigHash || '', nickname: d.lastUserNickname || '', reason: '' };
}

async function runBan() {
  if (busy.value) return;
  busy.value = true;
  try {
    await api.banDevice(dialog.value.deviceId, dialog.value.reason.trim(), dialog.value.sig);
    toast('设备已封禁（含特征指纹），清缓存/无痕模式也无法再注册或登录', 'ok');
    dialog.value.open = false;
    await load();
  } catch (e) {
    toastError(e);
  } finally {
    busy.value = false;
  }
}

async function runUnban(d) {
  if (busy.value) return;
  busy.value = true;
  try {
    await api.unbanDevice(d.deviceId);
    toast('已解除该设备封禁', 'ok');
    unbanDialog.value.open = false;
    await load();
  } catch (e) {
    toastError(e);
  } finally {
    busy.value = false;
  }
}

async function runBulkBan() {
  if (busy.value || !selected.value.length) return;
  busy.value = true;
  try {
    const r = await api.bulkBanDevices(selected.value, '');
    toast(`已批量封禁 ${r.count} 台设备`, 'ok');
    selected.value = [];
    await load();
  } catch (e) {
    toastError(e);
  } finally {
    busy.value = false;
  }
}

const allChecked = ref(false);
function toggleAll(v) {
  selected.value = v ? list.value.filter((d) => !d.banned).map((d) => d.deviceId) : [];
}

onMounted(load);
</script>

<template>
  <div class="card">
    <div class="filters">
      <input
        v-model="q"
        class="input"
        type="search"
        placeholder="搜索最后使用用户 / IP / 设备 ID"
        @input="search"
      />
      <select class="select" @change="limit = Number($event.target.value); offset = 0; load()">
        <option :value="20">每页 20 条</option>
        <option :value="50">每页 50 条</option>
        <option :value="100">每页 100 条</option>
      </select>
      <div class="spacer"></div>
      <template v-if="props.can('users.manage') && selected.length">
        <span class="muted">已选 {{ selected.length }}</span>
        <button type="button" class="btn sm danger" @click="runBulkBan">批量封禁</button>
      </template>
      <button type="button" class="btn sm" @click="load">刷新</button>
    </div>

    <p class="hint" style="margin: 10px 0 0">
      封禁设备后，该设备将<b>无法注册新账号、无法登录任何账号</b>（包括已经在用的账号，会立即下线）。
      同一行下的「特征指纹」不依赖浏览器存储：<b>清缓存、无痕模式都无法绕过封禁</b>；且同一特征指纹 24 小时内最多注册 3 个账号。
      设备在用户注册或登录时自动登记；同一特征指纹出现多行说明该设备清过缓存（换 ID 不换特征），封禁会传播到所有行。
    </p>

    <div class="table-wrap" style="margin-top:10px">
      <table class="tbl">
        <thead>
          <tr>
            <th v-if="props.can('users.manage')" style="width:36px">
              <input type="checkbox" class="chk" :checked="allChecked" @change="toggleAll($event.target.checked)" />
            </th>
            <th style="width:140px">设备 ID</th>
            <th style="width:120px">特征指纹</th>
            <th style="width:130px">最后使用用户</th>
            <th style="width:130px">最后 IP</th>
            <th>最后 UA</th>
            <th style="width:150px">最后活跃</th>
            <th style="width:110px">状态</th>
            <th style="width:160px">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in list" :key="d.deviceId || d.sigHash">
            <td v-if="props.can('users.manage')">
              <input v-if="!d.banned && d.deviceId" v-model="selected" class="chk" type="checkbox" :value="d.deviceId" />
            </td>
            <td class="mono muted" :title="d.deviceId">
              <template v-if="d.deviceId">{{ short(d.deviceId) }}</template>
              <span v-else class="muted">（无）</span>
            </td>
            <td>
              <span v-if="d.sigHash" class="mono muted" :title="d.sigHash">{{ short(d.sigHash) }}</span>
              <span v-else class="muted">—</span>
            </td>
            <td>
              <template v-if="d.lastUserId">
                <span class="clickable">#{{ d.lastUserId }} {{ d.lastUserNickname }}</span>
              </template>
              <span v-else class="muted">—</span>
            </td>
            <td class="mono">{{ d.lastIp || '—' }}</td>
            <td class="ellip muted" :title="d.lastUa">{{ d.lastUa || '—' }}</td>
            <td class="muted nowrap">{{ d.lastSeenAt ? fmtAgo(d.lastSeenAt) : '—' }}</td>
            <td>
              <span v-if="d.banned" class="tag red" :title="d.reason">已封禁</span>
              <span v-else class="tag green">正常</span>
            </td>
            <td>
              <div class="btn-group">
                <template v-if="props.can('users.manage')">
                  <button v-if="!d.banned" type="button" class="btn sm danger" @click="askBan(d)">封禁</button>
                  <button v-else type="button" class="btn sm" @click="unbanDialog = { open: true, deviceId: d.deviceId }">解封</button>
                </template>
                <span v-else class="muted">只读</span>
              </div>
            </td>
          </tr>
          <tr v-if="!loading && !list.length">
            <td :colspan="props.can('users.manage') ? 9 : 8" class="empty"><span class="ico">📵</span>暂无设备记录，用户注册或登录后会自动登记</td>
          </tr>
          <tr v-if="loading">
            <td :colspan="props.can('users.manage') ? 9 : 8" class="loading">加载中…</td>
          </tr>
        </tbody>
      </table>
    </div>

    <Pager :total="total" :limit="limit" :offset="offset" unit="台设备" @change="changePage" />
  </div>

  <!-- 封禁确认 -->
  <div v-if="dialog.open" class="mask" @click.self="dialog.open = false">
    <div class="dialog">
      <div class="dialog-title">
        封禁设备
        <button type="button" class="x" @click="dialog.open = false">×</button>
      </div>
      <div class="dialog-body">
        <p style="margin-top:0">
          设备 <code class="mono">{{ short(dialog.deviceId) }}</code>
          <template v-if="dialog.sig"> · 特征指纹 <code class="mono" :title="dialog.sig">{{ short(dialog.sig) }}</code></template>
          <template v-if="dialog.nickname">（最后使用：{{ dialog.nickname }}）</template>
        </p>
        <div class="field">
          <label>封禁原因</label>
          <textarea v-model="dialog.reason" class="textarea" rows="3" placeholder="将记录在审计日志"></textarea>
        </div>
        <p class="hint">
          封禁后该设备无法注册、无法登录任何账号，已登记用户会话立即失效。
          <template v-if="dialog.sig">特征指纹一并封禁：<b>清除浏览器缓存、无痕模式、换账号都无法绕过</b>（浏览器大版本升级或换设备才会变化）。</template>
        </p>
      </div>
      <div class="dialog-actions">
        <button type="button" class="btn" @click="dialog.open = false">取消</button>
        <button type="button" class="btn danger" :disabled="busy" @click="runBan">{{ busy ? '处理中…' : '确认封禁' }}</button>
      </div>
    </div>
  </div>

  <!-- 解封确认 -->
  <div v-if="unbanDialog.open" class="mask" @click.self="unbanDialog.open = false">
    <div class="dialog">
      <div class="dialog-title">
        解除设备封禁
        <button type="button" class="x" @click="unbanDialog.open = false">×</button>
      </div>
      <div class="dialog-body">
        <p style="margin-top:0">设备 <code class="mono">{{ short(unbanDialog.deviceId) }}</code></p>
        <p class="hint">解除后该设备可以正常注册和登录。</p>
      </div>
      <div class="dialog-actions">
        <button type="button" class="btn" @click="unbanDialog.open = false">取消</button>
        <button type="button" class="btn primary" :disabled="busy" @click="runUnban({ deviceId: unbanDialog.deviceId })">{{ busy ? '处理中…' : '确认解封' }}</button>
      </div>
    </div>
  </div>
</template>
