// 语音全链路 e2e:chromium 假麦克风真按住/真录音/真走 MediaRecorder->wav 管道,
// 理解服务用 dev server 的 mock 模式(不出网,确定性),断言写字+回声播报。
// 负向:route 拦截模拟 服务 500 与 char 为空,断言引导播报。
//
// 跑法:
//   1. MOCK_UNDERSTAND=1 PORT=8731 npm run dev
//   2. npm run e2e:voice    (BASE_URL 可覆盖端口)
//
// 截图落 .cache/genwoxie/,需人(或多模态 Agent)逐张看版式。

import { fileURLToPath } from "node:url";
import path from "node:path";

import { loadChromium, inkRatio, BASE_URL } from "./pw.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "..", ".cache", "genwoxie");

const chromium = await loadChromium();
const browser = await chromium.launch({
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
});
const context = await browser.newContext({ viewport: { width: 900, height: 900 } });
await context.grantPermissions(["microphone"]);
const page = await context.newPage();

const errors: string[] = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(`${BASE_URL}/index.html`, { waitUntil: "networkidle" });

// 正向:按住 1s 说话(假设备出测试音),松手 -> mock 返回 城/小城夏天 -> 演示起播
const mic = page.locator("#micBtn");
await mic.dispatchEvent("pointerdown");
// 等"真开录"信号再计说话时长:高负载下 getUserMedia 可达秒级,固定 sleep 会
// 把按住时间全耗在拿麦克风上,录音过短被判误触(实测 flake 根因)。
await page.waitForSelector("#micBtn[data-recording]", { timeout: 10000 });
await page.waitForTimeout(1000);
await mic.dispatchEvent("pointerup");

await page.waitForSelector("#playPauseBtn.is-pause", { timeout: 10000 });
const echoSpeech = await page.evaluate(() => window.lastSpeech);
await page.screenshot({ path: `${out}/07-voice-loading.png` });

// 等演示完,验墨迹与标题
await page.waitForSelector("#playPauseBtn:not(.is-pause)", { timeout: 20000 });
const ink = await inkRatio(page);
const title = await page.title();
const labelRestored = await page.evaluate(
  () => document.querySelector(".mic-label")?.textContent,
);
await page.screenshot({ path: `${out}/08-voice-done.png` });

// 负向 1:理解服务 500 -> 播报网络提示
await page.route("**/api/understand", (r) => r.fulfill({ status: 502, body: "{}" }));
await page.evaluate(() => {
  window.lastSpeech = "";
});
await mic.dispatchEvent("pointerdown");
await page.waitForSelector("#micBtn[data-recording]", { timeout: 10000 });
await page.waitForTimeout(700);
await mic.dispatchEvent("pointerup");
await page.waitForFunction(() => (window.lastSpeech ?? "").includes("网络"), undefined, {
  timeout: 8000,
});

// 负向 2:模型判不出字(char 空) -> 播报没听清
await page.unroute("**/api/understand");
await page.route("**/api/understand", (r) =>
  r.fulfill({ status: 200, contentType: "application/json", body: '{"char":"","context":""}' }),
);
await page.evaluate(() => {
  window.lastSpeech = "";
});
await mic.dispatchEvent("pointerdown");
await page.waitForSelector("#micBtn[data-recording]", { timeout: 10000 });
await page.waitForTimeout(700);
await mic.dispatchEvent("pointerup");
await page.waitForFunction(() => (window.lastSpeech ?? "").includes("没听清"), undefined, {
  timeout: 8000,
});

// 负向用例故意让 /api/understand 回 502,资源错误是预期噪音;
// 正向对错另有 echo/ink/title 断言兜着,过滤不会漏真故障。
const unexpectedErrors = errors.filter((e) => !/status of 502/.test(e));

// 纠错闭环:mock 理解先返回错字「成」(带 auditId),复核端点返回纠正「城」->
// 断言:先写了成,随后播「听错啦,是城,小城夏天的城」并切写城(动画+语音,无文字提示)
await page.unroute("**/api/understand");
await page.route("**/api/understand", (r) =>
  r.fulfill({
    status: 200,
    contentType: "application/json",
    body: '{"char":"成","context":"","auditId":"t-fix"}',
  }),
);
await page.route("**/api/audit**", (r) =>
  r.fulfill({
    status: 200,
    contentType: "application/json",
    body: '{"status":"done","agree":false,"char":"城","context":"小城夏天"}',
  }),
);
await page.evaluate(() => {
  window.lastSpeech = "";
});
await mic.dispatchEvent("pointerdown");
await page.waitForSelector("#micBtn[data-recording]", { timeout: 10000 });
await page.waitForTimeout(700);
await mic.dispatchEvent("pointerup");
await page.waitForFunction(() => document.title.includes("成"), undefined, { timeout: 10000 });
await page.waitForFunction(() => (window.lastSpeech ?? "").includes("听错啦"), undefined, {
  timeout: 15000,
});
const correctionSpeech = await page.evaluate(() => window.lastSpeech);
await page.waitForFunction(() => document.title.includes("城"), undefined, { timeout: 10000 });
await page.screenshot({ path: `${out}/26-corrected.png` });

console.log(
  JSON.stringify(
    { unexpectedErrors, echoSpeech, ink, title, labelRestored, correctionSpeech },
    null,
    2,
  ),
);

const ok =
  unexpectedErrors.length === 0 &&
  echoSpeech === "城，小城夏天的城" &&
  ink > 0.03 &&
  title.includes("城") &&
  labelRestored === "按住说要写的字" &&
  correctionSpeech === "听错啦，是城，小城夏天的城";
await browser.close();
process.exit(ok ? 0 : 1);
