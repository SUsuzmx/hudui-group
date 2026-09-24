<script setup>
import { ref, onMounted, onBeforeUnmount, computed } from 'vue';

const props = defineProps({
  src: { type: String, required: true },
  /** avatar=1:1 | cover=约 3:1 | post=近方图 | free=自由 */
  ratio: { type: String, default: 'avatar' },
  maxEdge: { type: Number, default: 1600 },
  title: { type: String, default: '裁剪图片' },
});
const emit = defineEmits(['confirm', 'cancel']);

const stageEl = ref(null);
const canvasEl = ref(null);
const viewW = ref(320);
const viewH = ref(420);

const img = ref(null);
const scale = ref(1);
const minScale = ref(1);
const offsetX = ref(0);
const offsetY = ref(0);
const cropW = ref(200);
const cropH = ref(200);
const pad = ref(12);
const drag = ref(null);

const maskStyle = computed(() => ({
  left: `${pad.value}px`,
  top: `${pad.value}px`,
  width: `${cropW.value}px`,
  height: `${cropH.value}px`,
}));

function loadImg(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片加载失败'));
    image.src = src;
  });
}

function clampOffset() {
  if (!img.value) return;
  const p = pad.value;
  const imgW = img.value.naturalWidth * scale.value;
  const imgH = img.value.naturalHeight * scale.value;
  offsetX.value = Math.min(p, Math.max(p + cropW.value - imgW, offsetX.value));
  offsetY.value = Math.min(p, Math.max(p + cropH.value - imgH, offsetY.value));
}

function layoutCrop() {
  const stage = stageEl.value;
  if (!stage || !img.value) return;
  const rect = stage.getBoundingClientRect();
  // 全屏大舞台：宽度尽量铺满，高度取视口主体
  viewW.value = Math.max(280, Math.floor(rect.width || window.innerWidth));
  viewH.value = Math.max(320, Math.floor(rect.height || window.innerHeight * 0.62));
  const p = 12;
  pad.value = p;
  const availW = viewW.value - p * 2;
  const availH = viewH.value - p * 2;
  let ch;
  if (props.ratio === 'avatar') {
    // 头像：尽量大的正方形
    ch = Math.min(availW, availH);
  } else if (props.ratio === 'cover') {
    // 朋友圈封面：更宽更高，约 2.2:1（微信封面偏宽）
    ch = Math.min(Math.round(availW / 2.2), Math.round(availH * 0.72));
    ch = Math.max(140, ch);
  } else if (props.ratio === 'post') {
    // 配图：接近正方，略矮
    ch = Math.min(availW, Math.round(availH * 0.9));
  } else {
    ch = Math.min(availW, Math.round(availH * 0.85));
  }
  const cw = props.ratio === 'cover'
    ? Math.min(availW, ch * 2.2)
    : ch;
  cropW.value = Math.round(cw);
  cropH.value = Math.round(ch);

  const iw = img.value.naturalWidth;
  const ih = img.value.naturalHeight;
  const cover = Math.max(cropW.value / iw, cropH.value / ih);
  minScale.value = cover;
  scale.value = cover;
  offsetX.value = p + (cropW.value - iw * scale.value) / 2;
  offsetY.value = p + (cropH.value - ih * scale.value) / 2;
  clampOffset();
  draw();
}

function draw() {
  const cv = canvasEl.value;
  if (!cv || !img.value) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.floor(viewW.value * dpr);
  cv.height = Math.floor(viewH.value * dpr);
  cv.style.width = `${viewW.value}px`;
  cv.style.height = `${viewH.value}px`;
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, viewW.value, viewH.value);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, viewW.value, viewH.value);
  const iw = img.value.naturalWidth * scale.value;
  const ih = img.value.naturalHeight * scale.value;
  ctx.save();
  ctx.beginPath();
  ctx.rect(pad.value, pad.value, cropW.value, cropH.value);
  ctx.clip();
  ctx.drawImage(img.value, offsetX.value, offsetY.value, iw, ih);
  ctx.restore();
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.beginPath();
  ctx.rect(0, 0, viewW.value, viewH.value);
  ctx.rect(pad.value, pad.value, cropW.value, cropH.value);
  ctx.fill('evenodd');
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(pad.value + 0.5, pad.value + 0.5, cropW.value - 1, cropH.value - 1);
  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.lineWidth = 0.5;
  for (let i = 1; i < 3; i++) {
    const x = pad.value + (cropW.value * i) / 3;
    const y = pad.value + (cropH.value * i) / 3;
    ctx.beginPath(); ctx.moveTo(x, pad.value); ctx.lineTo(x, pad.value + cropH.value); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(pad.value, y); ctx.lineTo(pad.value + cropW.value, y); ctx.stroke();
  }
}

function onPointerDown(e) {
  const p = e.touches?.[0] || e;
  drag.value = { x: p.clientX, y: p.clientY, ox: offsetX.value, oy: offsetY.value };
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
}

function onPointerMove(e) {
  if (!drag.value) return;
  const p = e.touches?.[0] || e;
  offsetX.value = drag.value.ox + (p.clientX - drag.value.x);
  offsetY.value = drag.value.oy + (p.clientY - drag.value.y);
  clampOffset();
  draw();
}

function onPointerUp() {
  drag.value = null;
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
}

function zoomAround(next) {
  const cx = pad.value + cropW.value / 2;
  const cy = pad.value + cropH.value / 2;
  const ix = (cx - offsetX.value) / scale.value;
  const iy = (cy - offsetY.value) / scale.value;
  scale.value = Math.min(minScale.value * 5, Math.max(minScale.value, next));
  offsetX.value = cx - ix * scale.value;
  offsetY.value = cy - iy * scale.value;
  clampOffset();
  draw();
}

function onWheel(e) {
  e.preventDefault();
  zoomAround(scale.value * (e.deltaY > 0 ? 0.92 : 1.08));
}

function setZoom(v) {
  zoomAround(v);
}

function confirm() {
  if (!img.value) return;
  // 输出尺寸按场景收敛，避免超大 dataURL 拖慢上传
  const outW = props.ratio === 'avatar' ? 400 : props.ratio === 'cover' ? 1280 : 1080;
  const outH = props.ratio === 'avatar'
    ? 400
    : Math.max(1, Math.round((outW * cropH.value) / cropW.value));
  const cv = document.createElement('canvas');
  cv.width = outW;
  cv.height = outH;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  const sx = (pad.value - offsetX.value) / scale.value;
  const sy = (pad.value - offsetY.value) / scale.value;
  const sw = cropW.value / scale.value;
  const sh = cropH.value / scale.value;
  ctx.drawImage(img.value, sx, sy, sw, sh, 0, 0, outW, outH);
  const finish = (out) => emit('confirm', out);
  if (cv.toBlob) {
    cv.toBlob((blob) => {
      if (!blob) {
        finish(cv.toDataURL('image/jpeg', 0.85));
        return;
      }
      // 同时给 dataURL 兜底字段，组件方可任选
      finish({ blob, dataUrl: cv.toDataURL('image/jpeg', 0.85), width: outW, height: outH });
    }, 'image/jpeg', 0.85);
  } else {
    finish(cv.toDataURL('image/jpeg', 0.85));
  }
}

onMounted(async () => {
  try {
    img.value = await loadImg(props.src);
    layoutCrop();
    window.addEventListener('resize', layoutCrop);
  } catch {
    emit('cancel');
  }
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', layoutCrop);
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
});
</script>

<template>
  <div class="crop-mask">
    <div class="crop-bar">
      <button type="button" class="crop-btn" @click="emit('cancel')">取消</button>
      <div class="crop-title">{{ title }}</div>
      <button type="button" class="crop-btn ok" @click="confirm">确定</button>
    </div>
    <div
      ref="stageEl"
      class="crop-stage"
      @pointerdown="onPointerDown"
      @wheel.prevent="onWheel"
    >
      <canvas ref="canvasEl" class="crop-canvas"></canvas>
      <div class="crop-frame" :style="maskStyle"></div>
    </div>
    <div class="crop-tools">
      <span>缩放</span>
      <input
        class="crop-zoom"
        type="range"
        :min="minScale"
        :max="minScale * 5"
        :step="0.01"
        :value="scale"
        @input="setZoom(Number($event.target.value))"
      />
      <button type="button" class="crop-reset" @click="layoutCrop">重置</button>
    </div>
    <div class="crop-hint">拖动调整位置，滚轮或滑杆缩放</div>
  </div>
</template>

<style scoped>
.crop-mask {
  position: fixed; inset: 0; z-index: 9000;
  background: #000;
  display: flex; flex-direction: column;
  color: #fff;
}
.crop-bar {
  flex: 0 0 auto;
  display: flex; align-items: center; justify-content: space-between;
  padding: calc(env(safe-area-inset-top, 0px) + 10px) 12px 10px;
}
.crop-title { font-size: 16px; font-weight: 600; }
.crop-btn {
  border: 0; background: transparent; color: #c9d1d9;
  font-size: 16px; padding: 8px 10px; cursor: pointer; min-height: 40px;
  min-width: 56px;
}
.crop-btn.ok { color: #07c160; font-weight: 600; }
.crop-stage {
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
  position: relative;
  touch-action: none; user-select: none;
  background: #000;
  overflow: hidden;
  cursor: grab;
  display: flex; align-items: center; justify-content: center;
}
.crop-stage:active { cursor: grabbing; }
.crop-canvas {
  display: block;
  position: absolute; inset: 0; margin: auto;
  max-width: 100%; max-height: 100%;
}
.crop-frame {
  position: absolute; pointer-events: none;
}
.crop-tools {
  flex: 0 0 auto;
  display: flex; align-items: center; gap: 12px;
  padding: 14px 18px 6px;
  font-size: 14px; color: #c9d1d9;
}
.crop-zoom { flex: 1; height: 28px; }
.crop-reset {
  border: 0; background: rgba(255,255,255,0.12); color: #fff;
  border-radius: 8px; padding: 8px 14px; font-size: 13px; cursor: pointer;
  min-height: 36px;
}
.crop-hint {
  padding: 4px 18px calc(env(safe-area-inset-bottom, 0px) + 16px);
  font-size: 12px; color: #8b949e;
  text-align: center;
}
</style>
