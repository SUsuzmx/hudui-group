<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import { api } from '../api.js';
import { fmtTime, debounce, downloadCsv, toast, toastError } from '../utils.js';
import Pager from '../components/Pager.vue';

const props = defineProps({ can: { type: Function, required: true } });
const emit = defineEmits(['refresh-badges']);

const list = ref([]);
const total = ref(0);
const stats = ref({});
const limit = ref(20);
const offset = ref(0);
const loading = ref(false);
const q = ref('');
const status = ref('');
const category = ref('');

const selected = ref([]);
const detail = ref(null);
const detailLoading = ref(false);
const busy = ref(false);
const dialog = reactive({ open: false, report: null, status: 'done', note: '', banTarget: false });
const bulkDialog = reactive({ open: false, status: 'done', note: '' });

const allChecked = computed({
  get: () => list.value.length > 0 && selected.value.length === list.value.length,
  set: (v) => { selected.value = v ? list.value.map((r) => r.id) : []; },
});

async function load() {
  loading.value = true;
  try {
    const r = await api.reports({
      q: q.value.trim(), status: status.value, category: category.value,
      limit: limit.value, offset: offset.value,
    });
    list.value = r.reports || [];
    total.value = r.total || 0;
    stats.value = r.stats || {};
    selected.value = selected.value.filter((id) => list.value.some((r2) => r2.id === id));
  } catch (e) {
    toastError(e);
  } finally {
    loading.value = false;
  }
}

const search = debounce(() => { offset.value = 0; load(); }, 320);

function filter(kind, v) {
  if (kind === 'status') status.value = v;
  else category.value = v;
  offset.value = 0;
  load();
}

function changePage(o) { offset.value = o; load(); }

async function openDetail(r) {
  detailLoading.value = true;
  detail.value = { report: r };
  try {
    detail.value = await api.report(r.id);
  } catch (e) {
    toastError(e);
    detail.value = null;
  } finally {
    detailLoading.value = false;
  }
}

function ask(report, st) {
  dialog.open = true;
  dialog.report = report;
  dialog.status = st;
  dialog.note = report.handlerNote || '';
  dialog.banTarget = false;
}

async function submit() {
  if (busy.value) return;
  busy.value = true;
  try {
    await api.handleReport(dialog.report.id, {
      status: dialog.status,
      handlerNote: dialog.note.trim(),
      banTarget: dialog.banTarget,
    });
    toast(`举报 #${dialog.report.id} 已更新为「${dialog.status}」`, 'ok');
    dialog.open = false;
    detail.value = null;
    await load();
    emit('refresh-badges');
  } catch (e) {
    toastError(e);
  } finally {
    busy.value = false;
  }
}

async function submitBulk() {
  if (busy.value || !selected.value.length) return;
  busy.value = true;
  try {
    const r = await api.bulkReports({
      ids: selected.value, status: bulkDialog.status, handlerNote: bulkDialog.note.trim(),
    });
    toast(`已批量处理 ${r.count} 条举报`, 'ok');
    bulkDialog.open = false;
    bulkDialog.note = '';
    selected.value = [];
    await load();
    emit('refresh-badges');
  } catch (e) {
    toastError(e);
  } finally {
    busy.value = false;
  }
}

function exportCsv() {
  downloadCsv(`reports-${Date.now()}.csv`, list.value, [
    { label: 'ID', value: (r) => r.id },
    { label: '分类', value: (r) => r.categoryLabel },
    { label: '对象类型', value: (r) => r.targetType },
    { label: '对象ID', value: (r) => r.targetId },
    { label: '举报人', value: (r) => r.reporterName || r.reporterId },
    { label: '描述', value: (r) => r.detail },
    { label: '状态', value: (r) => r.statusLabel },
    { label: '处理备注', value: (r) => r.handlerNote },
    { label: '提交时间', value: (r) => fmtTime(r.createdAt) },
  ]);
  toast(`已导出当前页 ${list.value.length} 条`, 'ok');
}

const STATUS_OPTIONS = [
  ['pending', '待处理'], ['processing', '处理中'], ['done', '已处理'], ['rejected', '未违规'],
];

function statusTag(s) {
  return s === 'pending' ? 'red' : s === 'processing' ? 'amber' : s === 'done' ? 'green' : 'gray';
}

onMounted(load);
</script>

<template>
  <!-- 统计 -->
  <div class="grid cols-4" style="margin-bottom:16px">
    <div class="stat danger"><div class="k">待处理</div><div class="v">{{ stats.pending || 0 }}</div></div>
    <div class="stat warn"><div class="k">处理中</div><div class="v">{{ stats.processing || 0 }}</div></div>
    <div class="stat ok"><div class="k">已处理</div><div class="v">{{ stats.done || 0 }}</div></div>
    <div class="stat"><div class="k">未违规</div><div class="v">{{ stats.rejected || 0 }}</div></div>
  </div>

  <div class="card">
    <div class="filters">
      <input v-model="q" class="input" type="search" placeholder="搜索描述 / 对象 ID / 举报 ID" @input="search" />
      <select class="select" :value="status" @change="filter('status', $event.target.value)">
        <option value="">全部状态</option>
        <option v-for="s in STATUS_OPTIONS" :key="s[0]" :value="s[0]">{{ s[1] }}</option>
      </select>
      <select class="select" :value="category" @change="filter('category', $event.target.value)">
        <option value="">全部分类</option>
        <option value="spam">垃圾广告</option>
        <option value="abuse">辱骂骚扰</option>
        <option value="porn">色情低俗</option>
        <option value="fraud">诈骗欺诈</option>
        <option value="illegal">违法违规</option>
        <option value="other">其他</option>
      </select>
      <div class="spacer"></div>
      <template v-if="props.can('reports.manage') && selected.length">
        <span class="muted">已选 {{ selected.length }}</span>
        <button type="button" class="btn sm primary" @click="bulkDialog.open = true">批量处置</button>
      </template>
      <button type="button" class="btn sm" @click="exportCsv">导出 CSV</button>
      <button type="button" class="btn sm" @click="load">刷新</button>
    </div>

    <div class="table-wrap">
      <table class="tbl">
        <thead>
          <tr>
            <th v-if="props.can('reports.manage')" style="width:36px">
              <input v-model="allChecked" class="chk" type="checkbox" />
            </th>
            <th style="width:60px">ID</th>
            <th style="width:96px">分类</th>
            <th style="width:110px">举报对象</th>
            <th>描述</th>
            <th style="width:96px">举报人</th>
            <th style="width:88px">状态</th>
            <th style="width:150px">提交时间</th>
            <th style="width:170px">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in list" :key="r.id">
            <td v-if="props.can('reports.manage')">
              <input v-model="selected" class="chk" type="checkbox" :value="r.id" />
            </td>
            <td class="num">#{{ r.id }}</td>
            <td><span class="tag gray">{{ r.categoryLabel }}</span></td>
            <td class="mono muted">{{ r.targetType }}:{{ r.targetId }}</td>
            <td class="ellip clickable" @click="openDetail(r)">{{ r.detail || '（无描述）' }}</td>
            <td class="muted">{{ r.reporterName || `#${r.reporterId}` }}</td>
            <td><span class="tag" :class="statusTag(r.status)">{{ r.statusLabel }}</span></td>
            <td class="muted nowrap">{{ fmtTime(r.createdAt) }}</td>
            <td>
              <div class="btn-group">
                <button type="button" class="btn sm" @click="openDetail(r)">详情</button>
                <template v-if="props.can('reports.manage') && (r.status === 'pending' || r.status === 'processing')">
                  <button type="button" class="btn sm" @click="ask(r, 'processing')">处理中</button>
                  <button type="button" class="btn sm primary" @click="ask(r, 'done')">已处理</button>
                </template>
              </div>
            </td>
          </tr>
          <tr v-if="!loading && !list.length">
            <td :colspan="props.can('reports.manage') ? 9 : 8" class="empty">
              <span class="ico">✅</span>暂无举报
            </td>
          </tr>
          <tr v-if="loading">
            <td :colspan="props.can('reports.manage') ? 9 : 8" class="loading">加载中…</td>
          </tr>
        </tbody>
      </table>
    </div>

    <Pager :total="total" :limit="limit" :offset="offset" unit="条举报" @change="changePage" />
  </div>

  <!-- 详情 -->
  <div v-if="detail" class="mask" @click.self="detail = null">
    <div class="dialog wide">
      <div class="dialog-title">
        举报详情
        <button type="button" class="x" @click="detail = null">×</button>
      </div>
      <div class="dialog-body">
        <div v-if="detailLoading" class="loading">加载中…</div>
        <template v-else-if="detail.report">
          <div class="kv">
            <span class="k">举报 ID</span><span class="v">#{{ detail.report.id }}</span>
            <span class="k">分类</span><span class="v">{{ detail.report.categoryLabel }}</span>
            <span class="k">状态</span>
            <span class="v"><span class="tag" :class="statusTag(detail.report.status)">{{ detail.report.statusLabel }}</span></span>
            <span class="k">举报对象</span><span class="v mono">{{ detail.report.targetType }}:{{ detail.report.targetId }}</span>
            <span class="k">举报人</span>
            <span class="v">{{ detail.report.reporterName || '—' }}（#{{ detail.report.reporterId }}）</span>
            <span class="k">提交时间</span><span class="v">{{ fmtTime(detail.report.createdAt) }}</span>
            <span v-if="detail.report.handledAt" class="k">处理时间</span>
            <span v-if="detail.report.handledAt" class="v">{{ fmtTime(detail.report.handledAt) }}</span>
          </div>

          <div class="divider"></div>
          <div class="muted" style="font-size:12px;margin-bottom:4px">举报描述</div>
          <p class="prewrap" style="margin:0">{{ detail.report.detail || '（无描述）' }}</p>

          <template v-if="detail.target">
            <div class="divider"></div>
            <div class="muted" style="font-size:12px;margin-bottom:4px">被举报内容</div>
            <div class="kv">
              <template v-if="detail.target.type === 'user'">
                <span class="k">用户</span>
                <span class="v">#{{ detail.target.id }} {{ detail.target.nickname }}
                  <span v-if="detail.target.banned" class="tag red">已封禁</span>
                </span>
              </template>
              <template v-else-if="detail.target.type === 'moment'">
                <span class="k">动态 ID</span><span class="v">#{{ detail.target.id }}（作者 #{{ detail.target.userId }}）</span>
                <span class="k">内容</span><span class="v prewrap">{{ detail.target.content || '（仅图片）' }}</span>
              </template>
              <template v-else-if="detail.target.type === 'message'">
                <span class="k">消息 ID</span><span class="v">#{{ detail.target.id }}（会话 {{ detail.target.conversationId || 'default' }}）</span>
                <span class="k">发送者</span><span class="v">{{ detail.target.senderName }}</span>
                <span class="k">内容</span><span class="v prewrap">{{ detail.target.content }}</span>
              </template>
              <template v-else-if="detail.target.type === 'group'">
                <span class="k">群组</span><span class="v">#{{ detail.target.id }} {{ detail.target.name }}</span>
              </template>
            </div>
          </template>

          <div v-if="detail.report.handlerNote" style="margin-top:14px">
            <div class="muted" style="font-size:12px;margin-bottom:4px">处理备注</div>
            <p class="prewrap" style="margin:0">{{ detail.report.handlerNote }}</p>
          </div>
        </template>
      </div>
      <div v-if="detail.report && props.can('reports.manage')" class="dialog-actions">
        <button type="button" class="btn sm" @click="ask(detail.report, 'processing')">标记处理中</button>
        <button type="button" class="btn sm primary" @click="ask(detail.report, 'done')">标记已处理</button>
        <button type="button" class="btn sm" @click="ask(detail.report, 'rejected')">判定未违规</button>
      </div>
    </div>
  </div>

  <!-- 处置 -->
  <div v-if="dialog.open" class="mask" @click.self="dialog.open = false">
    <div class="dialog">
      <div class="dialog-title">
        处置举报 #{{ dialog.report?.id }}
        <button type="button" class="x" @click="dialog.open = false">×</button>
      </div>
      <div class="dialog-body">
        <div class="field">
          <label>处置结果</label>
          <select v-model="dialog.status" class="select">
            <option v-for="s in STATUS_OPTIONS" :key="s[0]" :value="s[0]">{{ s[1] }}</option>
          </select>
        </div>
        <div class="field">
          <label>处理备注（可选）</label>
          <textarea v-model="dialog.note" class="textarea" rows="3" placeholder="记录处置依据，便于追溯"></textarea>
        </div>
        <label
          v-if="dialog.report?.targetType === 'user'"
          class="row-flex"
          style="gap:8px;font-size:13px;cursor:pointer"
        >
          <input v-model="dialog.banTarget" class="chk" type="checkbox" />
          <span>同时封禁被举报用户</span>
        </label>
      </div>
      <div class="dialog-actions">
        <button type="button" class="btn" @click="dialog.open = false">取消</button>
        <button type="button" class="btn primary" :disabled="busy" @click="submit">
          {{ busy ? '提交中…' : '确定' }}
        </button>
      </div>
    </div>
  </div>

  <!-- 批量 -->
  <div v-if="bulkDialog.open" class="mask" @click.self="bulkDialog.open = false">
    <div class="dialog">
      <div class="dialog-title">
        批量处置 {{ selected.length }} 条举报
        <button type="button" class="x" @click="bulkDialog.open = false">×</button>
      </div>
      <div class="dialog-body">
        <div class="field">
          <label>统一处置结果</label>
          <select v-model="bulkDialog.status" class="select">
            <option v-for="s in STATUS_OPTIONS" :key="s[0]" :value="s[0]">{{ s[1] }}</option>
          </select>
        </div>
        <div class="field">
          <label>统一备注（可选）</label>
          <textarea v-model="bulkDialog.note" class="textarea" rows="3"></textarea>
        </div>
      </div>
      <div class="dialog-actions">
        <button type="button" class="btn" @click="bulkDialog.open = false">取消</button>
        <button type="button" class="btn primary" :disabled="busy" @click="submitBulk">
          {{ busy ? '提交中…' : '确定' }}
        </button>
      </div>
    </div>
  </div>
</template>
