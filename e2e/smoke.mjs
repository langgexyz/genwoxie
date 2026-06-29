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

// 演示完:实黑笔画(非轮廓)应铺满整字。HanziWriter 轮廓 path 带较低 opacity,
// 这里数「被显式着色的笔画 group」是否齐全 —— 用整字所有 path 数兜底,
// 再靠人/多模态看 04 截图确认整字变实黑。
const strokeCount = await page.evaluate(() =>
  document.querySelectorAll("#writingBoard path").length);
const title = await page.title();
const micDisabled = await page.evaluate(() => document.querySelector("#micBtn").disabled);

console.log(JSON.stringify({ errors, strokeCount, title, pausedShowsPlay, micDisabled }, null, 2));

const ok = errors.length === 0 && strokeCount > 3 && title.includes("城") && pausedShowsPlay === true;
await browser.close();
process.exit(ok ? 0 : 1);
