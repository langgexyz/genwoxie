// 跟我写 烟测:加载页面 -> 调 window.loadCharacter 测试钩子绕过语音(headless 无麦克风)
// -> 验证笔顺动画/暂停/演示完整字留存。
//
// 跑法:
//   1. 起静态服务: python3 -m http.server 8731
//   2. npm run e2e     (或单跑: node --experimental-strip-types e2e/smoke.ts)
//      PLAYWRIGHT=<path> 指定 playwright 入口,BASE_URL=<url> 指定服务地址
//
// 截图落 .cache/genwoxie/,需人(或多模态 Agent)逐张看版式。

import { fileURLToPath } from "node:url";
import path from "node:path";

import { loadChromium, inkRatio, BASE_URL } from "./pw.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "..", ".cache", "genwoxie");

const chromium = await loadChromium();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });

const errors: string[] = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(`${BASE_URL}/index.html`, { waitUntil: "networkidle" });
await page.screenshot({ path: `${out}/01-initial.png` });

// 空态契约:引导语可见,次级控件(再看/再听)不出现——首屏唯一动作是按住说话
const emptyState = await page.evaluate(() => ({
  hintVisible: !document.querySelector<HTMLElement>("#boardHint")?.hidden,
  controlsHidden: document.querySelector<HTMLElement>("#boardControls")?.hidden === true,
}));

await page.evaluate(() => window.loadCharacter("城"));

// 等动画真正开始(按钮进入暂停态),此刻截图看「演示中」+ 暂停双竖条
await page.waitForSelector("#playPauseBtn.is-pause", { timeout: 8000 });
await page.waitForTimeout(900);
await page.screenshot({ path: `${out}/02-animating.png` });

// 出字态契约:引导语退场,带文字标签的次级控件出现
const loadedState = await page.evaluate(() => ({
  hintHidden: document.querySelector<HTMLElement>("#boardHint")?.hidden === true,
  controlsVisible: document.querySelector<HTMLElement>("#boardControls")?.hidden === false,
  captions: [...document.querySelectorAll(".control-caption")].map((el) => el.textContent),
}));

// 点暂停:按钮应翻回播放三角(is-pause 移除)
await page.click("#playPauseBtn");
await page.waitForTimeout(300);
const pausedShowsPlay = await page.evaluate(
  () => !document.querySelector("#playPauseBtn")?.classList.contains("is-pause"),
);
await page.screenshot({ path: `${out}/03-paused.png` });

// 继续,轮询等演示彻底完成(onComplete 把按钮翻回播放三角)
await page.click("#playPauseBtn");
await page.waitForSelector("#playPauseBtn:not(.is-pause)", { timeout: 20000 });
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/04-done.png` });

// 演示完:毛笔墨迹画在 canvas 上(非 SVG)。数 canvas 上不透明像素,
// 确认整字真被墨铺出来(>3% 像素有墨即认为写出了字);再靠人/多模态看 04 截图确认形状。
const ink = await inkRatio(page);
const title = await page.title();
const micDisabled = await page.evaluate(
  () => document.querySelector<HTMLButtonElement>("#micBtn")?.disabled,
);

console.log(
  JSON.stringify({ errors, ink, title, pausedShowsPlay, micDisabled, emptyState, loadedState }, null, 2),
);

const ok =
  errors.length === 0 &&
  ink > 0.03 &&
  title.includes("城") &&
  pausedShowsPlay &&
  emptyState.hintVisible &&
  emptyState.controlsHidden &&
  loadedState.hintHidden &&
  loadedState.controlsVisible &&
  loadedState.captions.join(",") === "再写一遍,再读一遍";
await browser.close();
process.exit(ok ? 0 : 1);
