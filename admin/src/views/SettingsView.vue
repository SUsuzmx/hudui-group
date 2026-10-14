<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import { api } from '../api.js';
import { toast, toastError } from '../utils.js';

const props = defineProps({ can: { type: Function, required: true } });

const loading = ref(true);
const saving = ref(false);
const meta = ref({});
const form = reactive({});

const canManage = computed(() => props.can('settings.manage'));

/** 按 meta.group 分组 */
const groups = computed(() => {
  const map = new Map();
  for (const [key, m] of Object.entries(meta.value)) {
    if (!map.has(m.group)) map.set(m.group, []);
    map.get(m.group).push({ key, ...m });
  }
  return [...map.entries()].map(([name, items]) => ({ name, items }));
});

const maintenanceOn = computed(() => form['site.maintenance'] === '1');

async function load() {
  loading.value = true;
  try {
    const r = await api.settings();
    meta.value = r.meta || {};
    for (const [k, v] of Object.entries(r.settings || {})) form[k] = v;
  } catch (e) {
    toastError(e);
  } finally {
    loading.value = false;
  }
}

function setSwitch(key, on) {
  form[key] = on ? '1' : '0';
}

async function save() {
  if (saving.value || !canManage.value) return;
  saving.value = true;
  try {
    await api.setSettings({ ...form });
    toast('系统设置已保存', 'ok');
  } catch (e) {
    toastError(e);
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div v-if="loading" class="loading">加载中…</div>

  <template v-else>
    <div v-if="maintenanceOn" class="card" style="border-color:#fca5a5;background:#fef2f2">
      <div class="card-body row-flex">
        <span style="font-size:20px">🚧</span>
        <div>
          <b style="color:#b91c1c">维护模式已开启</b>
          <div class="hint" style="margin-top:2px">
            用户端所有业务接口将返回 503；后台 <span class="mono">/admin</span> 与登录接口不受影响。
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        系统设置
        <div class="spacer"></div>
        <span v-if="!canManage" class="tag gray">只读权限</span>
      </div>
      <div class="card-body">
        <div v-for="g in groups" :key="g.name" style="margin-bottom:20px">
          <div class="muted" style="font-size:12px;font-weight:600;margin-bottom:10px">{{ g.name }}</div>
          <div class="grid cols-2" style="gap:14px">
            <div v-for="f in g.items" :key="f.key" class="field" style="margin-bottom:0">
              <label>{{ f.label }} <span class="mono muted" style="font-weight:400">{{ f.key }}</span></label>

              <template v-if="f.type === 'switch'">
                <button
                  type="button"
                  class="switch"
                  :class="{ on: form[f.key] === '1' }"
                  :disabled="!canManage"
                  :aria-label="f.label"
                  @click="setSwitch(f.key, form[f.key] !== '1')"
                ></button>
              </template>

              <template v-else-if="f.type === 'textarea'">
                <textarea
                  v-model="form[f.key]"
                  class="textarea"
                  rows="3"
                  :disabled="!canManage"
                ></textarea>
              </template>

              <template v-else>
                <input
                  v-model="form[f.key]"
                  class="input"
                  :type="f.type === 'number' ? 'number' : 'text'"
                  :disabled="!canManage"
                />
              </template>
            </div>
          </div>
        </div>

        <div class="divider"></div>
        <div class="row-flex">
          <span class="hint" style="margin:0">修改会立即生效并记入审计日志。</span>
          <div class="spacer"></div>
          <button type="button" class="btn" :disabled="saving" @click="load">重置</button>
          <button
            type="button"
            class="btn primary"
            :disabled="saving || !canManage"
            @click="save"
          >{{ saving ? '保存中…' : '保存设置' }}</button>
        </div>
      </div>
    </div>
  </template>
</template>
