// 用 Playwright 将 regen-cn.html 中的各元素截图, 覆盖游戏内带英文的图片
const { chromium } = require("playwright");
const path = require("path");

const ASSETS = path.join(__dirname, "..", "games", "tower_game", "assets");
const MAP = {
  start: "main-index-start.png",
  replay: "main-modal-again-b.png",
  share: "main-modal-invite-b.png",
  over: "main-modal-over.png",
  score: "score.png",
  tutorial: "tutorial.png",
};

(async () => {
  const browser = await chromium.launch({
    executablePath:
      "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  });
  const page = await browser.newPage();
  await page.goto("file:///" + path.join(ASSETS, "regen-cn.html"));
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  for (const [id, file] of Object.entries(MAP)) {
    await page.locator("#" + id).screenshot({
      path: path.join(ASSETS, file),
      omitBackground: true,
    });
    console.log("written", file);
  }
  await browser.close();
})();
