// 本地下载歌曲库：扫描 music/ 目录，供猜歌在拉流超时/主题需要时兜底
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);
export const LOCAL_MUSIC_DIR = path.join(ROOT, 'music');

const AUDIO_EXT = new Set(['.mp3', '.aac', '.m4a', '.wav', '.flac', '.ogg', '.webm']);
const CACHE_TTL_MS = 60_000;

let cache = { at: 0, byArtist: new Map(), all: [] };

function titleFromFilename(name) {
  let title = name.replace(/\.[^.]+$/, '').trim();
  // 去掉「歌手 - 歌名」「歌手-歌名」等前缀
  title = title.replace(/^[^-\u2013\u2014]{1,20}\s*[-–—]\s*/, '').trim() || name.replace(/\.[^.]+$/, '').trim();
  return title;
}

function safeRel(artistDir, file) {
  // 生成 URL 路径段，保留中文
  return `/music/${encodeURIComponent(artistDir)}/${encodeURIComponent(file)}`;
}

/**
 * 扫描 music/<歌手>/<曲名>.mp3
 * @returns {{ byArtist: Map<string, object[]>, all: object[] }}
 */
export function scanLocalMusic({ force = false } = {}) {
  const t = Date.now();
  if (!force && cache.all.length && t - cache.at < CACHE_TTL_MS) return cache;

  const byArtist = new Map();
  const all = [];
  try {
    if (!fs.existsSync(LOCAL_MUSIC_DIR)) {
      cache = { at: t, byArtist, all };
      return cache;
    }
    const artistDirs = fs.readdirSync(LOCAL_MUSIC_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    for (const artistName of artistDirs) {
      const dir = path.join(LOCAL_MUSIC_DIR, artistName);
      let files = [];
      try {
        files = fs.readdirSync(dir, { withFileTypes: true })
          .filter((f) => f.isFile() && AUDIO_EXT.has(path.extname(f.name).toLowerCase()))
          .map((f) => f.name);
      } catch {
        continue;
      }
      // 同名优先 mp3，再 m4a/aac，避免重复题目
      const seenTitle = new Set();
      files.sort((a, b) => {
        const ea = path.extname(a).toLowerCase();
        const eb = path.extname(b).toLowerCase();
        const rank = (e) => (e === '.mp3' ? 0 : e === '.m4a' ? 1 : e === '.aac' ? 2 : 3);
        return rank(ea) - rank(eb) || a.localeCompare(b);
      });
      const list = [];
      for (const file of files) {
        const title = titleFromFilename(file);
        const key = title.toLowerCase();
        if (!title || seenTitle.has(key)) continue;
        seenTitle.add(key);
        const full = path.join(dir, file);
        let durationMs = 240_000;
        try {
          const st = fs.statSync(full);
          // 粗估：128kbps ≈ 16KB/s，再夹在 60s–8min
          if (st.size > 0) {
            durationMs = Math.min(480_000, Math.max(60_000, Math.round((st.size / 16000) * 1000)));
          }
        } catch {
          /* ignore */
        }
        const track = {
          source: 'local',
          id: `local:${artistName}/${file}`,
          url: safeRel(artistName, file),
          title,
          artist: artistName,
          cover: '',
          duration: Math.round(durationMs / 1000),
          durationMs,
          mid: '',
          mediaMid: '',
          hash: '',
          albumId: '',
          albumAudioId: '',
          mixSongId: '',
          hqHash: '',
          sqHash: '',
          resHash: '',
        };
        list.push(track);
        all.push(track);
      }
      if (list.length) byArtist.set(artistName, list);
    }
  } catch {
    /* 扫描失败时保持空库 */
  }

  cache = { at: t, byArtist, all };
  return cache;
}

/** 指定歌手的本地曲目（无则空数组） */
export function localTracksForArtist(artist) {
  const name = String(artist || '').trim();
  if (!name) return [];
  const { byArtist, all } = scanLocalMusic();
  if (byArtist.has(name)) return byArtist.get(name).slice();
  // 宽松匹配：目录名包含关键字
  const hit = [];
  for (const [k, list] of byArtist) {
    if (k.includes(name) || name.includes(k)) hit.push(...list);
  }
  return hit.length ? hit : [];
}

export function allLocalMusicTracks() {
  return scanLocalMusic().all.slice();
}

export function localMusicRoot() {
  return LOCAL_MUSIC_DIR;
}
