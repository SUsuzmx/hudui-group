// 移动端视口/安全区：补 CSS env() 拿不到的动态高度，消掉底部留白
function setVar(name, value) {
  try {
    document.documentElement.style.setProperty(name, value);
  } catch { /* ignore */ }
}

function readInset(name) {
  try {
    // 探测实际生效的 env 值（iOS 刘海 / 底部指示条）
    const probe = document.createElement('div');
    probe.style.cssText = `position:fixed;visibility:hidden;pointer-events:none;--_p:env(${name},0px);width:var(--_p);`;
    document.body.appendChild(probe);
    const px = parseFloat(getComputedStyle(probe).width) || 0;
    probe.remove();
    return px;
  } catch {
    return 0;
  }
}

export function syncMobileViewport() {
  const vv = window.visualViewport;
  const h = Math.round(vv?.height || window.innerHeight || document.documentElement.clientHeight || 0);
  const w = Math.round(vv?.width || window.innerWidth || document.documentElement.clientWidth || 0);
  // 真实可视高度优先：地址栏收起/展开时底部不再多出一截白
  setVar('--app-h', `${h}px`);
  setVar('--app-w', `${w}px`);
  // 键盘弹起时 visualViewport 变矮，用差值补偿输入栏
  const layoutH = window.innerHeight || h;
  const keyboard = Math.max(0, Math.round(layoutH - h - (vv?.offsetTop || 0)));
  setVar('--keyboard-h', `${keyboard}px`);
  setVar('--safe-t', `${readInset('safe-area-inset-top')}px`);
  setVar('--safe-b', `${readInset('safe-area-inset-bottom')}px`);
  setVar('--safe-l', `${readInset('safe-area-inset-left')}px`);
  setVar('--safe-r', `${readInset('safe-area-inset-right')}px`);
  // 状态栏/刘海高度：顶栏内容区下移
  const top = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--safe-t')) || 0;
  setVar('--status-h', `${top}px`);
}

export function initMobileViewport() {
  syncMobileViewport();
  const onChange = () => syncMobileViewport();
  window.addEventListener('resize', onChange, { passive: true });
  window.addEventListener('orientationchange', onChange, { passive: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', onChange, { passive: true });
    window.visualViewport.addEventListener('scroll', onChange, { passive: true });
  }
  // 键盘弹起后把输入框滚进可视区，避免被遮挡
  document.addEventListener('focusin', (e) => {
    const t = e.target;
    if (!t || !t.matches) return;
    if (!t.matches('input, textarea, [contenteditable="true"]')) return;
    setTimeout(() => {
      try {
        t.scrollIntoView({ block: 'center', behavior: 'smooth' });
      } catch {
        try { t.scrollIntoView(); } catch { /* ignore */ }
      }
      onChange();
    }, 280);
  }, true);
  // iOS 地址栏动画结束后再量一次
  setTimeout(syncMobileViewport, 300);
  document.addEventListener('DOMContentLoaded', syncMobileViewport, { once: true });
}
