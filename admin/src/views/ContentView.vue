<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import { api } from '../api.js';
import { fmtTime, debounce, toast, toastError } from '../utils.js';
import Pager from '../components/Pager.vue';

const props = defineProps({ can: { type: Function, required: true } });

const tab = ref('messages');
const TABS = [
  ['messages', '💬 消息'],
  ['moments', '🖼️ 朋友圈'],
  ['groups', '👥 群组'],
];

// 通用分页
const list = ref([]);
const total = ref(0);
const limit = ref(20);
const offset = ref(0);
const loading = ref(false);
const q = ref('');
const busy = ref(false);
const dialog = reactive({ open: false, type: '', item: null, confirm: '', hard: false });

// 批量删除
const selected = ref([]);
const bulkDialog = reactive({ open: false, hard: false, confirm: '' });

const allChecked = computed({
  get: () => list.value.length > 0 && selected.value.length === list.value.length,
  set: (v) => { selected.value = v ? list.value.map((r) => r.id) : []; },
});

async function load() {
  loading.value = true;
  try {
    const params = { q: q.value.trim(), limit: limit.value, offset: offset.value };
    let r;
    if (tab.value === 'messages') r = await api.contentMessages(params);
    else if (tab.value === 'moments') r = await api.contentMoments(params);
    else r = await api.contentGroups(params);
    list.value = r.messages || r.moments || r.groups || [];
    total.value = r.total || 0;
    selected.value = selected.value.filter((id) => list.value.some((r2) => r2.id === id));
  } catch (e) {
    toastError(e);
    list.value = [];
    total.value = 0;
  } finally {
    loading.value = false;
  }
}

const search = debounce(() => { offset.value = 0; load(); }, 320);

function switchTab(t) {
  tab.value = t;
  q.value = '';
  offset.value = 0;
  selected.value = [];
  load();
}

function changePage(o) { offset.value = o; load(); }

function askDelete(type, item) {
  dialog.open = true;
  dialog.type = type;
  dialog.item = item;
  dialog.confirm = '';
  dialog.hard = false;
}

function askBulkDelete() {
  bulkDialog.hard = false;
  bulkDialog.confirm = '';
  bulkDialog.open = true;
}

async function runBulkDelete() {
  if (busy.value || !selected.value.length) return;
  if (tab.value === 'groups' && bulkDialog.confirm.trim() !== '批量删除') {
    toast('请输入「批量删除」以确认', 'error');
    return;
  }
  busy.value = true;
  try {
    const r = await api.bulkContent({
      type: tab.value,
      ids: selected.value,
      hard: tab.value === 'messages' ? bulkDialog.hard : undefined,
      confirm: tab.value === 'groups' ? bulkDialog.confirm.trim() : undefined,
    });
    toast(`已批量删除 ${r.count} 条${tab.value === 'groups' ? '群组（含成员与消息）' : '内容'}`, 'ok');
    bulkDialog.open = false;
    selected.value = [];
    await load();
  } catch (e) {
    toastError(e);
  } finally {
    busy.value = false;
  }
}

async function run() {
  if (busy.value) return;
  busy.value = true;
  const it = dialog.item;
  try {
    if (dialog.type === 'message') {
      await api.deleteMessage(it.id, dialog.hard);
      toast(dialog.hard ? '消息已彻底删除' : '消息已撤回', 'ok');
    } else if (dialog.type === 'moment') {
      await api.deleteMoment(it.id);
      toast('动态已删除', 'ok');
    } else if (dialog.type === 'group') {
      if (dialog.confirm.trim() !== it.name) {
        toast('群名不匹配，已取消', 'error');
        busy.value = false;
        return;
      }
      await api.deleteGroup(it.id, dialog.confirm.trim());
      toast(`群组「${it.name}」已删除`, 'ok');
    }
    dialog.open = false;
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
    <div class="filters">
      <div class="btn-group">
        <button
          v-for="t in TABS"
          :key="t[0]"
          type="button"
          class="btn sm"
          :class="{ primary: tab === t[0] }"
          @click="switchTab(t[0])"
        >{{ t[1] }}</button>
      </div>
      <div class="spacer"></div>
      <input
        v-model="q"
        class="input"
        type="search"
        :placeholder="tab === 'groups' ? '搜索群名' : '搜索内容关键词'"
        @input="search"
      />
      <template v-if="props.can('content.manage') && selected.length">
        <span class="muted">已选 {{ selected.length }}</span>
        <button type="button" class="btn sm danger" @click="askBulkDelete">
          批量删除{{ tab === 'messages' ? '消息' : tab === 'moments' ? '动态' : '群组' }}
        </button>
      </template>
      <button type="button" class="btn sm" @click="load">刷新</button>
    </div>

    <!-- 消息 -->
    <div v-if="tab === 'messages'" class="table-wrap">
      <table class="tbl">
        <thead>
          <tr>
            <th v-if="props.can('content.manage')" style="width:36px">
              <input v-model="allChecked" class="chk" type="checkbox" />
            </th>
            <th style="width:64px">ID</th>
            <th style="width:120px">发送者</th>
            <th style="width:140px">会话</th>
            <th>内容</th>
            <th style="width:170px">时间</th>
            <th v-if="props.can('content.manage')" style="width:90px">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in list" :key="m.id">
            <td v-if="props.can('content.manage')">
              <input v-model="selected" class="chk" type="checkbox" :value="m.id" />
            </td>
            <td class="num">#{{ m.id }}</td>
            <td>{{ m.senderName }} <span class="muted">{{ m.senderType === 'ai' ? '(AI)' : '' }}</span></td>
            <td class="mono muted">{{ m.conversationId || 'default' }}</td>
            <td class="ellip">
              {{ m.content || '—' }}
              <span v-if="m.mediaType" class="tag blue" style="margin-left:6px">{{ m.mediaType }}</span>
            </td>
            <td class="muted nowrap">{{ fmtTime(m.createdAt) }}</td>
            <td v-if="props.can('content.manage')">
              <button type="button" class="btn sm danger" @click="askDelete('message', m)">删除</button>
            </td>
          </tr>
          <tr v-if="!loading && !list.length"><td :colspan="props.can('content.manage') ? 7 : 6" class="empty"><span class="ico">🔍</span>没有匹配的消息</td></tr>
          <tr v-if="loading"><td :colspan="props.can('content.manage') ? 7 : 6" class="loading">加载中…</td></tr>
        </tbody>
      </table>
    </div>

    <!-- 朋友圈 -->
    <div v-else-if="tab === 'moments'" class="table-wrap">
      <table class="tbl">
        <thead>
          <tr>
            <th v-if="props.can('content.manage')" style="width:36px">
              <input v-model="allChecked" class="chk" type="checkbox" />
            </th>
            <th style="width:64px">ID</th>
            <th style="width:130px">作者</th>
            <th>内容</th>
            <th style="width:90px">图片</th>
            <th style="width:88px">可见性</th>
            <th style="width:170px">时间</th>
            <th v-if="props.can('content.manage')" style="width:90px">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in list" :key="m.id">
            <td v-if="props.can('content.manage')">
              <input v-model="selected" class="chk" type="checkbox" :value="m.id" />
            </td>
            <td class="num">#{{ m.id }}</td>
            <td>{{ m.nickname || `#${m.userId}` }}</td>
            <td class="ellip">{{ m.content || '（仅图片）' }}</td>
            <td class="num">{{ m.images?.length || 0 }}</td>
            <td><span class="tag gray">{{ m.visibility === 'public' ? '公开' : m.visibility === 'friends' ? '好友' : '私密' }}</span></td>
            <td class="muted nowrap">{{ fmtTime(m.createdAt) }}</td>
            <td v-if="props.can('content.manage')">
              <button type="button" class="btn sm danger" @click="askDelete('moment', m)">删除</button>
            </td>
          </tr>
          <tr v-if="!loading && !list.length"><td :colspan="props.can('content.manage') ? 8 : 7" class="empty"><span class="ico">🔍</span>没有匹配的动态</td></tr>
          <tr v-if="loading"><td :colspan="props.can('content.manage') ? 8 : 7" class="loading">加载中…</td></tr>
        </tbody>
      </table>
    </div>

    <!-- 群组 -->
    <div v-else class="table-wrap">
      <table class="tbl">
        <thead>
          <tr>
            <th v-if="props.can('content.manage')" style="width:36px">
              <input v-model="allChecked" class="chk" type="checkbox" />
            </th>
            <th style="width:64px">ID</th>
            <th>群名</th>
            <th style="width:90px">类型</th>
            <th style="width:80px">成员</th>
            <th style="width:80px">消息</th>
            <th style="width:100px">入群验证</th>
            <th style="width:170px">创建时间</th>
            <th v-if="props.can('content.manage')" style="width:90px">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="g in list" :key="g.id">
            <td v-if="props.can('content.manage')">
              <input v-model="selected" class="chk" type="checkbox" :value="g.id" />
            </td>
            <td class="num">#{{ g.id }}</td>
            <td>{{ g.name }}</td>
            <td><span class="tag gray">{{ g.kind === 'custom' ? '自建' : '系统' }}</span></td>
            <td class="num">{{ g.memberCount }}</td>
            <td class="num">{{ g.messageCount }}</td>
            <td>
              <span v-if="g.requireApproval" class="tag amber">需审批</span>
              <span v-else class="muted">—</span>
            </td>
            <td class="muted nowrap">{{ fmtTime(g.createdAt) }}</td>
            <td v-if="props.can('content.manage')">
              <button type="button" class="btn sm danger" @click="askDelete('group', g)">删除</button>
            </td>
          </tr>
          <tr v-if="!loading && !list.length"><td :colspan="props.can('content.manage') ? 9 : 8" class="empty"><span class="ico">🔍</span>没有匹配的群组</td></tr>
          <tr v-if="loading"><td :colspan="props.can('content.manage') ? 9 : 8" class="loading">加载中…</td></tr>
        </tbody>
      </table>
    </div>

    <Pager :total="total" :limit="limit" :offset="offset" unit="条" @change="changePage" />
  </div>

  <!-- 删除确认 -->
  <div v-if="dialog.open" class="mask" @click.self="dialog.open = false">
    <div class="dialog">
      <div class="dialog-title">
        {{ dialog.type === 'message' ? '删除消息' : dialog.type === 'moment' ? '删除动态' : '删除群组' }}
        <button type="button" class="x" @click="dialog.open = false">×</button>
      </div>
      <div class="dialog-body">
        <template v-if="dialog.type === 'message'">
          <div class="kv" style="margin-bottom:12px">
            <span class="k">消息 ID</span><span class="v">#{{ dialog.item?.id }}</span>
            <span class="k">发送者</span><span class="v">{{ dialog.item?.senderName }}</span>
            <span class="k">内容</span><span class="v prewrap">{{ dialog.item?.content }}</span>
          </div>
          <label class="row-flex" style="gap:8px;font-size:13px;cursor:pointer">
            <input v-model="dialog.hard" class="chk" type="checkbox" />
            <span>彻底删除（默认仅撤回，显示为「已被平台删除」）</span>
          </label>
        </template>

        <template v-else-if="dialog.type === 'moment'">
          <div class="kv" style="margin-bottom:12px">
            <span class="k">动态 ID</span><span class="v">#{{ dialog.item?.id }}</span>
            <span class="k">作者</span><span class="v">{{ dialog.item?.nickname || `#${dialog.item?.userId}` }}</span>
            <span class="k">内容</span><span class="v prewrap">{{ dialog.item?.content || '（仅图片）' }}</span>
          </div>
          <p class="hint">将同时删除该动态的点赞与评论，不可恢复。</p>
        </template>

        <template v-else>
          <p style="color:#dc2626;margin-top:0">
            ⚠️ 将删除群组「{{ dialog.item?.name }}」及其全部成员关系与群聊消息，<b>不可恢复</b>。
          </p>
          <div class="field">
            <label>请输入群名「{{ dialog.item?.name }}」以确认</label>
            <input v-model="dialog.confirm" class="input" type="text" placeholder="群名" />
          </div>
        </template>
      </div>
      <div class="dialog-actions">
        <button type="button" class="btn" @click="dialog.open = false">取消</button>
        <button type="button" class="btn danger" :disabled="busy" @click="run">
          {{ busy ? '处理中…' : '确认删除' }}
        </button>
      </div>
    </div>
  </div>

  <!-- 批量删除确认 -->
  <div v-if="bulkDialog.open" class="mask" @click.self="bulkDialog.open = false">
    <div class="dialog">
      <div class="dialog-title">
        批量删除{{ tab === 'messages' ? '消息' : tab === 'moments' ? '动态' : '群组' }}（{{ selected.length }} 项）
        <button type="button" class="x" @click="bulkDialog.open = false">×</button>
      </div>
      <div class="dialog-body">
        <template v-if="tab === 'messages'">
          <p class="hint" style="margin-top:0">默认撤回（显示为「已被平台删除」），勾选后彻底删除。</p>
          <label class="row-flex" style="gap:8px;font-size:13px;cursor:pointer">
            <input v-model="bulkDialog.hard" class="chk" type="checkbox" />
            <span>彻底删除</span>
          </label>
        </template>
        <template v-else-if="tab === 'moments'">
          <p style="color:#dc2626;margin-top:0">
            ⚠️ 将删除选中的 {{ selected.length }} 条动态及其点赞、评论与访客记录，<b>不可恢复</b>。
          </p>
        </template>
        <template v-else>
          <p style="color:#dc2626;margin-top:0">
            ⚠️ 将删除选中的 {{ selected.length }} 个群组及其全部成员关系与群聊消息，<b>不可恢复</b>。
          </p>
          <div class="field">
            <label>请输入「批量删除」以确认</label>
            <input v-model="bulkDialog.confirm" class="input" type="text" placeholder="批量删除" />
          </div>
        </template>
      </div>
      <div class="dialog-actions">
        <button type="button" class="btn" @click="bulkDialog.open = false">取消</button>
        <button type="button" class="btn danger" :disabled="busy" @click="runBulkDelete">
          {{ busy ? '处理中…' : '确认删除' }}
        </button>
      </div>
    </div>
  </div>
</template>
