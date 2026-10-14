import { ref } from 'vue';

/** 轻量 toast 队列 */
export const toasts = ref([]);
let seq = 0;

export function toast(message, type = 'info', ms = 2600) {
  const id = ++seq;
  toasts.value.push({ id, message: String(message || ''), type });
  setTimeout(() => {
    toasts.value = toasts.value.filter((t) => t.id !== id);
  }, ms);
}

export function toastError(e) {
  toast(e?.message || String(e || '操作失败'), 'error', 4000);
}

/** 时间格式化 */
export function fmtTime(ts) {
  if (!ts) return '—';
  try {
    return new Date(Number(ts)).toLocaleString('zh-CN', { hour12: false });
  } catch {
    return '—';
  }
}

export function fmtDate(ts) {
  if (!ts) return '—';
  try {
    return new Date(Number(ts)).toLocaleDateString('zh-CN');
  } catch {
    return '—';
  }
}

/** 相对时间 */
export function fmtAgo(ts) {
  if (!ts) return '—';
  const diff = Date.now() - Number(ts);
  if (diff < 60_000) return '刚刚';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
  if (diff < 30 * 86400_000) return `${Math.floor(diff / 86400_000)} 天前`;
  return fmtDate(ts);
}

export function fmtBytes(n) {
  const v = Number(n) || 0;
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
  return `${(v / 1024 / 1024).toFixed(2)} MB`;
}

/** 简易防抖 */
export function debounce(fn, ms = 300) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/** 生成 CSV 并触发下载 */
export function downloadCsv(filename, rows, columns) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = columns.map((c) => esc(c.label)).join(',');
  const body = rows.map((r) => columns.map((c) => esc(c.value(r))).join(',')).join('\r\n');
  // BOM 保证 Excel 正确识别 UTF-8 中文
  const blob = new Blob([`\uFEFF${head}\r\n${body}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
