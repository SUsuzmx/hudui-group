// 媒体上传解析与落盘: multipart / 原始二进制 / 兼容旧 base64 JSON。
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './db.js';

const MEDIA_DIR = path.join(ROOT, 'data', 'media');

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);
const VOICE_EXT = new Set(['webm', 'ogg', 'mp3', 'wav', 'm4a', 'aac', 'x-m4a']);
const VIDEO_EXT = new Set(['mp4', 'webm', 'mov', 'm4v']);
const LIMITS = {
  image: 8 * 1024 * 1024,
  file: 8 * 1024 * 1024,
  voice: 5 * 1024 * 1024,
  video: 40 * 1024 * 1024,
};

export function normalizeKind(kind) {
  const k = String(kind || '').toLowerCase();
  if (k === 'voice' || k === 'audio') return 'voice';
  if (k === 'file') return 'file';
  if (k === 'video' || k === 'movie') return 'video';
  return 'image';
}

export function parseMultipartBuffer(buf, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(String(contentType || ''));
  if (!m) return null;
  const boundary = Buffer.from('--' + (m[1] || m[2]).trim());
  const parts = [];
  let start = buf.indexOf(boundary);
  if (start < 0) return null;
  start += boundary.length;
  while (start < buf.length) {
    if (buf[start] === 0x0d && buf[start + 1] === 0x0a) start += 2;
    else if (buf[start] === 0x0a || buf[start] === 0x0d) start += 1;
    if (buf[start] === 0x2d && buf[start + 1] === 0x2d) break;
    const next = buf.indexOf(boundary, start);
    if (next < 0) break;
    let partEnd = next;
    if (buf[partEnd - 2] === 0x0d && buf[partEnd - 1] === 0x0a) partEnd -= 2;
    const part = buf.subarray(start, partEnd);
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd >= 0) {
      const header = part.subarray(0, headerEnd).toString('utf8');
      const body = part.subarray(headerEnd + 4);
      const nameMatch = /name="([^"]*)"/i.exec(header);
      const fileMatch = /filename="([^"]*)"/i.exec(header);
      const ctMatch = /content-type:\s*([^\r\n]+)/i.exec(header);
      parts.push({
        name: nameMatch?.[1] || '',
        filename: fileMatch?.[1] || '',
        contentType: ctMatch?.[1]?.trim() || '',
        data: body,
      });
    }
    start = next + boundary.length;
  }
  return parts;
}

function extFromMime(mime, fallback = 'bin') {
  const map = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'audio/webm': 'webm',
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/wav': 'wav',
    'audio/x-m4a': 'm4a',
    'audio/mp4': 'm4a',
    'audio/aac': 'aac',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov',
    'video/x-m4v': 'm4v',
  };
  return map[String(mime || '').toLowerCase()] || fallback;
}

function sanitizeExt(ext, kind) {
  let e = String(ext || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
  if (e === 'jpeg') e = 'jpg';
  if (kind === 'image' && !IMAGE_EXT.has(e)) return null;
  if (kind === 'voice' && !VOICE_EXT.has(e)) e = 'webm';
  if (kind === 'video' && !VIDEO_EXT.has(e)) {
    // 宽松：mov/m4v → mp4 容器不一定兼容，仍保留原扩展名校验失败则回 mp4
    e = 'mp4';
  }
  return e;
}

export function saveMediaBuffer(buf, kind, ext) {
  const mediaKind = normalizeKind(kind);
  const max = LIMITS[mediaKind] || LIMITS.file;
  if (!buf || buf.length < 1 || buf.length > max) {
    return { error: mediaKind === 'video' ? '视频大小不合适（上限 40MB）' : mediaKind === 'voice' ? '语音大小不合适' : '文件大小不合适' };
  }
  if (mediaKind === 'image' && buf.length < 20) {
    return { error: '图片大小不合适' };
  }
  const safeExt = sanitizeExt(ext, mediaKind);
  if (!safeExt) return { error: '图片格式不支持' };
  const name = `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${safeExt}`;
  const file = path.join(MEDIA_DIR, name);
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  fs.writeFileSync(file, buf);
  return { url: `/media/${name}`, mediaType: mediaKind };
}

export function mediaFromBodyJson(body) {
  const mediaKind = normalizeKind(body?.kind);
  const b64 = String(body?.data || '');
  if (!b64) return { error: '缺少文件数据' };
  if (mediaKind === 'image') {
    const m = b64.match(/^data:image\/(png|jpe?g|webp|gif);base64,(.+)$/i);
    if (!m) return { error: '图片格式不支持' };
    return saveMediaBuffer(Buffer.from(m[2], 'base64'), 'image', m[1].toLowerCase().replace('jpeg', 'jpg'));
  }
  if (mediaKind === 'file') {
    const m = b64.match(/^data:([^;]+);base64,(.+)$/i);
    if (!m) return { error: '文件格式不支持' };
    return saveMediaBuffer(Buffer.from(m[2], 'base64'), 'file', extFromMime(m[1], 'bin'));
  }
  if (mediaKind === 'video') {
    const m = b64.match(/^data:video\/([a-z0-9.+-]+)(?:;[^,]*)?;base64,(.+)$/i);
    if (!m) return { error: '视频格式不支持' };
    return saveMediaBuffer(Buffer.from(m[2], 'base64'), 'video', extFromMime(`video/${m[1]}`, 'mp4'));
  }
  const m = b64.match(/^data:audio\/([a-z0-9.+-]+)(?:;[^,]*)?;base64,(.+)$/i);
  if (!m) return { error: '语音格式不支持' };
  const ext = m[1].toLowerCase().split('+')[0].replace('mpeg', 'mp3');
  return saveMediaBuffer(Buffer.from(m[2], 'base64'), 'voice', ext);
}

export function mediaFromMultipart(buf, contentType, queryKind) {
  const parts = parseMultipartBuffer(buf, contentType) || [];
  const filePart = parts.find((p) => p.data?.length && (p.filename || p.name === 'file' || p.name === 'data'));
  const kindPart = parts.find((p) => p.name === 'kind')?.data?.toString('utf8').trim();
  const mediaKind = normalizeKind(kindPart || queryKind);
  if (!filePart?.data?.length) return { error: '缺少上传文件' };
  const mime = filePart.contentType || '';
  let ext = path.extname(filePart.filename || '').replace('.', '').toLowerCase();
  if (!ext) {
    const def = mediaKind === 'image' ? 'png' : mediaKind === 'voice' ? 'webm' : mediaKind === 'video' ? 'mp4' : 'bin';
    ext = extFromMime(mime, def);
  }
  return saveMediaBuffer(filePart.data, mediaKind, ext);
}

export function mediaFromRaw(buf, contentType, kind, filename) {
  const mediaKind = normalizeKind(kind);
  let ext = path.extname(String(filename || '')).replace('.', '').toLowerCase();
  if (!ext) {
    const def = mediaKind === 'image' ? 'png' : mediaKind === 'voice' ? 'webm' : mediaKind === 'video' ? 'mp4' : 'bin';
    ext = extFromMime(contentType, def);
  }
  return saveMediaBuffer(buf, mediaKind, ext);
}
