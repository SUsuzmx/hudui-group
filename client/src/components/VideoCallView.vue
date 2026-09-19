<script setup>
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { getSocket } from '../socket-store.js';
import { startRingtone, stopRingtone } from '../call-ring.js';
import UserAvatar from './UserAvatar.vue';

const props = defineProps({
  target: { type: Object, required: true },
  me: { type: Object, required: true },
  mode: { type: String, default: 'video' },
  role: { type: String, default: 'caller' },
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
const cameraOff = ref(true);
const cameraFacing = ref('user');
let switchingCamera = false;
const speaker = ref(false);
const connecting = ref(true);
const callFailed = ref(false);
const failedTip = ref('');
const connected = ref(false);
const hasRemoteMedia = ref(false);
const localVideo = ref(null);
const remoteVideo = ref(null);
const remoteAudio = ref(null);
const statusText = ref(props.role === 'callee' ? '对方邀请你通话' : '等待对方接受邀请');
const canAccept = ref(props.role === 'callee');

let socket = null;
let pc = null;
let localStream = null;
let remoteStream = null;
let timer = null;
let ringTimeout = null;
let failCloseTimer = null;
let cid = props.callId || props.incoming?.callId || '';
let closed = false;
let unbinders = [];
let endedNotified = false;
let offerSent = false;
let acceptDone = false;
let remoteDescSet = false;
let pendingIce = [];
let pendingOfferSdp = null;
const NO_ANSWER_MS = 45000;

function isVideo() { return props.mode !== 'voice'; }
const peerId = () => {
  if (props.role === 'callee') return props.incoming?.from?.userId ?? props.target?.userId;
  return props.target?.userId ?? props.incoming?.from?.userId;
};

function matchCallId(id) {
  if (!id) return true;
  if (!cid) return true;
  return String(id) === String(cid);
}

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
    statusText.value = fmt(seconds.value);
    if (seconds.value >= 3600) hangup();
  }, 1000);
}

function safePlay(el) {
  try { el?.play?.()?.catch?.(() => {}); } catch { /* ignore */ }
}

function bindLocalPreview() {
  nextTick(() => {
    if (localVideo.value && localStream && isVideo()) {
      localVideo.value.srcObject = localStream;
      safePlay(localVideo.value);
    }
  });
}

function bindRemoteStream() {
  if (!remoteStream) return;
  nextTick(() => {
    if (remoteVideo.value && isVideo()) {
      remoteVideo.value.srcObject = remoteStream;
      safePlay(remoteVideo.value);
    }
    if (remoteAudio.value) {
      remoteAudio.value.srcObject = remoteStream;
      safePlay(remoteAudio.value);
    }
  });
}

function markConnected() {
  if (closed || connected.value) return;
  connected.value = true;
  connecting.value = false;
  callFailed.value = false;
  clearTimeout(ringTimeout);
  stopRingtone();
  statusText.value = fmt(seconds.value);
  startTimer();
  bindLocalPreview();
  bindRemoteStream();
}

function cleanupMedia() {
  try { localStream?.getTracks?.().forEach((t) => t.stop()); } catch { /* ignore */ }
  localStream = null;
  try { remoteStream?.getTracks?.().forEach((t) => t.stop()); } catch { /* ignore */ }
  remoteStream = null;
  try { pc?.close?.(); } catch { /* ignore */ }
  pc = null;
  remoteDescSet = false;
  pendingIce = [];
  pendingOfferSdp = null;
}

function notifyPeerEnd(duration) {
  if (endedNotified || !socket || !cid) return;
  endedNotified = true;
  try {
    socket.emit('call:end', { callId: cid, duration: duration || 0 });
  } catch { /* ignore */ }
}

function finish(opts = {}) {
  if (closed) return;
  closed = true;
  stopRingtone();
  stopTimer();
  clearTimeout(ringTimeout);
  clearTimeout(failCloseTimer);
  if (!opts.skipNotify && !opts.remoteEnded && !opts.rejected) {
    notifyPeerEnd(connected.value ? seconds.value : 0);
  }
  cleanupMedia();
  emit('end', { seconds: seconds.value, ...opts });
}

async function getMedia() {
  if (localStream) {
    bindLocalPreview();
    return localStream;
  }
  const constraints = {
    audio: true,
    video: isVideo()
      ? { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }
      : false,
  };
  localStream = await navigator.mediaDevices.getUserMedia(constraints);
  bindLocalPreview();
  return localStream;
}

function ensurePc() {
  if (pc) return pc;
  remoteStream = new MediaStream();
  pc = new RTCPeerConnection(RTC_CONFIG);
  pc.addTransceiver('audio', { direction: 'sendrecv' });
  if (isVideo()) pc.addTransceiver('video', { direction: 'sendrecv' });

  pc.onicecandidate = (e) => {
    if (e.candidate && cid) {
      socket?.emit('call:ice', {
        callId: cid,
        candidate: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate,
      });
    }
  };
  pc.oniceconnectionstatechange = () => {
    const s = pc?.iceConnectionState;
    if (s === 'connected' || s === 'completed') markConnected();
    if ((s === 'failed' || s === 'disconnected') && !closed) {
      failedTip.value = '连接中断，请重试';
      callFailed.value = true;
      connecting.value = false;
    }
  };
  pc.ontrack = (e) => {
    const track = e.track;
    if (!track || !remoteStream) return;
    for (const old of remoteStream.getTracks()) {
      if (old.kind === track.kind) {
        try { remoteStream.removeTrack(old); } catch { /* ignore */ }
      }
    }
    remoteStream.addTrack(track);
    hasRemoteMedia.value = remoteStream.getTracks().length > 0;
    bindRemoteStream();
    if (track.kind === 'video' || remoteStream.getVideoTracks().length) {
      markConnected();
    }
  };
  pc.onconnectionstatechange = () => {
    const st = pc?.connectionState;
    if (st === 'connected') markConnected();
    else if ((st === 'failed' || st === 'disconnected') && !closed && !connected.value) {
      failedTip.value = '连接中断';
      callFailed.value = true;
      connecting.value = false;
    }
  };
  return pc;
}

function attachLocalTracks() {
  const conn = ensurePc();
  if (!localStream) return;
  for (const track of localStream.getTracks()) {
    const sender = conn.getSenders().find((s) => s.track?.kind === track.kind);
    if (sender) {
      if (sender.track !== track) {
        sender.replaceTrack(track).catch(() => {});
      }
    } else {
      conn.addTrack(track, localStream);
    }
  }
  bindLocalPreview();
}

async function flushPendingIce() {
  if (!pc) return;
  const list = pendingIce;
  pendingIce = [];
  for (const c of list) {
    try { await pc.addIceCandidate(c); } catch (e) { console.warn('ice add', e); }
  }
}

async function addIceSafe(candidate) {
  if (!candidate) return;
  let ice = null;
  try { ice = new RTCIceCandidate(candidate); } catch { return; }
  if (!pc || !remoteDescSet) {
    pendingIce.push(ice);
    return;
  }
  try { await pc.addIceCandidate(ice); } catch (e) { console.warn('ice', e); }
}

function scheduleFailClose() {
  clearTimeout(failCloseTimer);
  failCloseTimer = setTimeout(() => {
    if (!closed && callFailed.value) finish({ failed: true, skipNotify: true });
  }, 2800);
}

async function startAsCaller() {
  if (closed || connected.value || offerSent) return;
  connecting.value = true;
  statusText.value = '等待对方接受邀请';
  const to = peerId();
  if (!to) {
    failedTip.value = '无法确定对方（需好友 userId，不支持呼叫 AI）';
    callFailed.value = true;
    connecting.value = false;
    scheduleFailClose();
    return;
  }
  try {
    await getMedia();
    ensurePc();
    attachLocalTracks();
  } catch (e) {
    failedTip.value = '无法访问摄像头/麦克风（需 HTTPS 且允许权限）';
    callFailed.value = true;
    connecting.value = false;
    scheduleFailClose();
    return;
  }
  const ack = await new Promise((res) => {
    socket.emit('call:invite', { toUserId: to, mode: props.mode, callId: cid || undefined }, res);
  });
  if (!ack?.ok) {
    failedTip.value = ack?.error || '呼叫失败';
    callFailed.value = true;
    connecting.value = false;
    scheduleFailClose();
    return;
  }
  cid = ack.callId;
  clearTimeout(ringTimeout);
  ringTimeout = setTimeout(() => {
    if (closed || connected.value) return;
    failedTip.value = '对方无应答';
    callFailed.value = true;
    connecting.value = false;
    notifyPeerEnd(0);
    scheduleFailClose();
  }, NO_ANSWER_MS);
}

async function sendOffer() {
  if (offerSent || closed) return;
  offerSent = true;
  statusText.value = '正在接通…';
  connecting.value = true;
  try {
    if (!localStream) await getMedia();
    const conn = ensurePc();
    attachLocalTracks();
    const offer = await conn.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: isVideo() });
    await conn.setLocalDescription(offer);
    socket.emit('call:offer', {
      callId: cid,
      sdp: { type: conn.localDescription.type, sdp: conn.localDescription.sdp },
    });
  } catch (e) {
    offerSent = false;
    failedTip.value = e.message || '建立连接失败';
    callFailed.value = true;
    connecting.value = false;
    scheduleFailClose();
  }
}

async function applyOffer(sdp) {
  try {
    if (!localStream) await getMedia();
    const conn = ensurePc();
    attachLocalTracks();
    await conn.setRemoteDescription(new RTCSessionDescription(sdp));
    remoteDescSet = true;
    await flushPendingIce();
    const answer = await conn.createAnswer();
    await conn.setLocalDescription(answer);
    socket.emit('call:answer', {
      callId: cid,
      sdp: { type: conn.localDescription.type, sdp: conn.localDescription.sdp },
    });
  } catch (e) {
    failedTip.value = e.message || '协商失败';
    callFailed.value = true;
    connecting.value = false;
    scheduleFailClose();
  }
}

async function acceptCall() {
  if (props.role !== 'callee' || acceptDone) return;
  acceptDone = true;
  stopRingtone();
  canAccept.value = false;
  try {
    await getMedia();
    ensurePc();
    attachLocalTracks();
  } catch (e) {
    failedTip.value = '无法访问摄像头/麦克风（需 HTTPS 且允许权限）';
    callFailed.value = true;
    acceptDone = false;
    canAccept.value = true;
    scheduleFailClose();
    return;
  }
  const ack = await new Promise((res) => socket.emit('call:accept', { callId: cid }, res));
  if (!ack?.ok) {
    failedTip.value = ack?.error || '接听失败';
    callFailed.value = true;
    scheduleFailClose();
    return;
  }
  if (ack.callId) cid = ack.callId;
  statusText.value = '正在接通…';
  connecting.value = true;
  if (pendingOfferSdp) {
    const sdp = pendingOfferSdp;
    pendingOfferSdp = null;
    await applyOffer(sdp);
  }
}

function rejectCall() {
  stopRingtone();
  if (cid) socket?.emit('call:reject', { callId: cid });
  endedNotified = true;
  finish({ rejected: true, skipNotify: true });
}

async function onOffer(payload) {
  if (!matchCallId(payload?.callId)) return;
  if (props.role !== 'callee') return;
  if (payload.callId) cid = payload.callId;
  if (!acceptDone) {
    pendingOfferSdp = payload.sdp;
    return;
  }
  await applyOffer(payload.sdp);
}

async function onAnswer(payload) {
  if (!matchCallId(payload?.callId)) return;
  if (props.role !== 'caller') return;
  try {
    const conn = ensurePc();
    await conn.setRemoteDescription(new RTCSessionDescription(payload.sdp));
    remoteDescSet = true;
    await flushPendingIce();
  } catch (e) {
    failedTip.value = e.message || '应答处理失败';
    callFailed.value = true;
    scheduleFailClose();
  }
}

async function onIce(payload) {
  if (!matchCallId(payload?.callId)) return;
  await addIceSafe(payload.candidate);
}

function hangup() {
  if (closed) return;
  notifyPeerEnd(connected.value ? seconds.value : 0);
  finish({ hungup: true, skipNotify: true });
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

async function switchCamera() {
  if (!isVideo() || switchingCamera || cameraOff.value || !localStream) return;
  switchingCamera = true;
  const next = cameraFacing.value === 'user' ? 'environment' : 'user';
  try {
    const ns = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: next, width: { ideal: 640 }, height: { ideal: 480 } },
    });
    const newTrack = ns.getVideoTracks()[0];
    if (!newTrack) throw new Error('no video track');
    const sender = pc?.getSenders?.().find((s) => s.track?.kind === 'video');
    if (sender) await sender.replaceTrack(newTrack);
    for (const t of localStream.getVideoTracks?.() || []) {
      try { localStream.removeTrack(t); t.stop(); } catch { /* ignore */ }
    }
    localStream.addTrack(newTrack);
    cameraFacing.value = next;
    bindLocalPreview();
  } catch (e) {
    console.warn('switch camera failed', e);
  } finally {
    switchingCamera = false;
  }
}

function toggleSpeaker() {
  speaker.value = !speaker.value;
  const muted = !speaker.value;
  if (remoteVideo.value) remoteVideo.value.muted = muted;
  if (remoteAudio.value) remoteAudio.value.muted = muted;
}

onMounted(() => {
  if (props.role === 'callee' || props.incoming) startRingtone();
  socket = getSocket();

  const kick = () => {
    if (props.role === 'caller' && !closed && !connected.value && !offerSent && !callFailed.value) {
      startAsCaller();
    }
  };
  const onAcceptedEvt = (payload) => {
    if (!matchCallId(payload?.callId)) return;
    if (payload?.callId) cid = payload.callId;
    stopRingtone();
    if (props.role === 'caller' && !closed) sendOffer();
  };
  const onRejectedEvt = (payload) => {
    if (!matchCallId(payload?.callId)) return;
    stopRingtone();
    failedTip.value = '对方已拒绝';
    callFailed.value = true;
    connecting.value = false;
    endedNotified = true;
    scheduleFailClose();
  };
  const onEndedEvt = (payload) => {
    if (!matchCallId(payload?.callId)) return;
    // 对端挂断/自己挂断的回声，统一关页
    endedNotified = true;
    stopRingtone();
    finish({ remoteEnded: true, skipNotify: true });
  };
  const onAcceptedNamed = onAcceptedEvt;

  socket.on('connect', kick);
  socket.on('call:accepted', onAcceptedNamed);
  socket.on('call:rejected', onRejectedEvt);
  socket.on('call:ended', onEndedEvt);
  socket.on('call:offer', onOffer);
  socket.on('call:answer', onAnswer);
  socket.on('call:ice', onIce);
  unbinders = [
    () => { try { socket?.off('connect', kick); } catch { /* ignore */ } },
    () => { try { socket?.off('call:accepted', onAcceptedNamed); } catch { /* ignore */ } },
    () => { try { socket?.off('call:rejected', onRejectedEvt); } catch { /* ignore */ } },
    () => { try { socket?.off('call:ended', onEndedEvt); } catch { /* ignore */ } },
    () => { try { socket?.off('call:offer', onOffer); } catch { /* ignore */ } },
    () => { try { socket?.off('call:answer', onAnswer); } catch { /* ignore */ } },
    () => { try { socket?.off('call:ice', onIce); } catch { /* ignore */ } },
  ];

  if (socket.connected) kick();
  else if (props.role === 'caller') {
    // 共享 socket 尚未连上时稍后再试
    setTimeout(kick, 300);
  }
});

onBeforeUnmount(() => {
  stopRingtone();
  stopTimer();
  clearTimeout(ringTimeout);
  clearTimeout(failCloseTimer);
  if (!closed) {
    if (!endedNotified) notifyPeerEnd(connected.value ? seconds.value : 0);
    cleanupMedia();
  }
  unbinders.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
  unbinders = [];
});
</script>

<template>
  <div class="call-page" :class="{ voice: mode === 'voice', connected }">
    <div
      class="call-bg"
      :style="{
        backgroundImage: (target.avatar || incoming?.from?.avatar)
          ? `url(${target.avatar || incoming?.from?.avatar})`
          : undefined,
      }"
    ></div>
    <div class="call-float-btn" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#fff" stroke-width="1.6">
        <rect x="4" y="7" width="10" height="8" rx="1.5"/>
        <path d="M14 10l5-2.5v9L14 14"/>
      </svg>
    </div>

    <div class="call-main">
      <template v-if="!connected || !isVideo()">
        <UserAvatar
          class="call-avatar"
          :name="target.nickname || incoming?.from?.nickname"
          :avatar="target.avatar || incoming?.from?.avatar"
          :emoji="target.emoji"
          :color="target.color || incoming?.from?.avatarColor || '#07c160'"
          :size="84"
        />
        <div class="call-name">{{ target.nickname || incoming?.from?.nickname || '好友' }}</div>
      </template>
      <div class="call-status" :class="{ fail: callFailed }">
        <template v-if="callFailed">{{ failedTip || '通话失败' }}</template>
        <template v-else-if="connected">{{ fmt(seconds) }}</template>
        <template v-else>{{ statusText }}</template>
      </div>
      <div v-if="role === 'callee' && canAccept && !callFailed && !connected" class="incoming-actions">
        <button class="inc-btn reject" type="button" @click="rejectCall">拒绝</button>
        <button class="inc-btn accept" type="button" @click="acceptCall">接听</button>
      </div>
    </div>

    <div class="video-stage" :class="{ hidden: !(connected && isVideo()) }">
      <video ref="remoteVideo" class="remote-video" autoplay playsinline :muted="!speaker"></video>
      <video ref="localVideo" class="local-video" autoplay playsinline muted></video>
      <audio ref="remoteAudio" autoplay playsinline></audio>
      <div v-if="connected && isVideo() && !hasRemoteMedia" class="remote-hint">等待对方画面…</div>
    </div>

    <div class="call-actions">
      <button class="round-btn" :class="{ light: !muted }" type="button" @click="toggleMute">
        <span class="round-ico">{{ muted ? '🔇' : '🎤' }}</span>
        <span class="btn-label">{{ muted ? '麦克风已关' : '麦克风已开' }}</span>
      </button>
      <button class="round-btn" :class="{ light: speaker }" type="button" @click="toggleSpeaker">
        <span class="round-ico">{{ speaker ? '🔊' : '🔇' }}</span>
        <span class="btn-label">{{ speaker ? '扬声器已开' : '扬声器已关' }}</span>
      </button>
      <button v-if="mode !== 'voice'" class="round-btn" :class="{ light: !cameraOff }" type="button" @click="toggleCamera">
        <span class="round-ico">{{ cameraOff ? '📵' : '📹' }}</span>
        <span class="btn-label">{{ cameraOff ? '摄像头已关' : '摄像头已开' }}</span>
      </button>
      <button v-else class="round-btn" :class="{ light: speaker }" type="button" @click="toggleSpeaker">
        <span class="round-ico">🔊</span>
        <span class="btn-label">{{ speaker ? '扬声器已开' : '扬声器已关' }}</span>
      </button>
      <button class="hangup-btn" type="button" @click="hangup" aria-label="挂断">
        <svg viewBox="0 0 24 24" width="30" height="30" fill="#fff">
          <path d="M12 9c-2.8 0-5.4.9-7.5 2.4-.5.4-.7 1-.5 1.6l.7 2.1c.2.5.7.8 1.2.7l2.5-.5c.4-.1.8 0 1 .3l1.2 1.5c.3.4.8.5 1.2.3 1.5-.7 2.8-1.7 3.8-2.9.2-.3.2-.7 0-1l-1.3-1.4c-.3-.3-.4-.7-.3-1.1l.6-2.5c.1-.5-.2-1-.7-1.2C14.4 9.3 13.2 9 12 9z"/>
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.call-page {
  position: absolute; inset: 0; z-index: 70; overflow: hidden;
  display: flex; flex-direction: column; color: #fff;
  background: #2a2420;
}
.call-bg {
  position: absolute; inset: -20px;
  background-color: #2a2420;
  background-size: cover; background-position: center;
  filter: blur(28px) brightness(0.55);
  transform: scale(1.08);
}
.call-page.connected .call-bg { opacity: 0.25; }
.call-float-btn {
  position: absolute; left: 16px; top: 18px; z-index: 5;
  width: 40px; height: 40px; border-radius: 10px;
  background: rgba(0,0,0,0.35); display: flex; align-items: center; justify-content: center;
}
.call-main {
  position: relative; z-index: 2; flex: 1;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 14px; padding: 24px 20px 0; text-align: center;
}
.call-avatar :deep(.avatar) { border-radius: 12px !important; box-shadow: 0 8px 24px rgba(0,0,0,0.25); }
.call-name { font-size: 26px; font-weight: 600; color: #fff; max-width: 80%; }
.call-status { margin-top: 8px; font-size: 16px; color: rgba(255,255,255,0.82); font-variant-numeric: tabular-nums; }
.call-status.fail { color: #ffb0b0; }
.incoming-actions { display: flex; gap: 20px; margin-top: 24px; }
.inc-btn {
  min-width: 96px; min-height: 48px; border: 0; border-radius: 24px;
  font-size: 16px; color: #fff; font-weight: 600;
}
.inc-btn.reject { background: #fa5151; }
.inc-btn.accept { background: #07c160; }

.video-stage {
  position: absolute; inset: 0; z-index: 1; background: #000;
}
.video-stage.hidden { display: none; }
.remote-video { width: 100%; height: 100%; object-fit: cover; background: #000; }
.local-video {
  position: absolute; right: 12px; top: 48px;
  width: 96px; height: 128px; object-fit: cover;
  border-radius: 8px; border: 1px solid rgba(255,255,255,0.25);
  background: #222; z-index: 3;
}
.remote-hint {
  position: absolute; left: 0; right: 0; bottom: 28%; text-align: center;
  font-size: 13px; color: rgba(255,255,255,0.75); z-index: 3;
}
audio { display: none; }

.call-actions {
  position: relative; z-index: 4;
  display: flex; align-items: flex-end; justify-content: center; gap: 28px;
  padding: 12px 20px calc(36px + var(--safe-b));
  flex-wrap: wrap;
}
.round-btn {
  width: 72px; display: flex; flex-direction: column; align-items: center; gap: 8px;
  border: 0; background: transparent; color: #fff;
}
.round-ico {
  width: 64px; height: 64px; border-radius: 50%;
  background: rgba(255,255,255,0.18);
  display: flex; align-items: center; justify-content: center; font-size: 24px;
}
.round-btn.light .round-ico { background: #fff; color: #111; }
.btn-label { font-size: 12px; color: rgba(255,255,255,0.92); white-space: nowrap; }
.hangup-btn {
  width: 72px; height: 72px; border-radius: 50%; border: 0;
  background: #e64340; display: flex; align-items: center; justify-content: center;
  box-shadow: 0 8px 20px rgba(0,0,0,0.25);
  margin-left: 8px;
}
.hangup-btn:active { transform: scale(0.96); }
</style>
