// 微信式语音条播放: 点击气泡播放, 再次点击停止
import { ref } from 'vue';

let audio = null;
let currentKey = null;

export function parseVoiceSeconds(content) {
  const m = /(\d+)\s*[""″]?/.exec(String(content || ''));
  return m ? Math.max(1, Math.min(60, Number(m[1]))) : 1;
}

export function useVoicePlayer() {
  const playingKey = ref(null);

  function stopVoice() {
    if (audio) {
      try { audio.pause(); } catch { /* ignore */ }
      audio = null;
    }
    currentKey = null;
    playingKey.value = null;
  }

  function playVoice(m) {
    const key = String(m?.id ?? m?.mediaUrl ?? '');
    if (!m?.mediaUrl) return;
    if (playingKey.value === key) {
      stopVoice();
      return;
    }
    stopVoice();
    const el = new Audio(m.mediaUrl);
    audio = el;
    currentKey = key;
    playingKey.value = key;
    const done = () => {
      if (currentKey === key) stopVoice();
    };
    el.onended = done;
    el.onerror = done;
    el.play().catch(done);
  }

  function disposeVoice() {
    stopVoice();
  }

  return { playingKey, playVoice, stopVoice, disposeVoice, parseVoiceSeconds };
}
