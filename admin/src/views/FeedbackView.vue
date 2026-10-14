<script setup>
import { ref, reactive, onMounted } from 'vue';
import { api } from '../api.js';
import { fmtTime, debounce, downloadCsv, toast, toastError } from '../utils.js';
import Pager from '../components/Pager.vue';

const props = defineProps({ can: { type: Function, required: true } });
const emit = defineEmits(['refresh-badges']);

const list = ref([]);
const total = ref(0);
const stats = ref({ byStatus: {}, byCategory: {} });
const limit = ref(20);
const offset = ref(0);
const loading = ref(false);
const q = ref('');
const status = ref('');
const category = ref('');

const busy = ref(false);
const dialog = reactive({ open: false, item: null, reply: '' });

const CATEGORY_LABELS = {
  bug: '功能异常', suggestion: '产品建议', ui: '界面体验', account: '账号问题', other: '其他',
};

async function load() {
  loading.value = true;
  try {
    const r = await api.feedback({
      q: q.value.trim(), status: status.value, category: category.value,
      limit: limit.value, offset: offset.value,
    });
    list.value = r.feedbacks || [];
    total.value = r.total || 0;
    stats.value = r.stats || { byStatus: {}, byCategory: {} };
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

function askReply(item) {
  dialog.open = true;
  dialog.item = item;
  dialog.reply = item.reply || '';
}

async function submitReply() {
  if (busy.value) return;
  const text = dialog.reply.trim();
  if (!text) { toast('请输入回复内容', 'error'); return; }
  busy.value = true;
  try {
    await api.replyFeedback(dialog.item.id, text);
    toast(`已回复反馈 #${dialog.item.id}`, 'ok');
    dialog.open = false;
    await load();
    emit('refresh-badges');
  } catch (e) {
    toastError(e);
  } finally {
    busy.value = false;
  }
}

async function toggleClose(item) {
  busy.value = true;
  try {
    if (item.status === 'closed') {
      await api.reopenFeedback(item.id);
      toast('已重新打开', 'ok');
    } else {
      await api.closeFeedback(item.id);
      toast('已关闭', 'ok');
    }
    await load();
    emit('refresh-badges');
  } catch (e) {
    toastError(e);
  } finally {
    busy.value = false;
  }
}

function exportCsv() {
  downloadCsv(`feedback-${Date.now()}.csv`, list.value, [
    { label: 'ID', value: (r) => r.id },
    { label: '分类', value: (r) => r.categoryLabel },
    { label: '用户', value: (r) => r.userName || `#${r.userId}` },
    { label: '内容', value: (r) => r.content },
    { label: '联系方式', value: (r) => r.contact },
    { label: '状态', value: (r) => r.statusLabel },
    { label: '回复', value: (r) => r.reply },
    { label: '处理人', value: (r) => r.handledBy },
    { label: '提交时间', value: (r) => fmtTime(r.createdAt) },
  ]);
  toast(`已导出当前页 ${list.value.length} 条`, 'ok');
}

function statusTag(s) {
  return s === 'open' ? 'red' : s === 'replied' ? 'green' : 'gray';
}

onMounted(load);
</script>

<template>
  <div class="grid cols-4" style="margin-bottom:16px">
    <div class="stat danger"><div class="k">待处理</div><div class="v">{{ stats.byStatus?.open || 0 }}</div></div>
    <div class="stat ok"><div class="k">已回复</div><div class="v">{{ stats.byStatus?.replied || 0 }}</div></div>
    <div class="stat"><div class="k">已关闭</div><div class="v">{{ stats.byStatus?.closed || 0 }}</div></div>
    <div class="stat accent"><div class="k">总计</div><div class="v">{{ total }}</div></div>
  </div>

  <div class="card">
    <div class="filters">
      <input v-model="q" class="input" type="search" placeholder="搜索内容 / 联系方式 / 反馈 ID" @input="search" />
      <select class="select" :value="status" @change="filter('status', $event.target.value)">
        <option value="">全部状态</option>
        <option value="open">待处理</option>
        <option value="replied">已回复</option>
        <option value="closed">已关闭</option>
      </select>
      <select class="select" :value="category" @change="filter('category', $event.target.value)">
        <option value="">全部分类</option>
        <option v-for="(label, key) in CATEGORY_LABELS" :key="key" :value="key">{{ label }}</option>
      </select>
      <div class="spacer"></div>
      <button type="button" class="btn sm" @click="exportCsv">导出 CSV</button>
      <button type="button" class="btn sm" @click="load">刷新</button>
    </div>

    <div class="table-wrap">
      <table class="tbl">
        <thead>
          <tr>
            <th style="width:60px">ID</th>
            <th style="width:100px">分类</th>
            <th style="width:120px">用户</th>
            <th>内容</th>
            <th style="width:88px">状态</th>
            <th style="width:150px">提交时间</th>
            <th style="width:150px">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="f in list" :key="f.id">
            <td class="num">#{{ f.id }}</td>
            <td><span class="tag gray">{{ f.categoryLabel }}</span></td>
            <td>{{ f.userName || `#${f.userId}` }}</td>
            <td>
              <div class="ellip">{{ f.content }}</div>
              <div v-if="f.reply" class="muted ellip" style="font-size:12px">↳ {{ f.reply }}</div>
            </td>
            <td><span class="tag" :class="statusTag(f.status)">{{ f.statusLabel }}</span></td>
            <td class="muted nowrap">{{ fmtTime(f.createdAt) }}</td>
            <td>
              <div v-if="props.can('feedback.manage')" class="btn-group">
                <button type="button" class="btn sm primary" @click="askReply(f)">
                  {{ f.reply ? '再回复' : '回复' }}
                </button>
                <button type="button" class="btn sm" :disabled="busy" @click="toggleClose(f)">
                  {{ f.status === 'closed' ? '重开' : '关闭' }}
                </button>
              </div>
              <span v-else class="muted">—</span>
            </td>
          </tr>
          <tr v-if="!loading && !list.length">
            <td colspan="7" class="empty"><span class="ico">💬</span>暂无反馈</td>
          </tr>
          <tr v-if="loading"><td colspan="7" class="loading">加载中…</td></tr>
        </tbody>
      </table>
    </div>

    <Pager :total="total" :limit="limit" :offset="offset" unit="条反馈" @change="changePage" />
  </div>

  <div v-if="dialog.open" class="mask" @click.self="dialog.open = false">
    <div class="dialog">
      <div class="dialog-title">
        回复反馈 #{{ dialog.item?.id }}
        <button type="button" class="x" @click="dialog.open = false">×</button>
      </div>
      <div class="dialog-body">
        <div class="kv" style="margin-bottom:12px">
          <span class="k">用户</span><span class="v">{{ dialog.item?.userName || `#${dialog.item?.userId}` }}</span>
          <span class="k">分类</span><span class="v">{{ dialog.item?.categoryLabel }}</span>
          <span class="k">提交时间</span><span class="v">{{ fmtTime(dialog.item?.createdAt) }}</span>
          <span v-if="dialog.item?.contact" class="k">联系方式</span>
          <span v-if="dialog.item?.contact" class="v">{{ dialog.item.contact }}</span>
        </div>
        <div class="muted" style="font-size:12px;margin-bottom:4px">反馈内容</div>
        <p class="prewrap" style="margin:0 0 14px">{{ dialog.item?.content }}</p>
        <div class="field" style="margin-bottom:0">
          <label>回复内容</label>
          <textarea v-model="dialog.reply" class="textarea" rows="4" placeholder="用户可在「帮助与反馈」中看到此回复"></textarea>
        </div>
      </div>
      <div class="dialog-actions">
        <button type="button" class="btn" @click="dialog.open = false">取消</button>
        <button type="button" class="btn primary" :disabled="busy" @click="submitReply">
          {{ busy ? '提交中…' : '发送回复' }}
        </button>
      </div>
    </div>
  </div>
</template>
