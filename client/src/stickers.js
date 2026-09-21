const STICKER_KEY = 'hudui_stickers_v2';

function readList() {
  try {
    const arr = JSON.parse(localStorage.getItem(STICKER_KEY) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeList(list) {
  try {
    localStorage.setItem(STICKER_KEY, JSON.stringify(list.slice(0, 200)));
  } catch { /* ignore */ }
}

/** 表情包条目： { id, url, name, kind: 'image'|'gif'|'emoji' } */
export function loadStickers() {
  return readList().map((s) => {
    if (typeof s === 'string') {
      const isPath = s.startsWith('/') || s.startsWith('data:') || s.startsWith('http');
      return {
        id: s,
        url: s,
        name: '',
        kind: isPath
          ? (String(s).toLowerCase().includes('.gif') || s.startsWith('data:image/gif') ? 'gif' : 'image')
          : 'emoji',
      };
    }
    return s;
  });
}

export function saveStickers(list) {
  writeList(list);
  return list;
}

export function addSticker(item) {
  const list = loadStickers();
  if (list.some((s) => s.url === item.url)) return list;
  const next = [{ ...item }, ...list];
  saveStickers(next);
  return next;
}

export function removeSticker(id) {
  const next = loadStickers().filter((s) => s.id !== id);
  saveStickers(next);
  return next;
}

export function stickerFromFileMeta(file, url) {
  const isGif = file?.type === 'image/gif' || /\.gif(\?|$)/i.test(String(url || file?.name || ''));
  return {
    id: `st_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    url,
    name: file?.name || '',
    kind: isGif ? 'gif' : 'image',
  };
}

export function stickerFromChatMessage(m) {
  const url = m?.mediaUrl;
  if (!url || typeof url !== 'string') return null;
  if (!m.mediaType || m.mediaType === 'image') {
    const isGif = /\.gif(\?|$)/i.test(url) || url.startsWith('data:image/gif');
    return {
      id: `st_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      url,
      name: m.senderName ? `${m.senderName}的表情` : '聊天表情',
      kind: isGif ? 'gif' : 'image',
    };
  }
  return null;
}

export function canSaveStickerFromMsg(m) {
  if (!m?.mediaUrl) return false;
  return !m.mediaType || m.mediaType === 'image';
}
