<script setup>
import { ref, reactive, onMounted } from 'vue';
import { api } from '../api.js';
import { fmtTime, debounce, downloadCsv, toast, toastError } from '../utils.js';
import BarChart from '../components/BarChart.vue';
import Pager from '../components/Pager.vue';

const props = defineProps({ can: { type: Function, required: true } });
const emit = defineEmits(['refresh-badges']);

const list = ref([]);
const total = ref(0);
const limit = ref(30);
const offset = ref(0);
const loading = ref(false);
const q = ref('');
const feature = ref('');

const statsData = ref(null);
const days = ref(14);

const detail = ref(null);
const busy = ref(false);
const purgeDialog = reactive({ open: false, days: 30, feature: '' });

async function load() {
  loading.value = true;
  try {
    const r = await api.errors({
      q: q.value.trim(), feature: feature.value, limit: limit.value, offset: offset.value,
    });
    list.value = r.errors || [];
    total.value = r.total || 0;
  } catch (e) {
    toastError(e);
  } finally {
    loading.value = false;
  }
}

async function loadStats() {
  try {
    statsData.value = await api.errorStats(days.value);
  } catch (e) {
    toastError(e);
  }
}

const search = debounce(() => { offset.value = 0; load(); }, 320);

function filterFeature(f) {
  feature.value = f;
  offset.value = 0;
  load();
}

function changePage(o) { offset.value = o; load(); }

function setDays(d) { days.value = d; loadStats(); }

async function del(e) {
  busy.value = true;
  try {
    await api.deleteError(e.id);
    toast('已删除该错误记录', 'ok');
    detail.value = null;
    await Promise.all([load(), loadStats()]);
    emit('refresh-badges');
  } catch (err) {
    toastError(err);
  } finally {
    busy.value = false;
  }
}

async function purge() {
  if (busy.value) return;
  const before = purgeDialog.days > 0 ? Date.now() - purgeDialog.days * 86400_000 : 0;
  if (!before && !purgeDialog.feature) {
    toast('请指定清理范围', 'error');
    return;
  }
  busy.value = true;
  try {
    const r = await api.purgeErrors({ before, feature: purgeDialog.feature });
    toast(`已清理 ${r.deleted} 条错误记录`, 'ok');
    purgeDialog.open = false;
    await Promise.all([load(), loadStats()]);
    emit('refresh-badges');
  } catch (e) {
    toastError(e);
  } finally {
    busy.value = false;
  }
}

function exportCsv() {
  downloadCsv(`errors-${Date.now()}.csv`, list.value, [
    { label: 'ID', value: (r) => r.id },
    { label: '模块', value: (r) => r.feature },
    { label: '用户ID', value: (r) => r.userId },
    { label: '错误信息', value: (r) => r.message },
    { label: '堆栈', value: (r) => r.stack },
    { label: '时间', value: (r) => fmtTime(r.createdAt) },
  ]);
  toast(`已导出当前页 ${list.value.length} 条`, 'ok');
}

onMounted(() => {
  load();
  loadStats();
});
</script>

<template>
  <!-- 统计 -->
  <div class="grid cols-2" style="margin-bottom:16px">
    <div class="card" style="margin:0">
      <div class="card-head">
        错误趋势
        <div class="spacer"></div>
        <div class="btn-group">
          <button
            v-for="d in [7, 14, 30]"
            :key="d"
            type="button"
            class="btn sm"
            :class="{ primary: days === d }"
            @click="setDays(d)"
          >{{ d }}天</button>
        </div>
      </div>
      <div class="card-body">
        <BarChart :data="statsData?.trend || []" :height="110" color="linear-gradient(180deg,#fca5a5,#dc2626)" />
      </div>
    </div>

    <div class="card" style="margin:0">
      <div class="card-head">模块分布</div>
      <div class="card-body" style="max-height:200px;overflow-y:auto">
        <div v-if="!statsData?.byFeature?.length" class="muted">暂无错误 🎉</div>
        <div v-else class="bar-list">
          <div
            v-for="r in statsData.byFeature"
            :key="r.feature"
            class="bar-row clickable"
            @click="filterFeature(r.feature)"
          >
            <span class="name" :title="r.feature">{{ r.feature }}</span>
            <span class="track">
              <span
                class="fill"
                style="background:#dc2626"
                :style="{ width: `${Math.round((r.count / Math.max(1, statsData.byFeature[0].count)) * 100)}%` }"
              ></span>
            </span>
            <span class="n">{{ r.count }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- 高频消息 -->
  <div v-if="statsData?.topMessages?.length" class="card">
    <div class="card-head">高频错误信息（近 {{ days }} 天）</div>
    <div class="card-body tight">
      <table class="tbl">
        <thead><tr><th style="width:64px">次数</th><th>错误信息</th><th style="width:170px">最近出现</th></tr></thead>
        <tbody>
          <tr v-for="(m, i) in statsData.topMessages" :key="i">
            <td class="num"><span class="tag red">{{ m.count }}</span></td>
            <td class="ellip">{{ m.message }}</td>
            <td class="muted nowrap">{{ fmtTime(m.lastAt) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <!-- 列表 -->
  <div class="card">
    <div class="filters">
      <input v-model="q" class="input" type="search" placeholder="搜索错误信息 / 堆栈" @input="search" />
      <input
        :value="feature"
        class="input"
        type="text"
        placeholder="按模块筛选"
        @input="feature = $event.target.value"
        @change="filterFeature(feature)"
      />
      <button v-if="feature" type="button" class="btn sm" @click="filterFeature('')">清除模块</button>
      <div class="spacer"></div>
      <button v-if="props.can('errors.manage')" type="button" class="btn sm" @click="purgeDialog.open = true">批量清理</button>
      <button type="button" class="btn sm" @click="exportCsv">导出 CSV</button>
      <button type="button" class="btn sm" @click="load">刷新</button>
    </div>

    <div class="table-wrap">
      <table class="tbl">
        <thead>
          <tr>
            <th style="width:64px">ID</th>
            <th style="width:120px">模块</th>
            <th style="width:70px">用户</th>
            <th>错误信息</th>
            <th style="width:170px">时间</th>
            <th style="width:120px">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in list" :key="e.id">
            <td class="num">#{{ e.id }}</td>
            <td><span class="tag red">{{ e.feature || '(未标注)' }}</span></td>
            <td class="muted">{{ e.userId ? `#${e.userId}` : '—' }}</td>
            <td class="ellip clickable" @click="detail = e">{{ e.message }}</td>
            <td class="muted nowrap">{{ fmtTime(e.createdAt) }}</td>
            <td>
              <div class="btn-group">
                <button type="button" class="btn sm" @click="detail = e">详情</button>
                <button
                  v-if="props.can('errors.manage')"
                  type="button"
                  class="btn sm danger"
                  :disabled="busy"
                  @click="del(e)"
                >删除</button>
              </div>
            </td>
          </tr>
          <tr v-if="!loading && !list.length">
            <td colspan="6" class="empty"><span class="ico">🎉</span>暂无错误记录</td>
          </tr>
          <tr v-if="loading"><td colspan="6" class="loading">加载中…</td></tr>
        </tbody>
      </table>
    </div>

    <Pager :total="total" :limit="limit" :offset="offset" unit="条记录" @change="changePage" />
  </div>

  <!-- 详情 -->
  <div v-if="detail" class="mask" @click.self="detail = null">
    <div class="dialog wide">
      <div class="dialog-title">
        错误详情 #{{ detail.id }}
        <button type="button" class="x" @click="detail = null">×</button>
      </div>
      <div class="dialog-body">
        <div class="kv">
          <span class="k">模块</span><span class="v"><span class="tag red">{{ detail.feature || '(未标注)' }}</span></span>
          <span class="k">用户</span><span class="v">{{ detail.userId ? `#${detail.userId}` : '—' }}</span>
          <span class="k">时间</span><span class="v">{{ fmtTime(detail.createdAt) }}</span>
          <span class="k">错误信息</span><span class="v prewrap">{{ detail.message }}</span>
        </div>
        <template v-if="detail.meta && Object.keys(detail.meta).length">
          <div class="divider"></div>
          <div class="muted" style="font-size:12px;margin-bottom:4px">上下文 (meta)</div>
          <pre class="stack">{{ JSON.stringify(detail.meta, null, 2) }}</pre>
        </template>
        <template v-if="detail.stack">
          <div class="divider"></div>
          <div class="muted" style="font-size:12px">堆栈</div>
          <pre class="stack">{{ detail.stack }}</pre>
        </template>
      </div>
      <div class="dialog-actions">
        <button type="button" class="btn" @click="detail = null">关闭</button>
        <button
          v-if="props.can('errors.manage')"
          type="button"
          class="btn danger"
          :disabled="busy"
          @click="del(detail)"
        >删除记录</button>
      </div>
    </div>
  </div>

  <!-- 批量清理 -->
  <div v-if="purgeDialog.open" class="mask" @click.self="purgeDialog.open = false">
    <div class="dialog">
      <div class="dialog-title">
        批量清理错误记录
        <button type="button" class="x" @click="purgeDialog.open = false">×</button>
      </div>
      <div class="dialog-body">
        <div class="field">
          <label>清理范围</label>
          <select v-model.number="purgeDialog.days" class="select">
            <option :value="7">清理 7 天前的记录</option>
            <option :value="30">清理 30 天前的记录</option>
            <option :value="90">清理 90 天前的记录</option>
            <option :value="0">不限时间（需配合模块）</option>
          </select>
        </div>
        <div class="field" style="margin-bottom:0">
          <label>限定模块（可选）</label>
          <input v-model="purgeDialog.feature" class="input" type="text" placeholder="留空表示所有模块" />
          <div class="hint">为避免误删全部数据，时间与模块至少需指定一项。</div>
        </div>
      </div>
      <div class="dialog-actions">
        <button type="button" class="btn" @click="purgeDialog.open = false">取消</button>
        <button type="button" class="btn danger" :disabled="busy" @click="purge">
          {{ busy ? '清理中…' : '确认清理' }}
        </button>
      </div>
    </div>
  </div>
</template>
