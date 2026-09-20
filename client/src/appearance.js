// 全局外观: 深色模式 / 字体缩放 / 聊天背景
const KEY = 'wx_appearance';

const defaults = {
  dark: false,
  fontScale: 1,
  chatBg: null, // null = 跟随主题
};

function load() {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...defaults };
  }
}

export function getAppearance() {
  return load();
}

export function applyAppearance() {
  const a = load();
  const dark = Boolean(a.dark);
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.style.setProperty('color-scheme', dark ? 'dark' : 'light');
  document.documentElement.style.setProperty('--font-scale', String(a.fontScale || 1));
  const chatBg = a.chatBg || (dark ? '#111111' : '#ededed');
  document.documentElement.style.setProperty('--chat-bg', chatBg);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#1c1c1e' : '#ededed');
  return a;
}

export function setAppearance(patch) {
  const next = { ...load(), ...patch };
  // 空串/undefined 清除自定义聊天底色, 恢复跟随主题
  if (patch && Object.prototype.hasOwnProperty.call(patch, 'chatBg') && !patch.chatBg) {
    next.chatBg = null;
  }
  localStorage.setItem(KEY, JSON.stringify(next));
  return applyAppearance();
}

export function toggleDark(force) {
  const a = load();
  const dark = typeof force === 'boolean' ? force : !a.dark;
  return setAppearance({ dark, chatBg: null });
}

// 启动即应用
applyAppearance();

// 跟随系统（仅在用户未强制关闭 follow 时）
try {
  if (localStorage.getItem('wx_theme_follow') !== '0' && window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onSys = (e) => {
      if (localStorage.getItem('wx_theme_follow') !== '0') {
        setAppearance({ dark: e.matches, chatBg: null });
      }
    };
    if (mq.addEventListener) mq.addEventListener('change', onSys);
    else if (mq.addListener) mq.addListener(onSys);
  }
} catch { /* ignore */ }
