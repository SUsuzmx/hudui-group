<script setup>
import { ref, computed, onMounted } from 'vue';
import { api } from '../api.js';
import { fmtTime, toast, toastError } from '../utils.js';

const props = defineProps({ can: { type: Function, required: true } });
const emit = defineEmits(['refresh-badges']);

const flags = ref({});
const meta = ref({});
const defaults = ref({});
const loading = ref(true);
const busy = ref('');
const lastChanged = ref(null);

const canManage = computed(() => props.can('flags.manage'));

/** 按 meta.group 分组展示 */
const groups = computed(() => {
  const map = new Map();
  for (const key of Object.keys(defaults.value)) {
    const m = meta.value[key] || { group: '其他', desc: '' };
    if (!map.has(m.group)) map.set(m.group, []);
    map.get(m.group).push({ key, desc: m.desc, on: flags.value[key] !== false });
  }
  return [...map.entries()].map(([name, items]) => ({ name, items }));
});

const enabledCount = computed(() => Object.keys(defaults.value).filter((k) => flags.value[k] !== false).length);

async function load() {
  loading.value = true;
  try {
    const r = await api.flags();
    flags.value = r.flags || {};
    meta.value = r.meta || {};
    defaults.value = r.defaults || {};
  } catch (e) {
    toastError(e);
  } finally {
    loading.value = false;
  }
}

async function toggle(key) {
  if (!canManage.value || busy.value) return;
  const next = flags.value[key] === false;
  busy.value = key;
  try {
    const r = await api.setFlags({ [key]: next });
    flags.value = r.flags || flags.value;
    lastChanged.value = { key, on: next, at: Date.now() };
    toast(`${meta.value[key]?.group || key} 已${next ? '开启' : '关闭'}`, next ? 'ok' : 'warn');
    emit('refresh-badges');
  } catch (e) {
    toastError(e);
  } finally {
    busy.value = '';
  }
}

onMounted(load);
</script>

<template>
  <div v-if="loading" class="loading">加载中…</div>

  <template v-else>
    <div class="card">
      <div class="card-body">
        <div class="row-flex">
          <div>
            <b>功能开关</b>
            <div class="hint" style="margin-top:2px">
              已开启 {{ enabledCount }} / {{ Object.keys(defaults).length }} 项。
              关闭后用户端对应接口返回 <span class="mono">503</span>，用于出问题时快速止血。
            </div>
          </div>
          <div class="spacer"></div>
          <span v-if="!canManage" class="tag gray">只读权限</span>
          <span
            v-else-if="lastChanged"
            class="tag green"
          >最近：{{ meta[lastChanged.key]?.group || lastChanged.key }} {{ lastChanged.on ? '开' : '关' }} · {{ fmtTime(lastChanged.at) }}</span>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-head">开关列表</div>
      <div class="card-body tight">
        <table class="tbl">
          <thead>
            <tr>
              <th style="width:150px">分组</th>
              <th style="width:190px">开关</th>
              <th>说明</th>
              <th style="width:110px">状态</th>
              <th style="width:90px">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="g in groups" :key="g.name">
              <td><span class="tag blue">{{ g.name }}</span></td>
              <td colspan="4" style="padding:0">
                <table class="tbl" style="margin:0">
                  <tbody>
                    <tr v-for="f in g.items" :key="f.key">
                      <td style="width:190px">
                        <span class="mono">{{ f.key }}</span>
                      </td>
                      <td>{{ f.desc }}</td>
                      <td style="width:110px">
                        <span class="tag" :class="f.on ? 'green' : 'red'">{{ f.on ? '已开启' : '已关闭' }}</span>
                      </td>
                      <td style="width:90px">
                        <button
                          type="button"
                          class="switch"
                          :class="{ on: f.on }"
                          :disabled="!canManage || busy === f.key"
                          :aria-label="f.key"
                          @click="toggle(f.key)"
                        ></button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <div class="card-body">
        <p class="hint" style="margin:0">
          提示：<span class="mono">adminPanel</span> 开关仅控制用户端是否展示旧版「运营后台」入口；
          独立后台 <span class="mono">/admin</span> 始终可访问，避免误操作导致无法进入后台。
          所有开关变更都会写入审计日志。
        </p>
      </div>
    </div>
  </template>
</template>
