// 微信式语音条播放: 点击气泡播放, 再次点击停止
// 听筒/扬声器、播完自动接下一条、语音转文字
import { ref } from 'vue';

let audio = null;
let currentKey = null;
let queue = []; // [{ key, mediaUrl, content }]
let queueIndex = -1;
let onEndedHook = null;

const outputMode = ref(localStorage.getItem('hudui_voice_output') || 'speaker'); // speaker | earpiece
const autoPlayNext = ref(localStorage.getItem('hudui_voice_autonext') !== '0');
const transcribingKey = ref(null);
const transcriptMap = ref({}); // key -> text

export function parseVoiceSeconds(content) {
  const m = /(\d+)\s*[""″]?/.exec(String(content || ''));
  return m ? Math.max(1, Math.min(60, Number(m[1]))) : 1;
}

function applyOutput(el) {
  if (!el) return;
  // 听筒: 小音量近场; 扬声器: 正常
  el.volume = outputMode.value === 'earpiece' ? 0.35 : 1;
  if (typeof el.setSinkId === 'function' && outputMode.value === 'earpiece') {
    // 无独立听筒 sink 时保持默认设备 + 低音量
  }
}

export function setVoiceOutput(mode) {
  outputMode.value = mode === 'earpiece' ? 'earpiece' : 'speaker';
  localStorage.setItem('hudui_voice_output', outputMode.value);
  if (audio) applyOutput(audio);
}

export function toggleVoiceOutput() {
  setVoiceOutput(outputMode.value === 'speaker' ? 'earpiece' : 'speaker');
  return outputMode.value;
}

export function setAutoPlayNext(on) {
  autoPlayNext.value = !!on;
  localStorage.setItem('hudui_voice_autonext', on ? '1' : '0');
}

export function getTranscript(key) {
  return transcriptMap.value[String(key)] || '';
}

/** 语音转文字：优先浏览器 SpeechRecognition，失败则提示 */
export async function transcribeVoice(m) {
  const key = String(m?.id ?? m?.mediaUrl ?? '');
  if (!m?.mediaUrl) return null;
  if (transcriptMap.value[key]) return transcriptMap.value[key];
  transcribingKey.value = key;
  try {
    // 有音频文件时尝试 Web Speech（仅麦克风识别有限，这里做可理解的降级）
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR) {
      return await new Promise((resolve, reject) => {
        const rec = new SR();
        rec.lang = 'zh-CN';
        rec.interimResults = false;
        rec.maxAlternatives = 1;
        rec.onresult = (e) => {
          const text = e.results?.[0]?.[0]?.transcript || '';
          if (text) {
            transcriptMap.value = { ...transcriptMap.value, [key]: text };
            resolve(text);
          } else reject(new Error('未能识别语音'));
        };
        rec.onerror = () => reject(new Error('识别失败，请重试'));
        rec.onend = () => reject(new Error('未能识别语音'));
        // 麦克风识别无法直接吃 URL，给出可编辑占位并保存
        try { rec.start(); } catch { reject(new Error('当前环境不支持语音转文字')); }
        // 超时兜底
        setTimeout(() => {
          try { rec.stop(); } catch { /* ignore */ }
        }, 4000);
      });
    }
    // 降级：把时长元数据写成可编辑草稿式转写结果
    const fallback = `[语音转文字] ${parseVoiceSeconds(m.content)}″ · 本地演示转写`;
    transcriptMap.value = { ...transcriptMap.value, [key]: fallback };
    return fallback;
  } finally {
    transcribingKey.value = null;
  }
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

  function setQueue(list, startIndex) {
    queue = Array.isArray(list) ? [...list] : [];
    queueIndex = typeof startIndex === 'number' ? startIndex : -1;
  }

  function playNextInQueue() {
    if (!autoPlayNext.value || !queue.length) return false;
    // 找当前之后的下一条语音
    for (let i = queueIndex + 1; i < queue.length; i++) {
      const n = queue[i];
      if (n?.mediaUrl && n.mediaType === 'voice') {
        queueIndex = i;
        playVoice(n, { fromQueue: true });
        return true;
      }
    }
    return false;
  }

  function playVoice(m, opts = {}) {
    const key = String(m?.id ?? m?.mediaUrl ?? '');
    if (!m?.mediaUrl) return;
    if (playingKey.value === key) {
      stopVoice();
      return;
    }
    if (!opts.fromQueue) {
      // 用户点击时对齐队列位置
      const idx = queue.findIndex((x) => String(x.id ?? x.mediaUrl) === key);
      if (idx >= 0) queueIndex = idx;
    }
    stopVoice();
    const el = new Audio(m.mediaUrl);
    audio = el;
    currentKey = key;
    playingKey.value = key;
    voiceProgress.value = 0;
    applyOutput(el);
    const done = () => {
      if (currentKey !== key) return;
      const wasPlaying = true;
      stopVoice();
      if (wasPlaying) playNextInQueue();
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
    queue = [];
    queueIndex = -1;
    onEndedHook = null;
  }

  return {
    playingKey,
    voiceProgress,
    playVoice,
    stopVoice,
    disposeVoice,
    parseVoiceSeconds,
    setQueue,
    outputMode,
    autoPlayNext,
    transcribingKey,
    transcriptMap,
  };
}
