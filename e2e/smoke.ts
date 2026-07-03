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

// 首屏自我介绍契约:不做任何操作,毛笔自动开写「城」(按钮例句的答案);
// 格内无文字说明(孩子不识字,教学靠演示+例句,不靠废话)
const firstEntry = {
  autoDemoStarted: await page
    .waitForSelector("#playPauseBtn.is-pause", { timeout: 20000 })
    .then(() => true)
    .catch(() => false),
  hintGone: await page.evaluate(() => document.querySelector("#boardHint") === null),
};

// 首次触摸即开口契约:碰屏幕任意非按钮处,静默写完的字被读出(TTS 解锁时刻)
await page.evaluate(() => {
  window.lastSpeech = "";
});
await page.mouse.click(450, 300); // 点在田字格上,不碰任何按钮
const firstTouchSpoke = await page
  .waitForFunction(() => (window.lastSpeech ?? "").includes("城"), undefined, { timeout: 5000 })
  .then(() => true)
  .catch(() => false);

await page.evaluate(() => window.loadCharacter("城"));

// 等动画真正开始(按钮进入暂停态),此刻截图看「演示中」+ 暂停双竖条
await page.waitForSelector("#playPauseBtn.is-pause", { timeout: 20000 });
// 事件驱动等"第一段墨迹已落"再暂停:固定 sleep 在高负载下会被拉伸到睡过整场
// 动画,点"暂停"变成点"重播",后续断言全歪(实测 flake 根因)。
await page.waitForFunction(
  () => {
    const c = document.querySelector<HTMLCanvasElement>("#inkCanvas");
    if (!c) return false;
    const ictx = c.getContext("2d");
    if (!ictx) return false;
    const { data } = ictx.getImageData(0, 0, c.width, c.height);
    let n = 0;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > 20) {
        n++;
        if (n > 500) return true;
      }
    }
    return false;
  },
  undefined,
  { timeout: 15000 },
);
await page.screenshot({ path: `${out}/02-animating.png` });

// 出字态契约:带文字标签的次级控件出现
const loadedState = await page.evaluate(() => ({
  controlsVisible: document.querySelector<HTMLElement>("#boardControls")?.hidden === false,
  captions: [...document.querySelectorAll(".control-caption")].map((el) => el.textContent),
}));

// 点暂停:按钮应翻回播放三角(is-pause 移除)——事件驱动等待,不用固定 sleep
await page.click("#playPauseBtn");
let pausedShowsPlay = true;
await page
  .waitForFunction(
    () => !document.querySelector("#playPauseBtn")?.classList.contains("is-pause"),
    undefined,
    { timeout: 5000 },
  )
  .catch(() => {
    pausedShowsPlay = false;
  });
await page.screenshot({ path: `${out}/03-paused.png` });

// 继续,轮询等演示彻底完成(onComplete 把按钮翻回播放三角)
await page.click("#playPauseBtn");
await page.waitForSelector("#playPauseBtn:not(.is-pause)", { timeout: 30000 });
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/04-done.png` });

// 演示完:毛笔墨迹画在 canvas 上(非 SVG)。数 canvas 上不透明像素,
// 确认整字真被墨铺出来(>3% 像素有墨即认为写出了字);再靠人/多模态看 04 截图确认形状。
const ink = await inkRatio(page);

// 朗读态契约:点"再读一遍"喇叭进入 is-speaking(泛波动画),读完(或守护定时器)退场。
// headless 无声,凭 class 生命周期断言;动画观感靠截图自审。
await page.click("#speakBtn");
const speakingShown = await page
  .waitForFunction(
    () => document.querySelector("#speakBtn")?.classList.contains("is-speaking"),
    undefined,
    { timeout: 3000 },
  )
  .then(() => true)
  .catch(() => false);
await page.screenshot({ path: `${out}/05-speaking.png` });
const speakingCleared = await page
  .waitForFunction(
    () => !document.querySelector("#speakBtn")?.classList.contains("is-speaking"),
    undefined,
    { timeout: 25000 },
  )
  .then(() => true)
  .catch(() => false);

const title = await page.title();
const micDisabled = await page.evaluate(
  () => document.querySelector<HTMLButtonElement>("#micBtn")?.disabled,
);

console.log(
  JSON.stringify({ errors, ink, title, pausedShowsPlay, micDisabled, firstEntry, firstTouchSpoke, loadedState, speakingShown, speakingCleared }, null, 2),
);

const ok =
  errors.length === 0 &&
  speakingShown &&
  speakingCleared &&
  ink > 0.03 &&
  title.includes("城") &&
  pausedShowsPlay &&
  firstEntry.autoDemoStarted &&
  firstEntry.hintGone &&
  firstTouchSpoke &&
  loadedState.controlsVisible &&
  loadedState.captions.join(",") === "再写一遍,再读一遍";
await browser.close();
process.exit(ok ? 0 : 1);
