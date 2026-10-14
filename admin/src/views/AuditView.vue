<script setup>
import { ref, onMounted } from 'vue';
import { api } from '../api.js';
import { fmtTime, debounce, downloadCsv, toast, toastError } from '../utils.js';
import Pager from '../components/Pager.vue';

const props = defineProps({ can: { type: Function, required: true } });

const list = ref([]);
const total = ref(0);
const modules = ref([]);
const limit = ref(50);
const offset = ref(0);
const loading = ref(false);
const q = ref('');
const module = ref('');

async function load() {
  loading.value = true;
  try {
    const r = await api.audit({
      q: q.value.trim(), module: module.value, limit: limit.value, offset: offset.value,
    });
    list.value = r.logs || [];
    total.value = r.total || 0;
  } catch (e) {
    toastError(e);
  } finally {
    loading.value = false;
  }
}

async function loadModules() {
  try {
    const r = await api.auditModules();
    modules.value = r.modules || [];
  } catch { /* ignore */ }
}

const search = debounce(() => { offset.value = 0; load(); }, 320);

function filterModule(m) {
  module.value = m;
  offset.value = 0;
  load();
}

function changePage(o) { offset.value = o; load(); }

function exportCsv() {
  downloadCsv(`audit-${Date.now()}.csv`, list.value, [
    { label: 'ID', value: (r) => r.id },
    { label: '时间', value: (r) => fmtTime(r.createdAt) },
    { label: '管理员', value: (r) => r.adminName },
    { label: '模块', value: (r) => r.module },
    { label: '操作', value: (r) => r.action },
    { label: '对象类型', value: (r) => r.targetType },
    { label: '对象ID', value: (r) => r.targetId },
    { label: '详情', value: (r) => r.detail },
    { label: 'IP', value: (r) => r.ip },
  ]);
  toast(`已导出当前页 ${list.value.length} 条`, 'ok');
}

const MODULE_LABELS = {
  auth: '登录鉴权', users: '用户管理', reports: '举报管理', feedback: '反馈管理',
  errors: '错误监控', flags: '功能开关', settings: '系统设置',
  content: '内容治理', admins: '管理员账号',
};

function moduleLabel(m) {
  return MODULE_LABELS[m] || m || '(未标注)';
}

onMounted(() => {
  load();
  loadModules();
});
</script>

<template>
  <div class="card">
    <div class="filters">
      <input v-model="q" class="input" type="search" placeholder="搜索操作 / 对象 / 详情 / 管理员" @input="search" />
      <select class="select" :value="module" @change="filterModule($event.target.value)">
        <option value="">全部模块</option>
        <option v-for="m in modules" :key="m.module" :value="m.module">
          {{ moduleLabel(m.module) }}（{{ m.count }}）
        </option>
      </select>
      <div class="spacer"></div>
      <button type="button" class="btn sm" @click="exportCsv">导出 CSV</button>
      <button type="button" class="btn sm" @click="load">刷新</button>
    </div>

    <div class="table-wrap">
      <table class="tbl">
        <thead>
          <tr>
            <th style="width:170px">时间</th>
            <th style="width:110px">管理员</th>
            <th style="width:100px">模块</th>
            <th style="width:130px">操作</th>
            <th style="width:150px">对象</th>
            <th>详情</th>
            <th style="width:130px">IP</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="l in list" :key="l.id">
            <td class="muted nowrap">{{ fmtTime(l.createdAt) }}</td>
            <td>{{ l.adminName || '—' }}</td>
            <td><span class="tag blue">{{ moduleLabel(l.module) }}</span></td>
            <td class="mono">{{ l.action }}</td>
            <td class="mono muted">
              {{ l.targetType ? `${l.targetType}:${l.targetId}` : '—' }}
            </td>
            <td class="ellip">{{ l.detail }}</td>
            <td class="mono muted">{{ l.ip || '—' }}</td>
          </tr>
          <tr v-if="!loading && !list.length">
            <td colspan="7" class="empty"><span class="ico">📜</span>暂无审计记录</td>
          </tr>
          <tr v-if="loading"><td colspan="7" class="loading">加载中…</td></tr>
        </tbody>
      </table>
    </div>

    <Pager :total="total" :limit="limit" :offset="offset" unit="条记录" @change="changePage" />
  </div>
</template>
