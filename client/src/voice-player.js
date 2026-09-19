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
  const voiceProgress = ref(0); // 0-1

  function stopVoice() {
    if (audio) {
      try { audio.pause(); } catch { /* ignore */ }
      audio = null;
    }
    currentKey = null;
    playingKey.value = null;
    voiceProgress.value = 0;
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
    voiceProgress.value = 0;
    const done = () => {
      if (currentKey === key) stopVoice();
    };
    el.onended = done;
    el.onerror = done;
    el.ontimeupdate = () => {
      if (!el.duration || !Number.isFinite(el.duration)) return;
      voiceProgress.value = Math.min(1, el.currentTime / el.duration);
    };
    el.play().catch(done);
  }

  function disposeVoice() {
    stopVoice();
  }

  return { playingKey, voiceProgress, playVoice, stopVoice, disposeVoice, parseVoiceSeconds };
}
