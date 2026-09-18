// 聊天展示/输入共用工具
export const EMOJI_LIST = [
  '😀','😁','😂','🤣','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘',
  '😋','😛','😝','😜','🤪','🤨','🧐','🤓','😎','🤩','🥳','😏','😒',
  '😢','😭','😤','😠','😡','🤬','🤯','😳','🥵','🥶','😶','😐','😑',
  '😬','🙄','😯','👍','👎','👏','🙏','💪','✌️','🤝','❤️','🔥','⭐',
  '🎉','💯','😅','🤗','🤔','🤭','👋','✋','🤟','🖐️','💬','💭',
];

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
