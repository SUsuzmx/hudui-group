// AI 头像：优先使用远程动漫/卡通 URL，其次 img 目录匹配文件名
import { listAvatars } from '../auth.js';
import { getPersonaById, personas } from './personas.js';

/** 按人设 id/name 的远程头像（动漫风，外链 URL，不落本地） */
export const AI_AVATAR_URLS = {
  siqi: 'https://api.dicebear.com/9.x/lorelei/svg?seed=Siqi&backgroundColor=ffd5dc',
  perry: 'https://api.dicebear.com/9.x/adventurer/svg?seed=Perry&backgroundColor=b6e3f4',
  niunai: 'https://api.dicebear.com/9.x/lorelei/svg?seed=Milk&backgroundColor=fff1c9',
  xiaolajiao: 'https://api.dicebear.com/9.x/notionists/svg?seed=Chili&backgroundColor=ffdfbf',
  mama: 'https://api.dicebear.com/9.x/lorelei/svg?seed=Mama&backgroundColor=d1f4d9',
  baba: 'https://api.dicebear.com/9.x/adventurer/svg?seed=Baba&backgroundColor=c0aede',
  wangye: 'https://api.dicebear.com/9.x/adventurer/svg?seed=Wangye&backgroundColor=b6e3f4',
  yezi: 'https://api.dicebear.com/9.x/notionists/svg?seed=Yexiu&backgroundColor=c0aede',
  fangyuan: 'https://api.dicebear.com/9.x/notionists/svg?seed=Fangyuan&backgroundColor=ffd5dc',
  aqiang: 'https://api.dicebear.com/9.x/adventurer/svg?seed=Aqiang&backgroundColor=ffdfbf',
};

function personaByName(name) {
  if (!name) return null;
  return personas.find((p) => p.name === name) || null;
}

export function aiAvatarUrl(personaName) {
  const p = personaByName(personaName);
  if (!p) return null;
  if (p.avatarUrl) return p.avatarUrl;
  if (AI_AVATAR_URLS[p.id]) return AI_AVATAR_URLS[p.id];
  return null;
}

/** 兼容旧调用：返回可作为 <img src> 的 URL，优先远程头像 */
export function aiAvatarFile(personaName) {
  const url = aiAvatarUrl(personaName);
  if (url) return url;
  const p = personaByName(personaName);
  const key = (p?.id || personaName || '').toLowerCase();
  const hit = listAvatars().find((a) => a.file.toLowerCase().startsWith(key) || a.file.toLowerCase().startsWith(String(personaName || '').toLowerCase()));
  return hit ? hit.url : null;
}

export function aiAvatarById(personaId) {
  const p = getPersonaById(personaId);
  return p ? aiAvatarFile(p.name) : null;
}
