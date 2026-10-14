<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import { api } from '../api.js';
import { fmtTime, fmtAgo, debounce, downloadCsv, toast, toastError } from '../utils.js';
import Pager from '../components/Pager.vue';

const props = defineProps({ can: { type: Function, required: true } });
const emit = defineEmits(['refresh-badges']);

const list = ref([]);
const total = ref(0);
const limit = ref(20);
const offset = ref(0);
const loading = ref(false);
const q = ref('');
const status = ref('');

const selected = ref([]);
const detail = ref(null);
const detailLoading = ref(false);
const busy = ref(false);
const bulkDialog = reactive({ open: false, action: '', reason: '' });

// 弹窗
const dialog = reactive({ open: false, type: '', user: null, text: '', confirm: '' });

const allChecked = computed({
  get: () => list.value.length > 0 && selected.value.length === list.value.length,
  set: (v) => { selected.value = v ? list.value.map((u) => u.id) : []; },
});

async function load() {
  loading.value = true;
  try {
    const r = await api.users({ q: q.value.trim(), status: status.value, limit: limit.value, offset: offset.value });
    list.value = r.users || [];
    total.value = r.total || 0;
    selected.value = selected.value.filter((id) => list.value.some((u) => u.id === id));
  } catch (e) {
    toastError(e);
  } finally {
    loading.value = false;
  }
}

const search = debounce(() => { offset.value = 0; load(); }, 320);

function changeStatus(v) { status.value = v; offset.value = 0; load(); }
function changePage(o) { offset.value = o; load(); }

async function openDetail(u) {
  detailLoading.value = true;
  detail.value = { id: u.id };
  try {
    detail.value = await api.user(u.id);
  } catch (e) {
    toastError(e);
    detail.value = null;
  } finally {
    detailLoading.value = false;
  }
}

function ask(type, user) {
  dialog.open = true;
  dialog.type = type;
  dialog.user = user;
  dialog.text = '';
  dialog.confirm = '';
}

async function run() {
  if (busy.value) return;
  busy.value = true;
  const u = dialog.user;
  try {
    if (dialog.type === 'ban') {
      await api.banUser(u.id, dialog.text.trim());
      toast(`已封禁「${u.nickname}」`, 'ok');
    } else if (dialog.type === 'unban') {
      await api.unbanUser(u.id);
      toast(`已解除封禁「${u.nickname}」`, 'ok');
    } else if (dialog.type === 'password') {
      if (dialog.text.length < 6) { toast('密码至少 6 位', 'error'); busy.value = false; return; }
      await api.resetUserPassword(u.id, dialog.text);
      toast('密码已重置，该用户需重新登录', 'ok');
    } else if (dialog.type === 'logout') {
      const r = await api.logoutUserAll(u.id);
      toast(`已强制下线 ${r.kicked} 个会话`, 'ok');
    } else if (dialog.type === 'platform-admin') {
      const on = !u.isPlatformAdmin;
      await api.setPlatformAdmin(u.id, on);
      toast(on ? '已授予平台管理员标记' : '已取消平台管理员标记', 'ok');
    } else if (dialog.type === 'delete') {
      if (dialog.confirm.trim() !== u.nickname) {
        toast('昵称不匹配，已取消', 'error');
        busy.value = false;
        return;
      }
      await api.deleteUser(u.id, dialog.confirm.trim());
      toast(`已删除账号「${u.nickname}」`, 'ok');
    }
    dialog.open = false;
    if (detail.value && detail.value.user?.id === u.id) detail.value = null;
    await load();
    emit('refresh-badges');
  } catch (e) {
    toastError(e);
  } finally {
    busy.value = false;
  }
}

function exportCsv() {
  downloadCsv(`users-${Date.now()}.csv`, list.value, [
    { label: 'ID', value: (r) => r.id },
    { label: '昵称', value: (r) => r.nickname },
    { label: '微信号', value: (r) => r.wxid },
    { label: '地区', value: (r) => r.region },
    { label: '好友数', value: (r) => r.friendCount },
    { label: '消息数', value: (r) => r.messageCount },
    { label: '动态数', value: (r) => r.momentCount },
    { label: '状态', value: (r) => (r.banned ? '已封禁' : '正常') },
    { label: '封禁原因', value: (r) => r.banReason },
    { label: '注册时间', value: (r) => fmtTime(r.createdAt) },
  ]);
  toast(`已导出当前页 ${list.value.length} 条`, 'ok');
}

// 批量：封禁只统计当前未封禁的，解封只统计已封禁的（服务器对重复操作返回 error，这里提前过滤）
function askBulk(action) {
  bulkDialog.action = action;
  bulkDialog.reason = '';
  bulkDialog.open = true;
}

async function runBulk() {
  if (busy.value || !selected.value.length) return;
  busy.value = true;
  const action = bulkDialog.action;
  try {
    const r = await api.bulkUsers({ action, ids: selected.value, reason: bulkDialog.reason.trim() });
    const failedText = r.failed?.length ? `，${r.failed.length} 条失败：${r.failed.slice(0, 3).join('；')}` : '';
    const label = action === 'ban' ? '封禁' : action === 'unban' ? '解封' : '下线';
    toast(`已批量${label} ${r.count} 位用户${failedText}`, r.failed?.length ? 'error' : 'ok');
    bulkDialog.open = false;
    selected.value = [];
    await load();
    emit('refresh-badges');
  } catch (e) {
    toastError(e);
  } finally {
    busy.value = false;
  }
}

const DIALOG_TITLES = {
  ban: '封禁用户',
  unban: '解除封禁',
  password: '重置密码',
  logout: '强制下线',
  'platform-admin': '平台管理员标记',
  delete: '删除账号（不可恢复）',
};

onMounted(load);
</script>

<template>
  <div class="card">
    <div class="filters">
      <input
        v-model="q"
        class="input"
        type="search"
        placeholder="搜索昵称 / 微信号 / 用户 ID"
        @input="search"
      />
      <select class="select" :value="status" @change="changeStatus($event.target.value)">
        <option value="">全部状态</option>
        <option value="active">正常</option>
        <option value="banned">已封禁</option>
      </select>
      <div class="spacer"></div>
      <template v-if="props.can('users.manage') && selected.length">
        <span class="muted">已选 {{ selected.length }}</span>
        <button type="button" class="btn sm primary" @click="askBulk('ban')">批量封禁</button>
        <button type="button" class="btn sm" @click="askBulk('unban')">批量解封</button>
        <button type="button" class="btn sm" @click="askBulk('logout')">批量下线</button>
      </template>
      <button type="button" class="btn sm" @click="exportCsv">导出 CSV</button>
      <button type="button" class="btn sm" @click="load">刷新</button>
    </div>

    <div class="table-wrap">
      <table class="tbl">
        <thead>
          <tr>
            <th v-if="props.can('users.manage')" style="width:36px">
              <input v-model="allChecked" class="chk" type="checkbox" />
            </th>
            <th style="width:64px">ID</th>
            <th>昵称</th>
            <th>微信号</th>
            <th style="width:64px">好友</th>
            <th style="width:64px">消息</th>
            <th style="width:64px">动态</th>
            <th style="width:96px">状态</th>
            <th style="width:150px">注册时间</th>
            <th style="width:220px">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in list" :key="u.id">
            <td v-if="props.can('users.manage')">
              <input v-model="selected" class="chk" type="checkbox" :value="u.id" />
            </td>
            <td class="num">#{{ u.id }}</td>
            <td>
              <span class="clickable" @click="openDetail(u)">{{ u.nickname }}</span>
              <span v-if="u.isPlatformAdmin" class="tag purple" style="margin-left:6px">平台管理员</span>
            </td>
            <td class="mono muted">{{ u.wxid || '—' }}</td>
            <td class="num">{{ u.friendCount }}</td>
            <td class="num">{{ u.messageCount }}</td>
            <td class="num">{{ u.momentCount }}</td>
            <td>
              <span v-if="u.banned" class="tag red" :title="u.banReason">已封禁</span>
              <span v-else class="tag green">正常</span>
            </td>
            <td class="muted nowrap">{{ fmtTime(u.createdAt) }}</td>
            <td>
              <div class="btn-group">
                <button type="button" class="btn sm" @click="openDetail(u)">详情</button>
                <template v-if="props.can('users.manage')">
                  <button v-if="!u.banned" type="button" class="btn sm danger" @click="ask('ban', u)">封禁</button>
                  <button v-else type="button" class="btn sm" @click="ask('unban', u)">解封</button>
                </template>
              </div>
            </td>
          </tr>
          <tr v-if="!loading && !list.length">
            <td :colspan="props.can('users.manage') ? 10 : 9" class="empty"><span class="ico">🔍</span>没有匹配的用户</td>
          </tr>
          <tr v-if="loading">
            <td :colspan="props.can('users.manage') ? 10 : 9" class="loading">加载中…</td>
          </tr>
        </tbody>
      </table>
    </div>

    <Pager :total="total" :limit="limit" :offset="offset" unit="位用户" @change="changePage" />
  </div>

  <!-- 用户详情 -->
  <div v-if="detail" class="mask" @click.self="detail = null">
    <div class="dialog wide">
      <div class="dialog-title">
        用户详情
        <button type="button" class="x" @click="detail = null">×</button>
      </div>
      <div class="dialog-body">
        <div v-if="detailLoading" class="loading">加载中…</div>
        <template v-else-if="detail.user">
          <div class="kv">
            <span class="k">ID / 昵称</span><span class="v">#{{ detail.user.id }} · {{ detail.user.nickname }}</span>
            <span class="k">微信号</span><span class="v mono">{{ detail.user.wxid || '—' }}</span>
            <span class="k">地区 / 性别</span>
            <span class="v">{{ detail.user.region || '—' }} · {{ detail.user.gender === 'male' ? '男' : detail.user.gender === 'female' ? '女' : '未设置' }}</span>
            <span class="k">个性签名</span><span class="v">{{ detail.user.signature || '—' }}</span>
            <span class="k">余额</span><span class="v">¥{{ Number(detail.user.balance || 0).toFixed(2) }}</span>
            <span class="k">注册时间</span><span class="v">{{ fmtTime(detail.user.createdAt) }}</span>
            <span class="k">账号状态</span>
            <span class="v">
              <span v-if="detail.user.banned" class="tag red">已封禁</span>
              <span v-else class="tag green">正常</span>
              <span v-if="detail.user.banReason" class="muted" style="margin-left:6px">{{ detail.user.banReason }}</span>
              <span v-if="detail.user.bannedBy" class="muted" style="margin-left:6px">（{{ detail.user.bannedBy }}）</span>
            </span>
            <span class="k">平台管理员</span>
            <span class="v">{{ detail.user.isPlatformAdmin ? '是' : '否' }}</span>
          </div>

          <div class="divider"></div>

          <div class="grid cols-3" style="gap:10px">
            <div class="stat"><div class="k">好友</div><div class="v">{{ detail.stats.friends }}</div></div>
            <div class="stat"><div class="k">发送消息</div><div class="v">{{ detail.stats.messages }}</div></div>
            <div class="stat"><div class="k">朋友圈</div><div class="v">{{ detail.stats.moments }}</div></div>
            <div class="stat"><div class="k">所在群</div><div class="v">{{ detail.stats.groups }}</div></div>
            <div class="stat"><div class="k">活跃会话</div><div class="v">{{ detail.stats.sessions }}</div></div>
            <div class="stat"><div class="k">发起举报</div><div class="v">{{ detail.stats.reportsMade }}</div></div>
          </div>

          <div v-if="detail.groups.length" style="margin-top:16px">
            <div class="muted" style="margin-bottom:6px;font-size:12px">所在群组</div>
            <div class="btn-group">
              <span v-for="g in detail.groups" :key="g.id" class="tag blue">
                {{ g.name }}<template v-if="g.role && g.role !== 'member'"> · {{ g.role === 'owner' ? '群主' : '管理员' }}</template>
              </span>
            </div>
          </div>

          <div v-if="detail.reportsAgainst.length" style="margin-top:16px">
            <div class="muted" style="margin-bottom:6px;font-size:12px">被举报记录</div>
            <table class="tbl">
              <tbody>
                <tr v-for="r in detail.reportsAgainst" :key="r.id">
                  <td class="num" style="width:56px">#{{ r.id }}</td>
                  <td style="width:90px">{{ r.category }}</td>
                  <td class="ellip">{{ r.detail || '（无描述）' }}</td>
                  <td class="muted nowrap" style="text-align:right">{{ fmtAgo(r.createdAt) }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div style="margin-top:16px">
            <div class="muted" style="margin-bottom:6px;font-size:12px">最近登录</div>
            <table class="tbl">
              <thead><tr><th>时间</th><th>IP</th><th>设备</th><th>备注</th></tr></thead>
              <tbody>
                <tr v-for="(l, i) in detail.logins" :key="i">
                  <td class="muted nowrap">{{ fmtTime(l.createdAt) }}</td>
                  <td class="mono">{{ l.ip || '—' }}</td>
                  <td>{{ l.device || '—' }}</td>
                  <td>
                    <span v-if="l.anomaly" class="tag amber">{{ l.anomalyNote || '异常' }}</span>
                    <span v-else class="muted">正常</span>
                  </td>
                </tr>
                <tr v-if="!detail.logins.length"><td colspan="4" class="muted">暂无登录记录</td></tr>
              </tbody>
            </table>
          </div>
        </template>
      </div>
      <div v-if="detail.user && props.can('users.manage')" class="dialog-actions">
        <button type="button" class="btn sm" @click="ask('password', detail.user); detail = null">重置密码</button>
        <button type="button" class="btn sm" @click="ask('logout', detail.user); detail = null">强制下线</button>
        <button type="button" class="btn sm" @click="ask('platform-admin', detail.user); detail = null">
          {{ detail.user.isPlatformAdmin ? '取消平台管理员' : '设为平台管理员' }}
        </button>
        <button
          v-if="!detail.user.banned"
          type="button"
          class="btn sm danger"
          @click="ask('ban', detail.user); detail = null"
        >封禁</button>
        <button v-else type="button" class="btn sm" @click="ask('unban', detail.user); detail = null">解封</button>
        <button type="button" class="btn sm danger" @click="ask('delete', detail.user); detail = null">删除账号</button>
      </div>
    </div>
  </div>

  <!-- 操作确认 -->
  <div v-if="dialog.open" class="mask" @click.self="dialog.open = false">
    <div class="dialog">
      <div class="dialog-title">
        {{ DIALOG_TITLES[dialog.type] }}
        <button type="button" class="x" @click="dialog.open = false">×</button>
      </div>
      <div class="dialog-body">
        <p style="margin-top:0">
          目标用户：<b>#{{ dialog.user?.id }} {{ dialog.user?.nickname }}</b>
        </p>

        <template v-if="dialog.type === 'ban'">
          <div class="field">
            <label>封禁原因</label>
            <textarea v-model="dialog.text" class="textarea" rows="3" placeholder="将记录在案并展示给用户"></textarea>
          </div>
          <p class="hint">封禁后该用户所有会话立即失效，无法登录。</p>
        </template>

        <template v-else-if="dialog.type === 'unban'">
          <p class="hint">解除后该用户可以重新登录。</p>
        </template>

        <template v-else-if="dialog.type === 'password'">
          <div class="field">
            <label>新密码</label>
            <input v-model="dialog.text" class="input" type="text" placeholder="6-64 位" />
          </div>
          <p class="hint">重置后该用户所有会话会被强制下线。</p>
        </template>

        <template v-else-if="dialog.type === 'logout'">
          <p class="hint">将立即清除该用户所有登录会话，用户需重新登录。</p>
        </template>

        <template v-else-if="dialog.type === 'platform-admin'">
          <p class="hint">
            平台管理员标记仅影响用户端展示的旧版管理入口，与后台账号体系无关。
          </p>
        </template>

        <template v-else-if="dialog.type === 'delete'">
          <p style="color:#dc2626">
            ⚠️ 将永久删除该账号及其好友、消息归属、朋友圈、群成员等关联数据，<b>不可恢复</b>。
          </p>
          <div class="field">
            <label>请输入用户昵称「{{ dialog.user?.nickname }}」以确认</label>
            <input v-model="dialog.confirm" class="input" type="text" placeholder="昵称" />
          </div>
        </template>
      </div>
      <div class="dialog-actions">
        <button type="button" class="btn" @click="dialog.open = false">取消</button>
        <button
          type="button"
          class="btn"
          :class="dialog.type === 'delete' || dialog.type === 'ban' ? 'danger' : 'primary'"
          :disabled="busy"
          @click="run"
        >{{ busy ? '处理中…' : '确定' }}</button>
      </div>
    </div>
  </div>

  <!-- 批量操作确认 -->
  <div v-if="bulkDialog.open" class="mask" @click.self="bulkDialog.open = false">
    <div class="dialog">
      <div class="dialog-title">
        批量{{ bulkDialog.action === 'ban' ? '封禁' : bulkDialog.action === 'unban' ? '解封' : '强制下线' }} {{ selected.length }} 位用户
        <button type="button" class="x" @click="bulkDialog.open = false">×</button>
      </div>
      <div class="dialog-body">
        <template v-if="bulkDialog.action === 'ban'">
          <div class="field">
            <label>封禁原因（对所有选中用户生效）</label>
            <textarea v-model="bulkDialog.reason" class="textarea" rows="3" placeholder="将记录在案并展示给用户"></textarea>
          </div>
          <p class="hint">已封禁的用户会跳过；平台管理员账号无法封禁，会在结果中单独提示。封禁后所有会话立即失效。</p>
        </template>
        <template v-else-if="bulkDialog.action === 'unban'">
          <p class="hint">已正常的用户会跳过，其余选中用户解除封禁后可重新登录。</p>
        </template>
        <template v-else>
          <p class="hint">将立即清除选中用户的所有登录会话，他们需要重新登录。</p>
        </template>
      </div>
      <div class="dialog-actions">
        <button type="button" class="btn" @click="bulkDialog.open = false">取消</button>
        <button
          type="button"
          class="btn"
          :class="bulkDialog.action === 'ban' ? 'danger' : 'primary'"
          :disabled="busy"
          @click="runBulk"
        >{{ busy ? '处理中…' : '确定' }}</button>
      </div>
    </div>
  </div>
</template>
