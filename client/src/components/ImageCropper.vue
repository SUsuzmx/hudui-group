<script setup>
import { ref, onMounted, onBeforeUnmount, computed } from 'vue';

const props = defineProps({
  src: { type: String, required: true },
  /** avatar=1:1 | cover=约 3:1 自由 | free=自由比例 */
  ratio: { type: String, default: 'avatar' }, // avatar | cover | free
  maxEdge: { type: Number, default: 1280 },
  title: { type: String, default: '裁剪图片' },
});
const emit = defineEmits(['confirm', 'cancel']);

const stageEl = ref(null);
const canvasEl = ref(null);
const viewW = ref(320);
const viewH = ref(320);

const img = ref(null);
const scale = ref(1);
const minScale = ref(1);
const offsetX = ref(0);
const offsetY = ref(0);
const cropW = ref(200);
const cropH = ref(200);
const drag = ref(null);

const maskStyle = computed(() => {
  const pad = 16;
  return {
    left: `${pad}px`,
    top: `${pad}px`,
    width: `${cropW.value}px`,
    height: `${cropH.value}px`,
  };
});

function loadImg(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片加载失败'));
    image.src = src;
  });
}

function clampOffset() {
  const imgW = img.value.naturalWidth * scale.value;
  const imgH = img.value.naturalHeight * scale.value;
  const pad = 16;
  const minX = pad + cropW.value - imgW;
  const maxX = pad;
  const minY = pad + cropH.value - imgH;
  const maxY = pad;
  offsetX.value = Math.min(maxX, Math.max(minX, offsetX.value));
  offsetY.value = Math.min(maxY, Math.max(minY, offsetY.value));
}

function layoutCrop() {
  const stage = stageEl.value;
  if (!stage || !img.value) return;
  const rect = stage.getBoundingClientRect();
  viewW.value = Math.max(200, Math.floor(rect.width));
  // stage height: square for avatar, taller for cover
  const pad = 16;
  const availW = viewW.value - pad * 2;
  let ch;
  if (props.ratio === 'avatar') ch = availW;
  else if (props.ratio === 'cover') ch = Math.round(availW / 3);
  else ch = Math.round(availW * 0.75);
  cropW.value = availW;
  cropH.value = Math.max(80, ch);
  viewH.value = cropH.value + pad * 2;

  const iw = img.value.naturalWidth;
  const ih = img.value.naturalHeight;
  // cover crop area
  const sx = cropW.value / iw;
  const sy = cropH.value / ih;
  const cover = Math.max(sx, sy);
  minScale.value = cover;
  scale.value = cover;
  offsetX.value = pad + (cropW.value - iw * scale.value) / 2;
  offsetY.value = pad + (cropH.value - ih * scale.value) / 2;
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
  // 遮罩底
  ctx.fillStyle = '#0d1117';
  ctx.fillRect(0, 0, viewW.value, viewH.value);
  const iw = img.value.naturalWidth * scale.value;
  const ih = img.value.naturalHeight * scale.value;
  ctx.save();
  ctx.beginPath();
  ctx.rect(16, 16, cropW.value, cropH.value);
  ctx.clip();
  ctx.drawImage(img.value, offsetX.value, offsetY.value, iw, ih);
  ctx.restore();
  // 暗角
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath();
  ctx.rect(0, 0, viewW.value, viewH.value);
  ctx.rect(16, 16, cropW.value, cropH.value);
  ctx.fill('evenodd');
  // 边框
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(16.5, 16.5, cropW.value - 1, cropH.value - 1);
  // 网格
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 0.5;
  for (let i = 1; i < 3; i++) {
    const x = 16 + (cropW.value * i) / 3;
    const y = 16 + (cropH.value * i) / 3;
    ctx.beginPath(); ctx.moveTo(x, 16); ctx.lineTo(x, 16 + cropH.value); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(16, y); ctx.lineTo(16 + cropW.value, y); ctx.stroke();
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

function onWheel(e) {
  e.preventDefault();
  const delta = e.deltaY > 0 ? 0.92 : 1.08;
  const next = Math.min(minScale.value * 4, Math.max(minScale.value, scale.value * delta));
  // 以裁剪框中心缩放
  const pad = 16;
  const cx = pad + cropW.value / 2;
  const cy = pad + cropH.value / 2;
  const ix = (cx - offsetX.value) / scale.value;
  const iy = (cy - offsetY.value) / scale.value;
  scale.value = next;
  offsetX.value = cx - ix * scale.value;
  offsetY.value = cy - iy * scale.value;
  clampOffset();
  draw();
}

function setZoom(v) {
  const pad = 16;
  const cx = pad + cropW.value / 2;
  const cy = pad + cropH.value / 2;
  const ix = (cx - offsetX.value) / scale.value;
  const iy = (cy - offsetY.value) / scale.value;
  scale.value = Math.min(minScale.value * 4, Math.max(minScale.value, v));
  offsetX.value = cx - ix * scale.value;
  offsetY.value = cy - iy * scale.value;
  clampOffset();
  draw();
}

function confirm() {
  if (!img.value) return;
  const outW = props.ratio === 'avatar' ? 512 : props.maxEdge;
  const outH = props.ratio === 'avatar'
    ? 512
    : Math.max(1, Math.round((outW * cropH.value) / cropW.value));
  const cv = document.createElement('canvas');
  cv.width = outW;
  cv.height = outH;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  // 裁剪框对应原图区域
  const pad = 16;
  const sx = (pad - offsetX.value) / scale.value;
  const sy = (pad - offsetY.value) / scale.value;
  const sw = cropW.value / scale.value;
  const sh = cropH.value / scale.value;
  ctx.drawImage(img.value, sx, sy, sw, sh, 0, 0, outW, outH);
  const dataUrl = cv.toDataURL('image/jpeg', 0.88);
  emit('confirm', dataUrl);
}

onMounted(async () => {
  try {
    img.value = await loadImg(props.src);
    layoutCrop();
    window.addEventListener('resize', layoutCrop);
  } catch (e) {
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
    <div class="crop-panel">
      <div class="crop-bar">
        <button type="button" class="crop-btn" @click="emit('cancel')">取消</button>
        <div class="crop-title">{{ title }}</div>
        <button type="button" class="crop-btn ok" @click="confirm">确定</button>
      </div>
      <div
        ref="stageEl"
        class="crop-stage"
        :style="{ width: viewW + 'px', height: viewH + 'px' }"
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
          :max="minScale * 4"
          :step="0.01"
          :value="scale"
          @input="setZoom(Number($event.target.value))"
        />
        <button type="button" class="crop-reset" @click="layoutCrop">重置</button>
      </div>
      <div class="crop-hint">拖动调整位置，滚轮或滑杆缩放</div>
    </div>
  </div>
</template>

<style scoped>
.crop-mask {
  position: fixed; inset: 0; z-index: 9000;
  background: rgba(0,0,0,0.72);
  display: flex; align-items: center; justify-content: center;
  padding: 12px;
}
.crop-panel {
  width: min(420px, 100%);
  background: #1c1c1e;
  border-radius: 14px;
  overflow: hidden;
  color: #fff;
}
.crop-bar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 0.5px solid rgba(255,255,255,0.08);
}
.crop-title { font-size: 15px; font-weight: 600; }
.crop-btn {
  border: 0; background: transparent; color: #c9d1d9;
  font-size: 15px; padding: 6px 8px; cursor: pointer; min-height: 36px;
}
.crop-btn.ok { color: #07c160; font-weight: 600; }
.crop-stage {
  position: relative; margin: 0 auto;
  touch-action: none; user-select: none;
  background: #0d1117;
  overflow: hidden;
  cursor: grab;
}
.crop-stage:active { cursor: grabbing; }
.crop-canvas { display: block; width: 100%; height: 100%; }
.crop-frame {
  position: absolute; pointer-events: none;
  box-shadow: 0 0 0 9999px transparent;
}
.crop-tools {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 14px 6px;
  font-size: 13px; color: #c9d1d9;
}
.crop-zoom { flex: 1; }
.crop-reset {
  border: 0; background: rgba(255,255,255,0.08); color: #fff;
  border-radius: 8px; padding: 6px 10px; font-size: 12px; cursor: pointer;
  min-height: 32px;
}
.crop-hint {
  padding: 0 14px 14px;
  font-size: 12px; color: #8b949e;
  text-align: center;
}
</style>
