// 共享 Socket: 避免每次进聊天页都新建连接导致白屏/断线提示
import { io } from 'socket.io-client';
import { getToken } from './api.js';

let socket = null;

export function getSocket() {
  const token = getToken();
  if (!socket) {
    socket = io('/', {
      auth: { token },
      transports: ['websocket', 'polling'],
      upgrade: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 400,
      reconnectionDelayMax: 3000,
      timeout: 8000,
      autoConnect: true,
    });
    socket.on('auth:kicked', () => {
      try { releaseSocket(); } catch { /* ignore */ }
    });
    socket.on('connect_error', (err) => {
      const msg = String(err?.message || '');
      if (msg.includes('登录') || msg.includes('expired') || msg.includes('unauthorized')) {
        try { releaseSocket(); } catch { /* ignore */ }
      }
    });
  } else if (socket.disconnected) {
    socket.auth = { token };
    socket.connect();
  } else if (token && socket.auth?.token !== token) {
    socket.auth = { token };
  }
  return socket;
}

export function bindSocket(event, fn) {
  const s = getSocket();
  s.on(event, fn);
  return () => {
    try { s.off(event, fn); } catch { /* ignore */ }
  };
}

export function socketConnected() {
  return Boolean(socket?.connected);
}

export function releaseSocket() {
  // 登出时调用
  try { socket?.disconnect(); } catch { /* ignore */ }
  socket = null;
}
