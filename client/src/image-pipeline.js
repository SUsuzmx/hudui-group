/**
 * 统一图片压缩 / 上传管线
 * 场景预设：头像、朋友圈封面、朋友圈配图、表情包、聊天图
 */

export const IMAGE_PRESETS = {
  avatar: { maxEdge: 400, quality: 0.86, mime: 'image/jpeg' },
  cover: { maxEdge: 1280, quality: 0.84, mime: 'image/jpeg' },
  moment: { maxEdge: 1280, quality: 0.82, mime: 'image/jpeg' },
  sticker: { maxEdge: 480, quality: 0.86, mime: 'image/jpeg' },
  chat: { maxEdge: 1280, quality: 0.82, mime: 'image/jpeg' },
  status: { maxEdge: 1280, quality: 0.8, mime: 'image/jpeg' },
};

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => {
    if (canvas.toBlob) {
      canvas.toBlob((b) => resolve(b), type, quality);
    } else {
      try {
        const dataUrl = canvas.toDataURL(type, quality);
        const m = /^data:[^;]+;base64,(.*)$/.exec(dataUrl || '');
        if (!m) return resolve(null);
        const bin = atob(m[1]);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        resolve(new Blob([arr], { type }));
      } catch {
        resolve(null);
      }
    }
  });
}

/** File/Blob/dataURL → 压缩后的 Blob（GIF 原样保留动画） */
export async function compressToBlob(input, presetName = 'chat', overrides = {}) {
  const preset = { ...(IMAGE_PRESETS[presetName] || IMAGE_PRESETS.chat), ...overrides };
  let file = input;
  if (typeof input === 'string' && input.startsWith('data:')) {
    const res = await fetch(input);
    file = await res.blob();
  }
  if (!file) throw new Error('未选择图片');
  const type = file.type || 'image/jpeg';
  // GIF 表情保持动画
  if (type === 'image/gif') return file;

  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) {
    // 无法解码则原样上传（但限制过大文件）
    if (file.size > 4 * 1024 * 1024) throw new Error('图片过大，请换一张');
    return file;
  }
  let { width, height } = bitmap;
  const scale = Math.min(1, preset.maxEdge / Math.max(width, height));
  width = Math.max(1, Math.round(width * scale));
  height = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  let blob = await canvasToBlob(canvas, preset.mime, preset.quality);
  // 仍过大则再压一档
  if (blob && blob.size > 900 * 1024) {
    blob = await canvasToBlob(canvas, 'image/jpeg', Math.max(0.6, preset.quality - 0.15));
  }
  return blob || file;
}

/** 便捷：压缩并上传 */
export async function compressAndUpload(uploadFn, input, presetName = 'chat', onProgress) {
  onProgress?.(3);
  const blob = await compressToBlob(input, presetName);
  onProgress?.(8);
  return uploadFn(blob, onProgress);
}

/** dataURL 快速压一档（裁剪结果已是位图） */
export async function dataUrlToCompressedBlob(dataUrl, presetName = 'moment') {
  return compressToBlob(dataUrl, presetName);
}
