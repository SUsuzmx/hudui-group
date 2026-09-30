import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});
await page.addStyleTag({
  content: `
    :root {
      --safe-t: 47px !important;
      --safe-b: 34px !important;
      --status-h: 47px !important;
      --app-h: 844px !important;
    }
  `,
});
await page.goto('http://127.0.0.1:3010/', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
await page.waitForTimeout(2000);
const metrics = await page.evaluate(() => {
  const shell = document.querySelector('.app-shell');
  const nav = document.querySelector('.nav-bar, .nav');
  const navBack = document.querySelector('.nav-back, .nav-bar .icon-btn, .icon-btn');
  const tab = document.querySelector('.tab-bar');
  const cs = getComputedStyle(document.documentElement);
  const r = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { top: b.top, height: b.height, bottom: b.bottom, left: b.left, width: b.width };
  };
  return {
    safeT: cs.getPropertyValue('--safe-t').trim(),
    safeB: cs.getPropertyValue('--safe-b').trim(),
    statusH: cs.getPropertyValue('--status-h').trim(),
    appH: cs.getPropertyValue('--app-h').trim(),
    bodyH: document.body.getBoundingClientRect().height,
    shellH: r(shell)?.height,
    shellBottom: r(shell)?.bottom,
    nav: nav
      ? {
          ...r(nav),
          padTop: getComputedStyle(nav).paddingTop,
          heightCss: getComputedStyle(nav).height,
        }
      : null,
    navBack: navBack
      ? {
          ...r(navBack),
          centerY: r(navBack).top + r(navBack).height / 2,
        }
      : null,
    tab: tab ? r(tab) : null,
    vh: window.innerHeight,
    bodyOverflow: getComputedStyle(document.body).overflow,
    bodyPos: getComputedStyle(document.body).position,
  };
});
console.log(JSON.stringify(metrics, null, 2));
await page.screenshot({ path: 'data/mobile-adapt-check.png', fullPage: false });
await browser.close();
