// 聊天展示/输入共用工具
export const EMOJI_LIST = [
  '😀','😁','😂','🤣','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘',
  '😋','😛','😝','😜','🤪','🤨','🧐','🤓','😎','🤩','🥳','😏','😒',
  '😢','😭','😤','😠','😡','🤬','🤯','😳','🥵','🥶','😶','😐','😑',
  '😬','🙄','😯','👍','👎','👏','🙏','💪','✌️','🤝','❤️','🔥','⭐',
  '🎉','💯','😅','🤗','🤔','🤭','👋','✋','🤟','🖐️','💬','💭',
];

/** 微信表情面板分组（近似） */
export const EMOJI_PACKS = [
  {
    key: 'face',
    name: '表情',
    icons: EMOJI_LIST,
  },
  {
    key: 'gesture',
    name: '手势',
    icons: ['👍','👎','👏','🙏','💪','✌️','🤝','👋','✋','🤟','👌','🤙','🖐️','✊','🤛','🤜','🫡','🫶'],
  },
  {
    key: 'mood',
    name: '心情',
    icons: ['❤️','💔','🔥','⭐','💯','🎉','😅','🤗','🤔','🤭','😭','😤','😎','🤩','🥳','😴','🤒','🤯'],
  },
];

export const EMOJI_RECENT_KEY = 'hudui_emoji_recent';

export function loadRecentEmojis() {
  try {
    const arr = JSON.parse(localStorage.getItem(EMOJI_RECENT_KEY) || '[]');
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string').slice(0, 32) : [];
  } catch {
    return [];
  }
}

export function pushRecentEmoji(e) {
  if (!e) return loadRecentEmojis();
  const list = loadRecentEmojis().filter((x) => x !== e);
  list.unshift(e);
  const next = list.slice(0, 32);
  try { localStorage.setItem(EMOJI_RECENT_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  return next;
}

export function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 消息气泡 HTML: 转义后高亮 @提及 / @所有人 */
export function renderContent(content) {
  let html = escapeHtml(content);
  html = html.replace(
    /@([^\s@]+)/g,
    (match, name) => {
      if (name === '所有人' || String(name).toLowerCase() === 'all') {
        return `<span class="at-mention at-all">${match}</span>`;
      }
      return `<span class="at-mention">${match}</span>`;
    }
  );
  return html;
}

/** dataURL -> Blob, 用于 multipart 上传 */
export function dataUrlToBlob(dataUrl) {
  const m = /^data:([^;,]+)(?:;charset=[^;,]+)?;base64,(.+)$/i.exec(String(dataUrl || ''));
  if (!m) return null;
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: m[1] });
}
