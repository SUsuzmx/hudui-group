// 聊天列表视口 + 输入框自适应（群聊 / 私聊共用）
import { nextTick } from 'vue';

/**
 * @param {{ listEl: import('vue').Ref, textareaRef: import('vue').Ref,
 *           messages: import('vue').Ref, noMoreHistory: import('vue').Ref,
 *           loadOlder?: (beforeId: number|null) => void }} deps
 */
export function useChatViewport({ listEl, textareaRef, messages, noMoreHistory, loadOlder }) {
  function scrollToBottom(smooth = true) {
    nextTick(() => {
      const el = listEl.value;
      if (!el) return;
      el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    });
  }

  function autoSizeInput() {
    const ta = textareaRef.value;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(96, Math.max(22, ta.scrollHeight)) + 'px';
  }

  function onScroll() {
    const el = listEl.value;
    if (!el || !loadOlder) return;
    if (el.scrollTop < 60 && !noMoreHistory.value && messages.value.length) {
      loadOlder(messages.value[0]?.id ?? null);
    }
  }

  return { scrollToBottom, autoSizeInput, onScroll };
}
