/**
 * XHR 上传，支持进度回调
 * onProgress(percent 0-100)
 *
 * 进度语义：
 * - 0–8%  准备/编码
 * - 8–92% 网络上传（xhr.upload）
 * - 92–99% 服务器处理等待
 * - 100%   完成
 * 避免本地缓冲导致 upload 进度直接跳 100%。
 */
export function uploadWithProgress(path, blob, { kind = 'image', filename = '', onProgress } = {}) {
  const token = localStorage.getItem('hudui_token');
  const report = (p) => {
    if (onProgress) onProgress(Math.max(0, Math.min(100, Math.round(p))));
  };

  return new Promise((resolve, reject) => {
    const fd = new FormData();
    const name = filename
      || (kind === 'voice' ? 'voice.webm'
        : kind === 'video' ? 'video.mp4'
          : kind === 'file' ? 'file.bin'
            : 'image.jpg');
    fd.append('kind', kind || 'image');
    fd.append('file', blob, name);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', path, true);
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    // 上传字节：映射到 8–92，避免一上来就 100
    let lastNet = 8;
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) {
        report(lastNet);
        return;
      }
      const ratio = e.loaded / e.total;
      // 即使浏览器本地缓冲瞬间完成，也最多到 92
      const p = 8 + ratio * 84;
      lastNet = Math.max(lastNet, Math.min(92, p));
      report(lastNet);
    };
    xhr.upload.onload = () => {
      // 字节发完 ≠ 服务端写完
      report(92);
    };
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText || '{}'); } catch { /* empty */ }
      if (xhr.status >= 200 && xhr.status < 300) {
        report(100);
        resolve(data);
      } else {
        reject(new Error(data.error || `上传失败 (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error('网络异常，上传失败'));
    xhr.onabort = () => reject(new Error('已取消上传'));
    report(8);
    xhr.send(fd);
  });
}

/** 异步 dataURL → Blob，避免大图 atob 卡主线程 */
export function dataUrlToBlobAsync(dataUrl) {
  return new Promise((resolve) => {
    try {
      const m = /^data:([^;,]+)?(;base64)?,(.*)$/i.exec(dataUrl || '');
      if (!m) return resolve(null);
      const mime = m[1] || 'image/jpeg';
      if (!m[2]) {
        resolve(new Blob([decodeURIComponent(m[3])], { type: mime }));
        return;
      }
      // fetch data: URL 走浏览器内建解码，比手写 atob 快且不卡太久
      fetch(dataUrl)
        .then((r) => r.blob())
        .then((b) => resolve(b))
        .catch(() => resolve(dataUrlToBlobSync(dataUrl)));
    } catch {
      resolve(dataUrlToBlobSync(dataUrl));
    }
  });
}

export function dataUrlToBlobSync(dataUrl) {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/i.exec(dataUrl || '');
  if (!m) return null;
  const mime = m[1] || 'image/jpeg';
  if (m[2]) {
    const bin = atob(m[3]);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }
  return new Blob([decodeURIComponent(m[3])], { type: mime });
}
