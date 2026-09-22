// 导航栈 + 浏览器返回键
export function createNavStack({ view, subView, activeChat, privateTarget, pendingSearch, onBack }) {
  const stack = [];

  function snapshot() {
    return {
      view: view.value,
      subView: subView.value ? JSON.parse(JSON.stringify(subView.value)) : null,
      activeChat: activeChat.value ? { ...activeChat.value } : null,
      privateTarget: privateTarget.value ? { ...privateTarget.value } : null,
      pendingSearch: pendingSearch.value,
    };
  }

  function apply(prev) {
    view.value = prev.view;
    subView.value = prev.subView;
    activeChat.value = prev.activeChat;
    privateTarget.value = prev.privateTarget;
    // 不覆盖调用方刚设置的 pendingSearch（如聊天信息 → 查找聊天记录）
  }

  function push() {
    stack.push(snapshot());
    if (stack.length > 20) stack.shift();
    try {
      window.history.pushState({ hudui: true, depth: stack.length }, '');
    } catch { /* ignore */ }
  }

  function back(fallback = 'main') {
    const prev = stack.pop();
    if (!prev) {
      view.value = fallback;
      subView.value = null;
      return fallback;
    }
    apply(prev);
    return prev.view;
  }

  function reset(to = 'main') {
    stack.length = 0;
    view.value = to;
    subView.value = null;
  }

  function depth() {
    return stack.length;
  }

  // 系统/手势返回键
  function onPopState() {
    if (typeof onBack === 'function') onBack();
  }
  try {
    window.addEventListener('popstate', onPopState);
  } catch { /* ignore */ }

  return { push, back, reset, depth, snapshot };
}
