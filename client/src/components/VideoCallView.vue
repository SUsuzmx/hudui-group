<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { io } from 'socket.io-client';
import { getToken } from '../api.js';
import { startRingtone, stopRingtone } from '../call-ring.js';
import UserAvatar from './UserAvatar.vue';

const props = defineProps({
  target: { type: Object, required: true },
  me: { type: Object, required: true },
  mode: { type: String, default: 'video' },
  role: { type: String, default: 'caller' }, // caller | callee
  callId: { type: String, default: '' },
  incoming: { type: Object, default: null },
});
const emit = defineEmits(['end']);

const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

const seconds = ref(0);
const muted = ref(false);
const cameraOff = ref(false);
const cameraFacing = ref('user');
let switchingCamera = false;
const speaker = ref(true);
const connecting = ref(true);
const callFailed = ref(false);
const failedTip = ref('');
const connected = ref(false);
const localVideo = ref(null);
const remoteVideo = ref(null);
const remoteAudio = ref(null);
const statusText = ref(props.role === 'callee' ? '对方邀请你通话' : '正在呼叫…');
const canAccept = ref(props.role === 'callee');

let socket = null;
let pc = null;
let localStream = null;
let timer = null;
let cid = props.callId || props.incoming?.callId || '';
let closed = false;

const isVideo = () => props.mode !== 'voice';
const peerId = () => {
  if (props.role === 'callee') return props.incoming?.from?.userId ?? props.target?.userId;
  return props.target?.userId ?? props.incoming?.from?.userId;
};

function fmt(sec) {
  const m = String(Math.floor(sec / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function stopTimer() {
  if (timer) clearInterval(timer);
  timer = null;
}

function startTimer() {
  stopTimer();
  timer = setInterval(() => {
    seconds.value += 1;
    if (seconds.value >= 3600) hangup();
  }, 1000);
}

function cleanupMedia() {
  try { localStream?.getTracks?.().forEach((t) => t.stop()); } catch { /* ignore */ }
  localStream = null;
  try { pc?.close?.(); } catch { /* ignore */ }
  pc = null;
}

function finish(opts = {}) {
  if (closed) return;
  closed = true;
  stopRingtone();
  stopTimer();
  cleanupMedia();
  if (socket && cid) {
    try {
      socket.emit('call:end', {
        callId: cid,
        duration: connected.value ? seconds.value : 0,
      });
    } catch { /* ignore */ }
  }
  emit('end', { seconds: seconds.value, ...opts });
}

async function getMedia() {
  const constraints = {
    audio: true,
    video: isVideo()
      ? { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }
      : false,
  };
  localStream = await navigator.mediaDevices.getUserMedia(constraints);
  if (localVideo.value && isVideo()) {
    localVideo.value.srcObject = localStream;
  }
  return localStream;
}

function ensurePc() {
  if (pc) return pc;
  pc = new RTCPeerConnection(RTC_CONFIG);
  pc.onicecandidate = (e) => {
    if (e.candidate && cid) {
      socket?.emit('call:ice', { callId: cid, candidate: e.candidate });
    }
  };
  pc.ontrack = (e) => {
    const stream = e.streams?.[0];
    if (remoteVideo.value && stream) remoteVideo.value.srcObject = stream;
    if (remoteAudio.value && stream) remoteAudio.value.srcObject = stream;
  };
  pc.onconnectionstatechange = () => {
    const st = pc?.connectionState;
    if (st === 'connected') {
      connected.value = true;
      connecting.value = false;
      statusText.value = fmt(seconds.value);
      startTimer();
    } else if (st === 'failed' || st === 'disconnected') {
      if (!closed) {
        failedTip.value = '连接中断';
        callFailed.value = true;
      }
    }
  };
  return pc;
}

function attachLocalTracks() {
  const conn = ensurePc();
  if (!localStream) return;
  for (const track of localStream.getTracks()) {
    const exists = conn.getSenders().some((s) => s.track?.kind === track.kind);
    if (!exists) conn.addTrack(track, localStream);
  }
}

async function startAsCaller() {
  connecting.value = true;
  statusText.value = '正在呼叫…';
  const to = peerId();
  if (!to) {
    failedTip.value = '无法确定对方';
    callFailed.value = true;
    connecting.value = false;
    return;
  }
  try {
    await getMedia();
  } catch (e) {
    failedTip.value = '无法访问摄像头/麦克风';
    callFailed.value = true;
    connecting.value = false;
    return;
  }
  const ack = await new Promise((res) => {
    socket.emit('call:invite', { toUserId: to, mode: props.mode, callId: cid || undefined }, res);
  });
  if (!ack?.ok) {
    failedTip.value = ack?.error || '呼叫失败';
    callFailed.value = true;
    connecting.value = false;
    return;
  }
  cid = ack.callId;
}

async function onAccepted() {
  statusText.value = '正在接通…';
  connecting.value = true;
  try {
    attachLocalTracks();
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('call:offer', { callId: cid, sdp: pc.localDescription });
  } catch (e) {
    failedTip.value = e.message || '建立连接失败';
    callFailed.value = true;
  }
}

async function acceptCall() {
  if (props.role !== 'callee') return;
  stopRingtone();
  canAccept.value = false;
  try {
    await getMedia();
  } catch (e) {
    failedTip.value = '无法访问摄像头/麦克风';
    callFailed.value = true;
    return;
  }
  const ack = await new Promise((res) => socket.emit('call:accept', { callId: cid }, res));
  if (!ack?.ok) {
    failedTip.value = ack?.error || '接听失败';
    callFailed.value = true;
    return;
  }
  attachLocalTracks();
  statusText.value = '正在接通…';
}

function rejectCall() {
  stopRingtone();
  socket?.emit('call:reject', { callId: cid });
  finish({ rejected: true });
}

async function onOffer({ sdp, callId }) {
  if (callId && cid && callId !== cid) return;
  if (props.role !== 'callee') return;
  try {
    if (!localStream) await getMedia();
    attachLocalTracks();
    const conn = ensurePc();
    await conn.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await conn.createAnswer();
    await conn.setLocalDescription(answer);
    socket.emit('call:answer', { callId: cid, sdp: conn.localDescription });
  } catch (e) {
    failedTip.value = e.message || '协商失败';
    callFailed.value = true;
  }
}

async function onAnswer({ sdp, callId }) {
  if (callId && cid && callId !== cid) return;
  try {
    const conn = ensurePc();
    await conn.setRemoteDescription(new RTCSessionDescription(sdp));
  } catch (e) {
    failedTip.value = e.message || '应答处理失败';
    callFailed.value = true;
  }
}

async function onIce({ candidate, callId }) {
  if (callId && cid && callId !== cid) return;
  if (!pc || !candidate) return;
  try {
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  } catch { /* ignore */ }
}

function hangup() {
  if (socket && cid) {
    socket.emit('call:end', {
      callId: cid,
      duration: connected.value ? seconds.value : 0,
    });
  }
  stopRingtone();
  // finish 内会再 emit 一次 call:end, 先清 cid 避免重复日志
  const id = cid;
  cid = '';
  finish({ hungup: true, callId: id });
}

function toggleMute() {
  muted.value = !muted.value;
  localStream?.getAudioTracks?.().forEach((t) => { t.enabled = !muted.value; });
}

function toggleCamera() {
  if (!isVideo()) return;
  cameraOff.value = !cameraOff.value;
  localStream?.getVideoTracks?.().forEach((t) => { t.enabled = !cameraOff.value; });
}

/** 通话中切换前置/后置摄像头 */
async function switchCamera() {
  if (!isVideo() || switchingCamera) return;
  if (cameraOff.value || !localStream) {
    failedTip.value = '请先打开摄像头';
    return;
  }
  switchingCamera = true;
  const next = cameraFacing.value === 'user' ? 'environment' : 'user';
  try {
    const track = localStream.getVideoTracks?.()[0];
    if (track?.applyConstraints) {
      try {
        await track.applyConstraints({ facingMode: next });
        cameraFacing.value = next;
        if (localVideo.value) localVideo.value.srcObject = localStream;
        return;
      } catch { /* fallthrough replaceTrack */ }
    }
    const ns = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: next, width: { ideal: 640 }, height: { ideal: 480 } },
    });
    const newTrack = ns.getVideoTracks()[0];
    if (!newTrack) throw new Error('no video track');
    const sender = pc?.getSenders?.().find((s) => s.track?.kind === 'video');
    if (sender) await sender.replaceTrack(newTrack);
    const olds = localStream.getVideoTracks?.() || [];
    for (const t of olds) {
      try { localStream.removeTrack(t); t.stop(); } catch { /* ignore */ }
    }
    localStream.addTrack(newTrack);
    cameraFacing.value = next;
    if (localVideo.value) localVideo.value.srcObject = localStream;
  } catch (e) {
    console.warn('switch camera failed', e);
  } finally {
    switchingCamera = false;
  }
}

function toggleSpeaker() {
  speaker.value = !speaker.value;
  if (remoteVideo.value) remoteVideo.value.muted = !speaker.value;
  if (remoteAudio.value) remoteAudio.value.muted = !speaker.value;
}

onMounted(() => {
  // 被叫: 响铃
  if (props.role === 'callee' || props.incoming) {
    startRingtone();
  }
  socket = io('/', {
    auth: { token: getToken() },
    transports: ['polling', 'websocket'],
    upgrade: true,
  });
  socket.on('connect', () => {
    if (props.role === 'caller') startAsCaller();
  });
  socket.on('call:accepted', () => {
    stopRingtone();
    if (props.role === 'caller') onAccepted();
  });
  socket.on('call:rejected', () => {
    stopRingtone();
    failedTip.value = '对方已拒绝';
    callFailed.value = true;
    connecting.value = false;
  });
  socket.on('call:ended', () => {
    stopRingtone();
    finish({ remoteEnded: true });
  });
  socket.on('call:offer', onOffer);
  socket.on('call:answer', onAnswer);
  socket.on('call:ice', onIce);

  // 信令兜底: socket 已连接时
  if (socket.connected && props.role === 'caller') startAsCaller();
});

onBeforeUnmount(() => {
  stopRingtone();
  stopTimer();
  if (socket && cid && !closed) {
    socket.emit('call:end', { callId: cid, duration: connected.value ? seconds.value : 0 });
  }
  cleanupMedia();
  socket?.disconnect();
});
</script>

<template>
  <div class="call-page" :class="{ voice: mode === 'voice' }">
    <div class="call-bg"></div>
    <div class="call-main">
      <template v-if="!connected && (role === 'callee' || connecting || callFailed)">
        <UserAvatar
          :name="target.nickname || incoming?.from?.nickname"
          :avatar="target.avatar || incoming?.from?.avatar"
          :emoji="target.emoji"
          :color="target.color || incoming?.from?.avatarColor || '#07c160'"
          :size="mode === 'voice' ? 88 : 72"
        />
        <div class="call-name">{{ target.nickname || incoming?.from?.nickname || '好友' }}</div>
        <div class="call-status" :class="{ fail: callFailed }">
          <template v-if="callFailed">{{ failedTip || '通话失败' }}</template>
          <template v-else>{{ statusText }}</template>
        </div>
        <div v-if="role === 'callee' && canAccept && !callFailed" class="incoming-actions">
          <button class="inc-btn reject" type="button" @click="rejectCall">拒绝</button>
          <button class="inc-btn accept" type="button" @click="acceptCall">
            {{ mode === 'voice' ? '接听' : '接听' }}
          </button>
        </div>
      </template>

      <div class="video-stage" :class="{ hidden: !connected && mode === 'voice' }">
        <video
          v-show="mode !== 'voice'"
          ref="remoteVideo"
          class="remote-video"
          autoplay
          playsinline
        ></video>
        <video
          v-show="mode !== 'voice'"
          ref="localVideo"
          class="local-video"
          autoplay
          playsinline
          muted
        ></video>
        <audio ref="remoteAudio" autoplay playsinline></audio>
        <div v-if="connected" class="call-timer">{{ fmt(seconds) }}</div>
        <div v-else-if="!callFailed" class="call-timer dim">{{ statusText }}</div>
      </div>
    </div>

    <div class="call-actions">
      <button class="call-btn" :class="{ on: !muted }" type="button" @click="toggleMute">
        <span>{{ muted ? '🔇' : '🎤' }}</span>
        <span class="btn-label">{{ muted ? '已静音' : '静音' }}</span>
      </button>
      <button v-if="mode !== 'voice'" class="call-btn" :class="{ on: !cameraOff }" type="button" @click="toggleCamera">
        <span>{{ cameraOff ? '📷' : '📹' }}</span>
        <span class="btn-label">{{ cameraOff ? '摄像头关' : '摄像头' }}</span>
      </button>
      <button v-if="mode !== 'voice'" class="call-btn" type="button" :disabled="switchingCamera || cameraOff" @click="switchCamera">
        <span>🔄</span>
        <span class="btn-label">{{ cameraFacing === 'user' ? '前摄' : '后摄' }}</span>
      </button>
      <button class="call-btn" :class="{ on: speaker }" type="button" @click="toggleSpeaker">
        <span>🔊</span>
        <span class="btn-label">免提</span>
      </button>
      <button class="call-btn hangup" type="button" @click="hangup">
        <span>📵</span>
        <span class="btn-label">挂断</span>
      </button>
    </div>

    <div class="call-tip">WebRTC 音视频 · 需双方在线并授权麦克风/摄像头</div>
  </div>
</template>

<style scoped>
.call-page {
  position: absolute;
  inset: 0;
  z-index: 70;
  background: #1a1a1a;
  display: flex;
  flex-direction: column;
  color: #fff;
  animation: fadeIn 180ms var(--ease);
}
.call-bg {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, #2a2a2e 0%, #1a1a1a 45%, #111 100%);
}
.call-main {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 40px 20px 0;
}
.call-name { font-size: 22px; font-weight: 500; }
.call-status { font-size: 14px; color: rgba(255,255,255,0.7); font-variant-numeric: tabular-nums; }
.call-status.fail { color: #fa5151; }
.incoming-actions { display: flex; gap: 16px; margin-top: 18px; }
.inc-btn {
  min-width: 88px; min-height: 44px; border: 0; border-radius: 22px;
  font-size: 15px; color: #fff;
}
.inc-btn.reject { background: #fa5151; }
.inc-btn.accept { background: #07c160; }
.video-stage {
  position: relative;
  width: min(100%, 420px);
  aspect-ratio: 3/4;
  border-radius: 12px;
  overflow: hidden;
  background: #000;
}
.video-stage.hidden { display: none; }
.remote-video { width: 100%; height: 100%; object-fit: cover; background: #000; }
.local-video {
  position: absolute; right: 12px; top: 12px;
  width: 96px; height: 128px; object-fit: cover;
  border-radius: 8px; border: 1px solid rgba(255,255,255,0.25);
  background: #222; z-index: 2;
}
.call-timer {
  position: absolute; left: 0; right: 0; top: 10px;
  text-align: center; font-size: 13px; color: rgba(255,255,255,0.85);
  font-variant-numeric: tabular-nums; z-index: 3;
}
.call-timer.dim { color: rgba(255,255,255,0.55); }
.call-actions {
  position: relative;
  display: flex;
  justify-content: space-around;
  gap: 8px;
  padding: 20px 16px calc(28px + var(--safe-b));
}
.call-btn {
  width: 64px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  color: #fff;
  min-height: 64px;
  border: 0;
  background: transparent;
}
.call-btn span:first-child {
  width: 56px; height: 56px; border-radius: 50%;
  background: rgba(255,255,255,0.14);
  display: flex; align-items: center; justify-content: center; font-size: 24px;
}
.call-btn.on span:first-child { background: rgba(255,255,255,0.22); }
.call-btn.hangup span:first-child { background: #fa5151; }
.btn-label { font-size: 11px; color: rgba(255,255,255,0.85); }
.call-tip {
  position: relative; text-align: center; font-size: 11px;
  color: rgba(255,255,255,0.35); padding-bottom: 8px;
}
audio { display: none; }
</style>
