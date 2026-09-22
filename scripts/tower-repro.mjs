import { chromium } from 'playwright';
import fs from 'node:fs';

const exe = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find((p) => fs.existsSync(p));

const browser = await chromium.launch({ headless: true, executablePath: exe });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const logs = [];
page.on('pageerror', (e) => logs.push('[pageerror] ' + (e.stack || e.message)));
page.on('console', (m) => {
  if (m.type() === 'error') logs.push('[err] ' + m.text());
});
await page.goto('http://127.0.0.1:3010/games/tower_game/', { waitUntil: 'networkidle', timeout: 25000 });
await page.waitForTimeout(1500);
await page.evaluate(() => {
  try {
    window.$('#canvas').show();
    window.$('.loading').hide();
    window.$('.landing').show();
  } catch (e) {
    console.error(e);
  }
});
await page.locator('#start').click({ force: true }).catch(() => {});
await page.waitForTimeout(2000);
await page.evaluate(() => {
  try {
    const g = window.TowerGame({ width: 200, height: 300, canvasId: 'canvas', soundOn: false });
    g.load(() => {
      g.assetsObj.image = {};
      g.init();
    }, () => {});
  } catch (e) {
    console.error(e);
  }
});
await page.waitForTimeout(2000);
console.log(logs.join('\n') || '(no errors)');
await browser.close();
