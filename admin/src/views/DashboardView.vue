<script setup>
import { ref, computed, onMounted } from 'vue';
import { api } from '../api.js';
import { fmtAgo, fmtTime, toastError } from '../utils.js';
import BarChart from '../components/BarChart.vue';

const props = defineProps({ can: { type: Function, required: true } });
const emit = defineEmits(['navigate', 'refresh-badges']);

const data = ref(null);
const loading = ref(true);
const days = ref(14);
const metric = ref('messages');

const METRICS = [
  { key: 'messages', label: '消息', color: '' },
  { key: 'users', label: '新增用户', color: 'linear-gradient(180deg,#4ade80,#16a34a)' },
  { key: 'moments', label: '朋友圈', color: 'linear-gradient(180deg,#c084fc,#7c3aed)' },
  { key: 'reports', label: '举报', color: 'linear-gradient(180deg,#fca5a5,#dc2626)' },
  { key: 'feedback', label: '反馈', color: 'linear-gradient(180deg,#fcd34d,#d97706)' },
  { key: 'errors', label: '错误', color: 'linear-gradient(180deg,#94a3b8,#475569)' },
  { key: 'logins', label: '登录', color: 'linear-gradient(180deg,#7dd3fc,#0284c7)' },
];

const trend = computed(() => data.value?.trends?.[metric.value] || []);
const trendColor = computed(() => METRICS.find((m) => m.key === metric.value)?.color || '');
const trendTotal = computed(() => trend.value.reduce((s, d) => s + (Number(d.count) || 0), 0));

async function load() {
  loading.value = true;
  try {
    data.value = await api.dashboard(days.value);
    emit('refresh-badges');
  } catch (e) {
    toastError(e);
  } finally {
    loading.value = false;
  }
}

function setDays(d) {
  days.value = d;
  load();
}

onMounted(load);
</script>

<template>
  <div v-if="loading" class="loading">加载中…</div>

  <template v-else-if="data">
    <!-- 待办 -->
    <div class="grid cols-4" style="margin-bottom:16px">
      <div class="stat danger">
        <div class="k">🚨 待处理举报</div>
        <div class="v">{{ data.todos.pendingReports }}</div>
        <div class="d">
          处理中 {{ data.todos.processingReports }}
          <a href="#" @click.prevent="emit('navigate','reports')">去处理 →</a>
        </div>
      </div>
      <div class="stat warn">
        <div class="k">💬 待回复反馈</div>
        <div class="v">{{ data.todos.openFeedback }}</div>
        <div class="d"><a href="#" @click.prevent="emit('navigate','feedback')">去回复 →</a></div>
      </div>
      <div class="stat danger">
        <div class="k">🐞 24h 错误</div>
        <div class="v">{{ data.todos.errors24h }}</div>
        <div class="d"><a href="#" @click.prevent="emit('navigate','errors')">看详情 →</a></div>
      </div>
      <div class="stat warn">
        <div class="k">⚠️ 24h 异常登录</div>
        <div class="v">{{ data.todos.anomalies24h }}</div>
        <div class="d">今日登录 {{ data.realtime.loginsToday }}</div>
      </div>
    </div>

    <!-- 实时指标 -->
    <div class="grid cols-4" style="margin-bottom:16px">
      <div class="stat accent">
        <div class="k">👥 用户总数</div>
        <div class="v">{{ data.totals.users }}</div>
        <div class="d">今日新增 {{ data.realtime.newUsersToday }} · 封禁 {{ data.totals.bannedUsers }}</div>
      </div>
      <div class="stat accent">
        <div class="k">💬 消息总数</div>
        <div class="v">{{ data.totals.messages }}</div>
        <div class="d">今日 {{ data.realtime.messagesToday }}</div>
      </div>
      <div class="stat accent">
        <div class="k">👨‍👩‍👧 群组 / 朋友圈</div>
        <div class="v">{{ data.totals.groups }} <span class="muted" style="font-size:15px">/ {{ data.totals.moments }}</span></div>
        <div class="d">今日动态 {{ data.realtime.momentsToday }}</div>
      </div>
      <div class="stat ok">
        <div class="k">🔥 7 日活跃用户</div>
        <div class="v">{{ data.realtime.activeUsers7d }}</div>
        <div class="d">管理员账号 {{ data.totals.adminAccounts }}</div>
      </div>
    </div>

    <!-- 趋势 -->
    <div class="card">
      <div class="card-head">
        <span>📈 趋势</span>
        <div class="spacer"></div>
        <select v-model="metric" class="select" style="width:auto">
          <option v-for="m in METRICS" :key="m.key" :value="m.key">{{ m.label }}</option>
        </select>
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
        <div class="row-flex" style="margin-bottom:6px">
          <span class="muted" style="font-size:13px">
            {{ METRICS.find((m) => m.key === metric)?.label }} · 近 {{ days }} 天合计
          </span>
          <div class="spacer"></div>
          <b style="font-size:18px">{{ trendTotal }}</b>
        </div>
        <BarChart :data="trend" :color="trendColor" />
      </div>
    </div>

    <div class="grid cols-2">
      <!-- 举报分类 -->
      <div class="card">
        <div class="card-head">举报分类分布</div>
        <div class="card-body">
          <div v-if="!data.reportByCategory.length" class="muted">暂无数据</div>
          <div v-else class="bar-list">
            <div v-for="r in data.reportByCategory" :key="r.category" class="bar-row">
              <span class="name">{{ r.category }}</span>
              <span class="track">
                <span
                  class="fill"
                  :style="{ width: `${Math.round((r.count / Math.max(1, data.reportByCategory[0].count)) * 100)}%` }"
                ></span>
              </span>
              <span class="n">{{ r.count }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 反馈分类 -->
      <div class="card">
        <div class="card-head">反馈分类分布</div>
        <div class="card-body">
          <div v-if="!data.feedbackByCategory.length" class="muted">暂无数据</div>
          <div v-else class="bar-list">
            <div v-for="r in data.feedbackByCategory" :key="r.category" class="bar-row">
              <span class="name">{{ r.category }}</span>
              <span class="track">
                <span
                  class="fill"
                  style="background:#16a34a"
                  :style="{ width: `${Math.round((r.count / Math.max(1, data.feedbackByCategory[0].count)) * 100)}%` }"
                ></span>
              </span>
              <span class="n">{{ r.count }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 高频错误模块 -->
      <div class="card">
        <div class="card-head">近 7 天错误模块 Top</div>
        <div class="card-body">
          <div v-if="!data.topErrorFeatures.length" class="muted">暂无错误 🎉</div>
          <div v-else class="bar-list">
            <div v-for="r in data.topErrorFeatures" :key="r.feature" class="bar-row">
              <span class="name">{{ r.feature }}</span>
              <span class="track">
                <span
                  class="fill"
                  style="background:#dc2626"
                  :style="{ width: `${Math.round((r.count / Math.max(1, data.topErrorFeatures[0].count)) * 100)}%` }"
                ></span>
              </span>
              <span class="n">{{ r.count }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 最近注册 -->
      <div class="card">
        <div class="card-head">
          最近注册
          <div class="spacer"></div>
          <button type="button" class="btn sm ghost" @click="emit('navigate','users')">全部 →</button>
        </div>
        <div class="card-body tight">
          <table class="tbl">
            <tbody>
              <tr v-for="u in data.recentUsers" :key="u.id">
                <td class="num" style="width:56px">#{{ u.id }}</td>
                <td>{{ u.nickname }}</td>
                <td class="muted nowrap" style="text-align:right">{{ fmtAgo(u.createdAt) }}</td>
              </tr>
              <tr v-if="!data.recentUsers.length"><td class="muted">暂无用户</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- 最近操作 -->
    <div class="card">
      <div class="card-head">
        📜 最近后台操作
        <div class="spacer"></div>
        <button
          v-if="props.can('audit.view')"
          type="button"
          class="btn sm ghost"
          @click="emit('navigate','audit')"
        >审计日志 →</button>
      </div>
      <div class="card-body tight">
        <table class="tbl">
          <thead>
            <tr><th>时间</th><th>管理员</th><th>模块</th><th>操作</th><th>详情</th></tr>
          </thead>
          <tbody>
            <tr v-for="l in data.recentAudit" :key="l.id">
              <td class="muted nowrap">{{ fmtTime(l.createdAt) }}</td>
              <td>{{ l.adminName || '—' }}</td>
              <td><span class="tag gray">{{ l.module }}</span></td>
              <td>{{ l.action }}</td>
              <td class="ellip">{{ l.detail }}</td>
            </tr>
            <tr v-if="!data.recentAudit.length"><td colspan="5" class="muted">暂无操作记录</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 状态提醒 -->
    <div v-if="data.settings.maintenance || data.settings.noticeEnabled" class="card">
      <div class="card-body">
        <span v-if="data.settings.maintenance" class="tag red">维护模式已开启</span>
        <span v-if="data.settings.noticeEnabled" class="tag amber" style="margin-left:6px">全局公告已开启</span>
        <button
          v-if="props.can('settings.manage')"
          type="button"
          class="btn sm ghost"
          style="margin-left:8px"
          @click="emit('navigate','settings')"
        >前往系统设置 →</button>
      </div>
    </div>
  </template>
</template>
