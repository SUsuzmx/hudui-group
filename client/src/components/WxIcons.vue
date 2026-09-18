<script setup>
defineProps({
  name: { type: String, required: true },
  size: { type: Number, default: 24 },
});
</script>

<template>
  <!-- Tab / cell 图标: 线框微信风格 -->
  <svg
    v-if="name === 'tab-chats'"
    class="wx-icon"
    :width="size" :height="size" viewBox="0 0 24 24" fill="none"
  >
    <path d="M12 3.2C7.2 3.2 3.4 6.4 3.4 10.3c0 2.2 1.2 4.2 3.1 5.5l-.7 2.8c-.1.4.3.7.6.5l3.2-1.7c.7.2 1.5.3 2.4.3 4.8 0 8.6-3.2 8.6-7.4S16.8 3.2 12 3.2z" stroke="currentColor" stroke-width="1.5" fill="none"/>
  </svg>
  <svg v-else-if="name === 'tab-chats-on'" class="wx-icon" :width="size" :height="size" viewBox="0 0 24 24">
    <path d="M12 3.2C7.2 3.2 3.4 6.4 3.4 10.3c0 2.2 1.2 4.2 3.1 5.5l-.7 2.8c-.1.4.3.7.6.5l3.2-1.7c.7.2 1.5.3 2.4.3 4.8 0 8.6-3.2 8.6-7.4S16.8 3.2 12 3.2z" fill="currentColor"/>
  </svg>
  <svg v-else-if="name === 'tab-contacts'" class="wx-icon" :width="size" :height="size" viewBox="0 0 24 24" fill="none">
    <circle cx="9" cy="8" r="3.2" stroke="currentColor" stroke-width="1.5"/>
    <path d="M3.8 19c.4-3 2.6-4.8 5.2-4.8S13.8 16 14.2 19" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    <path d="M16 8h5M16 12h5M16 16h3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  </svg>
  <svg v-else-if="name === 'tab-contacts-on'" class="wx-icon" :width="size" :height="size" viewBox="0 0 24 24">
    <circle cx="9" cy="8" r="3.4" fill="currentColor"/>
    <path d="M3.6 19.2c.4-3.2 2.8-5 5.4-5s5 1.8 5.4 5" fill="currentColor"/>
    <path d="M16 7.2h4.5v1.6H16zM16 11.2h4.5v1.6H16zM16 15.2h3.2v1.6H16z" fill="currentColor"/>
  </svg>
  <svg v-else-if="name === 'tab-discover'" class="wx-icon" :width="size" :height="size" viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="8.2" stroke="currentColor" stroke-width="1.5"/>
    <path d="M12 7.2l1.4 3.4 3.4 1.4-3.4 1.4L12 16.8l-1.4-3.4L7.2 12l3.4-1.4L12 7.2z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
  </svg>
  <svg v-else-if="name === 'tab-discover-on'" class="wx-icon" :width="size" :height="size" viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="8.4" fill="currentColor"/>
    <path d="M12 7.4l1.3 3.2 3.3 1.4-3.3 1.4L12 16.6l-1.3-3.2-3.3-1.4 3.3-1.4L12 7.4z" fill="#fff" opacity=".95"/>
  </svg>
  <svg v-else-if="name === 'tab-me'" class="wx-icon" :width="size" :height="size" viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="8.2" r="3.3" stroke="currentColor" stroke-width="1.5"/>
    <path d="M5.5 19.2c.5-3.3 3.2-5.2 6.5-5.2s6 1.9 6.5 5.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  </svg>
  <svg v-else-if="name === 'tab-me-on'" class="wx-icon" :width="size" :height="size" viewBox="0 0 24 24">
    <circle cx="12" cy="8.2" r="3.5" fill="currentColor"/>
    <path d="M5.3 19.4c.5-3.4 3.3-5.4 6.7-5.4s6.2 2 6.7 5.4z" fill="currentColor"/>
  </svg>

  <svg v-else-if="name === 'search'" class="wx-icon" :width="size" :height="size" viewBox="0 0 24 24" fill="none">
    <circle cx="11" cy="11" r="6.2" stroke="currentColor" stroke-width="1.6"/>
    <path d="M15.8 15.8L20 20" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
  </svg>
  <svg v-else-if="name === 'plus'" class="wx-icon" :width="size" :height="size" viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.5"/>
    <path d="M12 7.5v9M7.5 12h9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  </svg>
  <svg v-else-if="name === 'chevron'" class="wx-icon" :width="size" :height="size" viewBox="0 0 24 24" fill="none">
    <path d="M9 5l7 7-7 7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
  <svg v-else-if="name === 'back'" class="wx-icon" :width="size" :height="size" viewBox="0 0 24 24" fill="none">
    <path d="M15 4.5L7.5 12 15 19.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
  <svg v-else-if="name === 'qr'" class="wx-icon" :width="size" :height="size" viewBox="0 0 24 24" fill="none">
    <rect x="4" y="4" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.3"/>
    <rect x="14" y="4" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.3"/>
    <rect x="4" y="14" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.3"/>
    <path d="M14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z" fill="currentColor"/>
  </svg>
  <svg v-else-if="name === 'mute'" class="wx-icon" :width="size" :height="size" viewBox="0 0 24 24" fill="none">
    <path d="M12 4a4 4 0 014 4v3.5l1.5 2.5H6.5L8 11.5V8a4 4 0 014-4z" stroke="currentColor" stroke-width="1.4"/>
    <path d="M10 18a2 2 0 004 0" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
    <path d="M4 4l16 16" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
  </svg>
  <svg v-else-if="name === 'folder'" class="wx-icon" :width="size" :height="size" viewBox="0 0 24 24" fill="none">
    <path d="M4 8.5h16v9a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 17.5v-9z" stroke="currentColor" stroke-width="1.4"/>
    <path d="M4 8.5l2-3.5h12l2 3.5" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
  </svg>

  <!-- 通讯录功能入口 -->
  <span v-else-if="name === 'new-friend'" class="cell-svg bg-orange">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff"><circle cx="10" cy="9" r="3.2"/><path d="M4.5 18c.4-2.8 2.6-4.4 5.5-4.4 1.2 0 2.3.3 3.2.9L18 10.5v3l-3.2 2.1c.2.3.3.6.3 1 0 0 .2.4.2.4H7.2c.2-2.8 1.4-4.5 3.3-4.5"/><path d="M17 7h2.2v2H17v2.2h-2V9H12.8V7H15V5h2v2z" fill="#fff"/></svg>
  </span>
  <span v-else-if="name === 'chat-only'" class="cell-svg bg-orange">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff"><circle cx="12" cy="9" r="3"/><path d="M5.5 19c.5-3 3-4.8 6.5-4.8s6 1.8 6.5 4.8z"/></svg>
  </span>
  <span v-else-if="name === 'group'" class="cell-svg bg-green">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff"><circle cx="9" cy="9" r="2.6"/><circle cx="15.5" cy="9.5" r="2.2"/><path d="M3.8 18.5c.4-2.6 2.5-4.2 5.2-4.2s4.8 1.6 5.2 4.2H3.8zM13.5 14.8c2.2.2 4 1.6 4.4 3.7h-3.2c-.2-1.4-.7-2.6-1.2-3.7z"/></svg>
  </span>
  <span v-else-if="name === 'tag'" class="cell-svg bg-blue">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff"><path d="M12.2 3.5H5.5A2 2 0 003.5 5.5v6.7l8.7 8.7a1.5 1.5 0 002.2 0l6.2-6.2a1.5 1.5 0 000-2.2L12.2 3.5z"/><circle cx="8.2" cy="8.2" r="1.3" fill="#576B95"/></svg>
  </span>
  <span v-else-if="name === 'oa'" class="cell-svg bg-blue">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff"><path d="M5 5.5h10.5c.8 0 1.5.7 1.5 1.5v10c0 .8-.7 1.5-1.5 1.5H5V5.5z" opacity=".95"/><path d="M9 9h6M9 12h6M9 15h4" stroke="#576B95" stroke-width="1.2" stroke-linecap="round"/></svg>
  </span>
  <span v-else-if="name === 'service-oa'" class="cell-svg bg-blue-light">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff"><path d="M8 6.5l4 3.5-4 3.5V6.5zM16 6.5l-4 3.5 4 3.5V6.5z"/></svg>
  </span>
  <span v-else-if="name === 'work-wechat'" class="cell-svg bg-blue">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M5 8.5c0-2.2 2.5-4 5.5-4s5.5 1.8 5.5 4-2.5 4-5.5 4c-.4 0-.8 0-1.2-.1L7 14l.3-2C5.8 11.3 5 10 5 8.5z" fill="#fff"/><circle cx="17" cy="15" r="3.5" fill="#fff" opacity=".9"/><path d="M15.8 15h2.4M17 13.8v2.4" stroke="#576B95" stroke-width="1.2"/></svg>
  </span>

  <!-- 发现页 -->
  <span v-else-if="name === 'moments'" class="cell-svg no-bg">
    <svg width="24" height="24" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9" fill="none" stroke="#07C160" stroke-width="1.4"/>
      <circle cx="12" cy="12" r="3.2" fill="#F7B500"/>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4" stroke="#576B95" stroke-width="1.3"/>
      <path d="M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" stroke="#FA5151" stroke-width="1.2"/>
    </svg>
  </span>
  <span v-else-if="name === 'channels'" class="cell-svg no-bg">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="#F7B500">
      <path d="M8.5 6c2.5 0 4.5 2.5 4.5 5.5S11 17 8.5 17 4 14.5 4 11.5 6 6 8.5 6z"/>
      <path d="M15.5 6c2.5 0 4.5 2.5 4.5 5.5S18 17 15.5 17 11 14.5 11 11.5 13 6 15.5 6z" opacity=".85"/>
    </svg>
  </span>
  <span v-else-if="name === 'live'" class="cell-svg no-bg">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="8.5" stroke="#FA5151" stroke-width="1.6"/>
      <circle cx="12" cy="12" r="3.2" stroke="#FA5151" stroke-width="1.4"/>
    </svg>
  </span>
  <span v-else-if="name === 'listen'" class="cell-svg no-bg">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="#FA5151">
      <path d="M9 18.2V7.2l9-2v11" stroke="#FA5151" stroke-width="1.6" fill="none" stroke-linecap="round"/>
      <circle cx="7.2" cy="18.2" r="2.4"/>
      <circle cx="16.2" cy="16.2" r="2.4"/>
    </svg>
  </span>
  <span v-else-if="name === 'game'" class="cell-svg no-bg">
    <svg width="24" height="24" viewBox="0 0 24 24">
      <path d="M12 3l4.5 4.2L12 21 7.5 7.2 12 3z" fill="none" stroke="#07C160" stroke-width="1.3"/>
      <path d="M7.5 7.2h9" stroke="#576B95" stroke-width="1.2"/>
      <path d="M12 3v18" stroke="#F7B500" stroke-width="1.1"/>
    </svg>
  </span>
  <span v-else-if="name === 'scan'" class="cell-svg no-bg">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#576B95" stroke-width="1.5">
      <path d="M4 8V5.5A1.5 1.5 0 015.5 4H8M16 4h2.5A1.5 1.5 0 0120 5.5V8M20 16v2.5a1.5 1.5 0 01-1.5 1.5H16M8 20H5.5A1.5 1.5 0 014 18.5V16"/>
      <path d="M4 12h16" stroke="#07C160"/>
    </svg>
  </span>
  <span v-else-if="name === 'search-page'" class="cell-svg no-bg">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#07C160" stroke-width="1.5">
      <circle cx="11" cy="11" r="6"/><path d="M15.5 15.5L20 20" stroke-linecap="round"/>
    </svg>
  </span>

  <!-- 我页 -->
  <span v-else-if="name === 'services'" class="cell-svg no-bg">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path d="M12 3.5C7.5 3.5 3.8 6.6 3.8 10.4c0 2.1 1.2 4 3 5.3l-.6 2.7c-.1.4.3.7.6.5l3.1-1.6c.7.2 1.4.2 2.1.2 4.5 0 8.2-3.1 8.2-6.9S16.5 3.5 12 3.5z" stroke="#07C160" stroke-width="1.4"/>
      <path d="M9 10.2l2.1 2.1L15.5 8" stroke="#07C160" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </span>
  <span v-else-if="name === 'fav'" class="cell-svg no-bg">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path d="M7 4.5h10v15L12 16l-5 3.5v-15z" stroke="#F7B500" stroke-width="1.4"/>
      <path d="M9 8h6M9 11h6" stroke="#07C160" stroke-width="1.2"/>
    </svg>
  </span>
  <span v-else-if="name === 'album-me'" class="cell-svg no-bg">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <rect x="4" y="6" width="16" height="12" rx="2" stroke="#576B95" stroke-width="1.4"/>
      <path d="M4 14l4-3 3 2.5 4-4 5 4.5" stroke="#07C160" stroke-width="1.3" stroke-linejoin="round"/>
      <circle cx="9" cy="9.5" r="1.2" fill="#F7B500"/>
    </svg>
  </span>
  <span v-else-if="name === 'works'" class="cell-svg no-bg">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <rect x="7" y="4" width="10" height="13" rx="1.2" stroke="#576B95" stroke-width="1.4"/>
      <path d="M5 7v12a1 1 0 001 1h10" stroke="#576B95" stroke-width="1.3"/>
    </svg>
  </span>
  <span v-else-if="name === 'shop-cards'" class="cell-svg no-bg">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path d="M6 9h12l-1 10H7L6 9z" stroke="#FA9D3B" stroke-width="1.4"/>
      <path d="M9 9V7a3 3 0 016 0v2" stroke="#FA9D3B" stroke-width="1.4"/>
    </svg>
  </span>
  <span v-else-if="name === 'sticker'" class="cell-svg no-bg">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="8.2" stroke="#F7B500" stroke-width="1.4"/>
      <circle cx="9.2" cy="10.2" r="1" fill="#F7B500"/>
      <circle cx="14.8" cy="10.2" r="1" fill="#F7B500"/>
      <path d="M8.5 14c1.2 1.6 2.6 2.3 3.5 2.3s2.3-.7 3.5-2.3" stroke="#F7B500" stroke-width="1.3" stroke-linecap="round"/>
    </svg>
  </span>
  <span v-else-if="name === 'settings'" class="cell-svg no-bg">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="3" stroke="#576B95" stroke-width="1.4"/>
      <path d="M12 3.8l1.2 2.2 2.4-.4 1 2.3 2.3 1-.4 2.4 2.2 1.2-2.2 1.2.4 2.4-2.3 1-1 2.3-2.4-.4L12 20.2l-1.2-2.2-2.4.4-1-2.3-2.3-1 .4-2.4L3.3 12l2.2-1.2-.4-2.4 2.3-1 1-2.3 2.4.4L12 3.8z" stroke="#576B95" stroke-width="1.2" stroke-linejoin="round"/>
    </svg>
  </span>

  <span v-else class="cell-svg no-bg">•</span>
</template>

<style scoped>
.wx-icon { display: block; color: inherit; }
.cell-svg {
  width: 28px; height: 28px; border-radius: 6px;
  display: inline-flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.bg-orange { background: #FA9D3B; }
.bg-green { background: #07C160; }
.bg-blue { background: #576B95; }
.bg-blue-light { background: #5B9BD5; }
.no-bg { background: transparent; border-radius: 0; width: 28px; height: 28px; }
</style>
