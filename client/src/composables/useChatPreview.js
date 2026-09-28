// 图片/文件预览状态（群聊 / 私聊共用）
import { ref } from 'vue';

export function useChatPreview() {
  const previewSrc = ref(null);
  const filePreview = ref(null); // { name, url, sender }
  const previewImages = ref([]);
  const previewIndex = ref(0);
  const showImagePreview = ref(false);

  function openPreview(src, images = null, index = 0) {
    if (images && images.length) {
      previewImages.value = images;
      previewIndex.value = index;
      showImagePreview.value = true;
    } else {
      previewSrc.value = src;
    }
  }

  function closePreview() {
    previewSrc.value = null;
    showImagePreview.value = false;
    previewImages.value = [];
    previewIndex.value = 0;
    filePreview.value = null;
  }

  function openFileMsg(m) {
    const name = m?.content || m?.fileName || '文件';
    const url = m?.mediaUrl || m?.url;
    if (!url) return;
    filePreview.value = { name, url, sender: m?.senderName || '' };
  }

  return {
    previewSrc,
    filePreview,
    previewImages,
    previewIndex,
    showImagePreview,
    openPreview,
    closePreview,
    openFileMsg,
  };
}
