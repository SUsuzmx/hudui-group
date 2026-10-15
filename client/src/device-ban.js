// 设备指纹（双轨）：
// - id：随机根 + 稳定特征，localStorage 持久。同一浏览器永不变，但清缓存/无痕会重置。
// - sig：纯稳定特征 + 画布渲染哈希，无任何存储依赖，清缓存/无痕/重装浏览器也不变
//   （但浏览器大版本升级/换设备可能变化）。封禁任一即拦，二者互补。
const KEY = 'hudui_device_id';

function featureParts() {
  const nav = navigator || {};
  return [
    nav.userAgent || '',
    nav.language || '',
    (nav.languages || []).join(','),
    String(nav.hardwareConcurrency || ''),
    String(nav.deviceMemory || ''),
    `${screen?.width || 0}x${screen?.height || 0}x${screen?.colorDepth || 0}`,
    `${window?.devicePixelRatio || 1}`,
    String(new Date().getTimezoneOffset() || ''),
    nav.platform || '',
  ];
}

function randomRoot() {
  const buf = new Uint8Array(12);
  (crypto || {}).getRandomValues?.(buf);
  return Array.from(buf).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 画布渲染哈希：同设备同浏览器产出一致，跨设备/跨浏览器引擎差异稳定存在 */
function canvasSig() {
  try {
    const c = document.createElement('canvas');
    c.width = 240;
    c.height = 60;
    const g = c.getContext('2d');
    if (!g) return '';
    g.textBaseline = 'top';
    g.font = "16px 'Arial'";
    g.fillStyle = '#f60';
    g.fillRect(0, 0, 110, 20);
    g.fillStyle = '#069';
    g.fillText('Perry-\u6c49\u5b57-\u{1F4A9}, <canvas>', 2, 2);
    g.fillStyle = 'rgba(102,204,0,0.7)';
    g.fillText('Perry-\u6c49\u5b57-\u{1F4A9}, <canvas>', 4, 8);
    g.globalCompositeOperation = 'multiply';
    g.arc(50, 40, 15, 0, Math.PI * 2);
    g.fill();
    return c.toDataURL().slice(-96);
  } catch {
    return '';
  }
}

export function getDeviceId() {
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = `${randomRoot()}.${featureParts().join('|')}`;
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return featureParts().join('|') || randomRoot();
  }
}

/** 特征指纹：无存储依赖，现算现报 */
export function getDeviceSig() {
  return [...featureParts(), canvasSig()].join('|');
}

/** api.js 的请求封装里带上双指纹头 */
export function deviceHeaders() {
  try {
    return { 'X-Device-Id': getDeviceId(), 'X-Device-Sig': getDeviceSig() };
  } catch {
    return {};
  }
}
