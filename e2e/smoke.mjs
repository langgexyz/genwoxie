// 跟我写 烟测:加载页面 -> 直接调全局 loadCharacter 绕过语音(headless 无麦克风)
// -> 验证笔顺动画/暂停/演示完整字留存。
//
// 跑法:
//   1. 起静态服务: python3 -m http.server 8731
//   2. node e2e/smoke.mjs           (默认用 probe skill 自带的 playwright)
//      或 PLAYWRIGHT=<path> node e2e/smoke.mjs 指定 playwright 入口
//
// 截图落 .cache/genwoxie/,需人(或多模态 Agent)逐张看版式。

import { fileURLToPath } from "node:url";
import path from "node:path";

const pwPath = process.env.PLAYWRIGHT
  || "/Users/zero/.claude/skills/probe/node_modules/playwright/index.js";
const pw = await import(pwPath);
const chromium = pw.chromium || pw.default?.chromium;

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "..", ".cache", "genwoxie");
const base = process.env.BASE_URL || "http://localhost:8731";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });

const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

await page.goto(`${base}/index.html`, { waitUntil: "networkidle" });
await page.screenshot({ path: `${out}/01-initial.png` });

await page.evaluate(() => window.loadCharacter("城"));

// 等动画真正开始(按钮进入暂停态),此刻截图看「演示中」+ 暂停双竖条
await page.waitForSelector("#playPauseBtn.is-pause", { timeout: 8000 });
await page.waitForTimeout(900);
await page.screenshot({ path: `${out}/02-animating.png` });

// 点暂停:按钮应翻回播放三角(is-pause 移除)
await page.click("#playPauseBtn");
await page.waitForTimeout(300);
const pausedShowsPlay = await page.evaluate(() =>
  !document.querySelector("#playPauseBtn").classList.contains("is-pause"));
await page.screenshot({ path: `${out}/03-paused.png` });

// 继续,轮询等演示彻底完成(onComplete 把按钮翻回播放三角)
await page.click("#playPauseBtn");
await page.waitForSelector("#playPauseBtn:not(.is-pause)", { timeout: 20000 });
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/04-done.png` });

// 演示完:毛笔墨迹画在 canvas 上(非 SVG)。数 canvas 上有多少不透明像素,
// 确认整字真被墨铺出来(>3% 像素有墨即认为写出了字);再靠人/多模态看 04 截图确认形状。
const inkRatio = await page.evaluate(() => {
  const c = document.querySelector("#inkCanvas");
  const ictx = c.getContext("2d");
  const { data } = ictx.getImageData(0, 0, c.width, c.height);
  let inked = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 20) inked++;
  return inked / (data.length / 4);
});
const title = await page.title();
const micDisabled = await page.evaluate(() => document.querySelector("#micBtn").disabled);

console.log(JSON.stringify({ errors, inkRatio, title, pausedShowsPlay, micDisabled }, null, 2));

const ok = errors.length === 0 && inkRatio > 0.03 && title.includes("城") && pausedShowsPlay === true;
await browser.close();
process.exit(ok ? 0 : 1);
