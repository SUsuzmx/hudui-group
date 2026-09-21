<script setup>
import { ref, computed, onMounted } from 'vue';
import { EMOJI_LIST, EMOJI_PACKS, loadRecentEmojis, pushRecentEmoji } from '../chat-shared.js';
import { loadStickers, addSticker, removeSticker, stickerFromFileMeta } from '../stickers.js';
import { api, compressImage } from '../api.js';
import { toast } from '../toast.js';

const emit = defineEmits(['insert-emoji', 'send-sticker', 'delete']);

const tab = ref('emoji'); // search | emoji | fav | pack
const packKey = ref('face');
const searchQ = ref('');
const stickers = ref([]);
const uploading = ref(false);
const fileInput = ref(null);
const packs = EMOJI_PACKS;

const emojiSource = computed(() => {
  if (tab.value === 'search') {
    const q = searchQ.value.trim();
    if (!q) return EMOJI_LIST;
    return EMOJI_LIST.filter((e) => e.includes(q));
  }
  if (tab.value === 'pack') {
    const hit = packs.find((p) => p.key === packKey.value);
    return hit?.icons || EMOJI_LIST;
  }
  return EMOJI_LIST;
});

const favList = computed(() => {
  const q = tab.value === 'search' ? searchQ.value.trim().toLowerCase() : '';
  if (!q) return stickers.value;
  return stickers.value.filter((s) => (s.name || '').toLowerCase().includes(q));
});

function refresh() {
  stickers.value = loadStickers();
}

function onEmoji(e) {
  pushRecentEmoji(e);
  emit('insert-emoji', e);
}

function onSticker(s) {
  if (!s) return;
  if (s.kind === 'emoji') {
    onEmoji(s.url);
    return;
  }
  emit('send-sticker', s);
}

function removeItem(s) {
  if (!s?.id) return;
  stickers.value = removeSticker(s.id);
  toast('已移除表情');
}

function pickUpload() {
  fileInput.value?.click();
}

async function onUploadFile(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  const okType = /^image\//.test(file.type) || /\.(png|jpe?g|gif|webp)$/i.test(file.name || '');
  if (!okType) {
    toast('请选择图片或 GIF');
    return;
  }
  if (file.size > 4 * 1024 * 1024) {
    toast('文件过大，请小于 4MB');
    return;
  }
  uploading.value = true;
  try {
    let url = null;
    const isGif = file.type === 'image/gif' || /\.gif$/i.test(file.name || '');
    if (isGif) {
      const { url: u } = await api.uploadChatMedia(file, 'image');
      url = u;
    } else {
      const data = await compressImage(file, 480, 0.85);
      const { url: u } = await api.uploadChatMedia(data, 'image');
      url = u || data;
    }
    if (!url) throw new Error('上传失败');
    stickers.value = addSticker(stickerFromFileMeta(file, url));
    tab.value = 'fav';
    toast('表情已添加');
  } catch (err) {
    try {
      if (file.size < 800 * 1024) {
        const data = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result);
          r.onerror = reject;
          r.readAsDataURL(file);
        });
        stickers.value = addSticker(stickerFromFileMeta(file, data));
        tab.value = 'fav';
        toast('已添加到本地表情');
        return;
      }
    } catch { /* ignore */ }
    toast(err.message || '上传失败');
  } finally {
    uploading.value = false;
  }
}

onMounted(refresh);
defineExpose({ refresh });
</script>

<template>
  <div class="emoji-picker">
    <div class="picker-tabs">
      <button class="picker-tab" type="button" :class="{ on: tab === 'search' }" aria-label="搜索" @click="tab = 'search'">
        <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8">
          <circle cx="11" cy="11" r="6.5"/>
          <path d="M16 16l4 4" stroke-linecap="round"/>
        </svg>
      </button>
      <button class="picker-tab" type="button" :class="{ on: tab === 'emoji' }" aria-label="表情" @click="tab = 'emoji'">
        <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8">
          <circle cx="12" cy="12" r="9"/>
          <circle cx="9" cy="10.5" r="1" fill="currentColor" stroke="none"/>
          <circle cx="15" cy="10.5" r="1" fill="currentColor" stroke="none"/>
          <path d="M8.2 14c1.2 1.7 2.5 2.4 3.8 2.4s2.6-.7 3.8-2.4" stroke-linecap="round"/>
        </svg>
      </button>
      <button class="picker-tab" type="button" :class="{ on: tab === 'fav' }" aria-label="收藏" @click="tab = 'fav'">
        <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8">
          <path d="M12 20s-7-4.35-7-9.2C5 7.5 7.2 5.5 9.6 5.5c1.3 0 2.4.6 3 1.5.6-.9 1.7-1.5 3-1.5 2.4 0 4.4 2 4.4 5.3 0 4.85-7 9.2-7 9.2z" stroke-linejoin="round"/>
        </svg>
      </button>
      <button class="picker-tab" type="button" :class="{ on: tab === 'pack' }" aria-label="表情包" @click="tab = 'pack'">
        <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.7">
          <path d="M8 11c0-2 1.2-3.5 3-4 .5 1.8.2 3.2-1 4.2" stroke-linecap="round"/>
          <path d="M7 13.5c1.8 2.4 4.2 3.5 7 3.5" stroke-linecap="round"/>
          <path d="M14.5 8.2l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6.6-1.4z" fill="currentColor" stroke="none"/>
        </svg>
      </button>
    </div>

    <div v-if="tab === 'search'" class="search-bar">
      <input v-model="searchQ" type="search" placeholder="搜索表情 / 表情包" />
    </div>

    <div v-if="tab === 'pack'" class="pack-bar">
      <button
        v-for="p in packs"
        :key="p.key"
        type="button"
        class="pack-chip"
        :class="{ on: packKey === p.key }"
        @click="packKey = p.key"
      >{{ p.key === 'face' ? '😀' : p.key === 'gesture' ? '✌️' : '❤️' }} {{ p.name }}</button>
    </div>

    <div class="picker-body">
      <div v-if="tab === 'emoji' || tab === 'pack' || (tab === 'search' && !favList.length)" class="emoji-grid">
        <button
          v-for="(e, i) in emojiSource"
          :key="tab + i + e"
          class="emoji-item"
          type="button"
          @click="onEmoji(e)"
        >{{ e }}</button>
        <div v-if="tab === 'search' && !emojiSource.length" class="empty">无匹配表情</div>
      </div>

      <div v-else>
        <div class="fav-title">添加的单个表情</div>
        <div class="sticker-grid">
          <button class="sticker-add" type="button" :disabled="uploading" @click="pickUpload">
            <span v-if="uploading">…</span>
            <span v-else class="add-plus">+</span>
          </button>
          <button
            v-for="s in favList"
            :key="s.id"
            class="sticker-item"
            type="button"
            :title="s.name || '表情'"
            @click="onSticker(s)"
            @contextmenu.prevent="removeItem(s)"
          >
            <img v-if="s.kind !== 'emoji'" :src="s.url" :alt="s.name || 'sticker'" loading="lazy" />
            <span v-else class="sticker-emoji">{{ s.url }}</span>
          </button>
        </div>
        <div v-if="!favList.length" class="empty">点 + 上传图片或 GIF 表情</div>
        <div class="fav-hint">右键可删除；支持 png / jpg / gif</div>
      </div>
    </div>

    <div class="picker-footer">
      <button class="del-btn" type="button" aria-label="删除" @click="emit('delete')">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6">
          <path d="M9 6h10a2 2 0 012 2v8a2 2 0 01-2 2H9l-6-6 6-6z"/>
          <path d="M13 10l4 4M17 10l-4 4" stroke-linecap="round"/>
        </svg>
      </button>
    </div>

    <input ref="fileInput" type="file" accept="image/*,.gif" hidden @change="onUploadFile" />
  </div>
</template>

<style scoped>
.emoji-picker {
  height: 260px;
  display: flex;
  flex-direction: column;
  background: #f7f7f7;
  border-top: 0.5px solid var(--divider);
}
.picker-tabs {
  flex-shrink: 0;
  height: 52px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 12px;
  border-bottom: 0.5px solid var(--divider);
}
.picker-tab {
  width: 52px;
  height: 42px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: #191919;
  display: flex;
  align-items: center;
  justify-content: center;
}
.picker-tab.on { background: #fff; }
.search-bar, .pack-bar { flex-shrink: 0; padding: 8px 12px; display: flex; gap: 8px; }
.search-bar input {
  flex: 1; min-height: 34px; border: 0; border-radius: 8px; background: #fff;
  padding: 0 12px; font-size: 14px; color: var(--text); outline: none;
}
.pack-chip {
  min-height: 30px; padding: 0 10px; border-radius: 15px;
  border: 1px solid var(--divider); background: #fff; color: var(--text-2); font-size: 12px;
}
.pack-chip.on { border-color: #07c160; color: #07c160; background: rgba(7,193,96,0.08); }
.picker-body {
  flex: 1; min-height: 0; overflow-y: auto; padding: 4px 6px 8px; background: #ededed;
}
.emoji-grid {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 2px 0;
  padding: 4px;
  align-content: start;
}
.emoji-item {
  height: 40px; border: 0; background: transparent; font-size: 24px;
  display: flex; align-items: center; justify-content: center; border-radius: 6px;
}
.emoji-item:active { background: rgba(0,0,0,0.05); }
.fav-title { padding: 8px 8px 6px; font-size: 18px; font-weight: 500; color: #333; }
.sticker-grid {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; padding: 4px 6px 8px;
}
.sticker-add {
  aspect-ratio: 1; border: 1.5px dashed #999; border-radius: 4px; background: transparent;
  color: #333; display: flex; align-items: center; justify-content: center; min-height: 68px;
}
.add-plus { font-size: 34px; font-weight: 300; line-height: 1; }
.sticker-item {
  aspect-ratio: 1; border: 0; padding: 0; border-radius: 4px; overflow: hidden;
  background: #ddd; min-height: 68px;
}
.sticker-item img { width: 100%; height: 100%; object-fit: cover; display: block; }
.sticker-emoji {
  width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;
  font-size: 26px; background: #fff;
}
.empty { padding: 24px 12px; text-align: center; color: var(--text-3); font-size: 13px; }
.fav-hint { padding: 0 10px 10px; font-size: 11px; color: var(--text-3); }
.picker-footer {
  flex-shrink: 0; height: 40px; display: flex; justify-content: flex-end; align-items: center;
  padding: 0 10px; border-top: 0.5px solid var(--divider);
}
.del-btn {
  width: 40px; height: 34px; border: 0; border-radius: 8px; background: #fff; color: #333;
  display: flex; align-items: center; justify-content: center;
}
</style>
