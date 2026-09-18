// 全局外观: 深色模式 / 字体缩放 / 聊天背景
const KEY = 'wx_appearance';

const defaults = {
  dark: false,
  fontScale: 1,
  chatBg: '#ededed',
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
  document.documentElement.classList.toggle('dark', Boolean(a.dark));
  document.documentElement.style.setProperty('--font-scale', String(a.fontScale || 1));
  const chatBg = a.chatBg || (a.dark ? '#111111' : '#ededed');
  document.documentElement.style.setProperty('--chat-bg', chatBg);
  return a;
}

export function setAppearance(patch) {
  const next = { ...load(), ...patch };
  localStorage.setItem(KEY, JSON.stringify(next));
  return applyAppearance();
}

// 启动即应用
applyAppearance();
