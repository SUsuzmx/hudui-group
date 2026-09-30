// Web Push 客户端订阅 + 后台通知
import { api } from './api.js';
import { ensureNotifyPermission } from './notify.js';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

export function isStandalone() {
  try {
    return window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true;
  } catch {
    return false;
  }
}

export function isIosSafari() {
  try {
    const ua = navigator.userAgent || '';
    const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const webkit = /WebKit/.test(ua);
    const notChrome = !/CriOS|FxiOS|EdgiOS/.test(ua);
    return iOS && webkit && notChrome;
  } catch {
    return false;
  }
}

export function isAndroid() {
  try { return /Android/i.test(navigator.userAgent || ''); }
  catch { return false; }
}

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    return reg;
  } catch {
    return null;
  }
}

/** 后台本地通知（页面隐藏时），优先走 SW */
export async function showLocalNotification({ title, body, tag, url, conversationId } = {}) {
  const payload = {
    type: 'show-notification',
    title: title || '微信',
    body: body || '',
    tag: tag || 'hudui-msg',
    url: url || '/',
    conversationId: conversationId || null,
  };
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (reg?.active) {
      reg.active.postMessage(payload);
      return true;
    }
  } catch { /* ignore */ }
  return false;
}

export async function subscribePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { ok: false, reason: 'unsupported' };
  }
  const allowed = await ensureNotifyPermission();
  if (!allowed) return { ok: false, reason: 'permission' };

  const reg = await registerServiceWorker();
  if (!reg) return { ok: false, reason: 'sw' };

  let keyRes;
  try {
    keyRes = await api.pushPublicKey();
  } catch {
    return { ok: false, reason: 'no-key' };
  }
  if (!keyRes?.publicKey) return { ok: false, reason: 'no-key' };

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    try {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(keyRes.publicKey),
      });
    } catch (e) {
      return { ok: false, reason: e?.message || 'subscribe-failed' };
    }
  }

  try {
    await api.pushSubscribe(sub.toJSON());
    return { ok: true, subscription: sub };
  } catch (e) {
    return { ok: false, reason: e?.message || 'save-failed' };
  }
}

export async function unsubscribePush() {
  try {
    const reg = await navigator.serviceWorker?.ready;
    const sub = await reg?.pushManager?.getSubscription();
    if (sub) {
      try { await api.pushUnsubscribe(sub.endpoint); } catch { /* ignore */ }
      await sub.unsubscribe();
    }
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
