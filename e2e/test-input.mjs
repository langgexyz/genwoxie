// 测试入口烟测:验证 ?test 打字框入口(绕过语音直接查字)。
//   - 无 ?test:#testInput 隐藏
//   - 带 ?test:#testInput 显示,输入「城怎么写」回车后真加载「城」(title 含城 + 动画起播)
//
// 跑法:
//   1. python3 -m http.server 8731
//   2. node e2e/test-input.mjs       (默认用 probe skill 自带 playwright)
//      或 PLAYWRIGHT=<path> node e2e/test-input.mjs
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

// 无 ?test:打字框应隐藏(小朋友正式界面不出现)
await page.goto(`${base}/index.html`, { waitUntil: "networkidle" });
const hiddenDefault = await page.evaluate(() => document.querySelector("#testInput").hidden);

// 带 ?test:打字框显示
await page.goto(`${base}/?test`, { waitUntil: "networkidle" });
const visibleWithParam = await page.evaluate(() => !document.querySelector("#testInput").hidden);
await page.screenshot({ path: `${out}/05-test-input.png` });

// 输入「小城夏天的城怎么写」回车 -> 提取「城」+语境词「小城夏天」并加载,动画起播,
// 回声消歧:播报应为「城,小城夏天的城」(headless 听不到 TTS,断言 window.lastSpeech)
await page.fill("#testInput", "小城夏天的城怎么写");
await page.press("#testInput", "Enter");
await page.waitForSelector("#playPauseBtn.is-pause", { timeout: 8000 });
await page.waitForTimeout(900);
const title = await page.title();
const echoSpeech = await page.evaluate(() => window.lastSpeech);
await page.screenshot({ path: `${out}/06-test-loaded.png` });

console.log(JSON.stringify({ errors, hiddenDefault, visibleWithParam, title, echoSpeech }, null, 2));

const ok = errors.length === 0
  && hiddenDefault === true
  && visibleWithParam === true
  && title.includes("城")
  && echoSpeech === "城，小城夏天的城";
await browser.close();
process.exit(ok ? 0 : 1);
