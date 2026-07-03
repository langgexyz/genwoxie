// 真实语音回放 e2e:用 chromium 的假音频捕获把一段真实语音 wav 当"麦克风输入",
// 走完整链路(按住->MediaRecorder->wav 归一->理解服务->写字)。
// 配真实模式 dev server 时 = 全栈真模型验证;语料 wav 既是 eval 集也是回放输入。
//
// 跑法(需要真实模式 server + 语料文件,故不进默认 e2e 集):
//   1. DASHSCOPE_API_KEY=... DASHSCOPE_BASE_URL=... PORT=8731 npm run dev
//   2. REPLAY_WAV=/path/to/说话.wav REPLAY_CHAR=城 node --experimental-strip-types e2e/voice-replay.ts

import { loadChromium, inkRatio, BASE_URL } from "./pw.ts";

const wavPath = process.env["REPLAY_WAV"];
const expectChar = process.env["REPLAY_CHAR"];
if (!wavPath || !expectChar) {
  console.error("usage: REPLAY_WAV=<语音wav路径> REPLAY_CHAR=<期望字> node --experimental-strip-types e2e/voice-replay.ts");
  process.exit(2);
}

const chromium = await loadChromium();
const browser = await chromium.launch({
  args: [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    `--use-file-for-fake-audio-capture=${wavPath}`,
  ],
});
const context = await browser.newContext({ viewport: { width: 900, height: 900 } });
await context.grantPermissions(["microphone"]);
const page = await context.newPage();

await page.goto(`${BASE_URL}/index.html`, { waitUntil: "networkidle" });

// 按住 4s:覆盖整句话(捕获文件循环播放,从按下起采)
const mic = page.locator("#micBtn");
await mic.dispatchEvent("pointerdown");
await page.waitForTimeout(4000);
await mic.dispatchEvent("pointerup");

// 真模型往返 + 演示起播
await page.waitForSelector("#playPauseBtn.is-pause", { timeout: 20000 });
const title = await page.title();
const echoSpeech = await page.evaluate(() => window.lastSpeech);
const ink = await inkRatio(page);

console.log(JSON.stringify({ title, echoSpeech, ink }, null, 2));

const ok = title.includes(expectChar) && (echoSpeech ?? "").includes(expectChar) && ink > 0;
await browser.close();
process.exit(ok ? 0 : 1);
