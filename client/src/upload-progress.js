/**
 * XHR 上传，支持进度回调
 * onProgress(percent 0-100)
 */
export function uploadWithProgress(path, blob, { kind = 'image', filename = '', onProgress } = {}) {
  const token = localStorage.getItem('hudui_token');
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    const name = filename || (kind === 'voice' ? 'voice.webm' : kind === 'file' ? 'file.bin' : 'image.jpg');
    fd.append('kind', kind || 'image');
    fd.append('file', blob, name);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', path, true);
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
      if (!onProgress) return;
      if (e.lengthComputable) {
        const p = Math.min(100, Math.round((e.loaded / e.total) * 100));
        onProgress(p);
      } else {
        onProgress(-1); // 未知总量
      }
    };
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText || '{}'); } catch { /* empty */ }
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        resolve(data);
      } else {
        reject(new Error(data.error || `上传失败 (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error('网络异常，上传失败'));
    xhr.onabort = () => reject(new Error('已取消上传'));
    xhr.send(fd);
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
