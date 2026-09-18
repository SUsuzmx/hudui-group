// 头像工具: img 目录里文件名以 AI 名字开头的图片自动作为该 AI 的头像。
import fs from 'node:fs';
import { IMG_DIR, listAvatars } from '../auth.js';

export function aiAvatarFile(personaName) {
  const hit = listAvatars().find((a) =>
    a.file.toLowerCase().startsWith(personaName.toLowerCase())
  );
  return hit ? hit.url : null;
}
