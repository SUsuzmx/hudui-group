// 聊天输入框草稿同步：避免「打字被吞 / 删了又恢复」
// 原因：每次 keystroke 存草稿 → 服务端 notify 自己 → Socket 回写覆盖 v-model

export function createDraftSync({ getDraft, setDraft, getConversationId, saveDraft }) {
  let lastLocal = '';
  let composing = false;
  let focused = false;
  let timer = null;
  let seq = 0;

  function markLocal() {
    lastLocal = getDraft();
  }

  function setComposing(v) {
    composing = !!v;
  }

  function setFocused(v) {
    focused = !!v;
  }

  /** 本地编辑时调用：更新本地镜像 + 防抖上传 */
  function onLocalChange() {
    markLocal();
    seq += 1;
    const my = seq;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (my !== seq) return;
      const conv = getConversationId();
      if (!conv || typeof saveDraft !== 'function') return;
      const val = getDraft();
      lastLocal = val;
      Promise.resolve(saveDraft(conv, val.slice(0, 500))).catch(() => {});
    }, 400);
  }

  /**
   * 远端/服务端草稿事件
   * 仅在：非组字、未聚焦、且内容与本地镜像不同时才回写
   * 聚焦中一律忽略，防止删掉的字被恢复、正在输入的字被吞掉
   */
  function applyRemote(conversationId, remoteDraft) {
    const conv = getConversationId();
    if (!conv || conversationId !== conv) return false;
    if (composing || focused) return false;
    const remote = remoteDraft || '';
    if (remote === lastLocal) return false;
    // 本地已有未同步内容时，以本地为准
    const local = getDraft();
    if (local && local !== lastLocal && remote !== local) {
      lastLocal = local;
      return false;
    }
    if (remote === local) {
      lastLocal = local;
      return false;
    }
    // 仅当本地为空或与镜像一致时接受远端（多端/切换会话恢复）
    if (local && local === lastLocal && remote && remote !== local) {
      // 用户在本地编辑过（镜像=当前），拒绝远端覆盖
      return false;
    }
    setDraft(remote);
    lastLocal = remote;
    return true;
  }

  /** 打开会话时一次性恢复草稿 */
  function loadInitial(serverDraft) {
    const local = getDraft();
    if (local) {
      lastLocal = local;
      return;
    }
    const s = serverDraft || '';
    if (s) {
      setDraft(s);
      lastLocal = s;
    } else {
      lastLocal = '';
    }
  }

  function clearLocal() {
    clearTimeout(timer);
    lastLocal = '';
    setDraft('');
  }

  function dispose() {
    clearTimeout(timer);
  }

  return {
    markLocal,
    onLocalChange,
    applyRemote,
    loadInitial,
    clearLocal,
    dispose,
    setComposing,
    setFocused,
    get lastLocal() { return lastLocal; },
  };
}
