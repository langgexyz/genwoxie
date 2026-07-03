// 测试入口烟测:验证 ?test 打字框入口(绕过语音直接查字)。
//   - 无 ?test:#testInput 隐藏
//   - 带 ?test:#testInput 显示,输入整句话回车后提取目标字+语境词并加载
//   - 回声消歧:播报文本 = 「城,小城夏天的城」(断言 window.lastSpeech)
//   - 字形数据:localStorage 已缓存 / 拦掉 CDN 后缓存字离线重写 / 查不到的字走「没找到」
//
// 跑法:
//   1. python3 -m http.server 8731
//   2. npm run e2e     (或单跑: node --experimental-strip-types e2e/test-input.ts)
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

// 无 ?test:打字框应隐藏(小朋友正式界面不出现)
await page.goto(`${BASE_URL}/index.html`, { waitUntil: "networkidle" });
const hiddenDefault = await page.evaluate(
  () => document.querySelector<HTMLInputElement>("#testInput")?.hidden,
);

// 带 ?test:打字框显示
await page.goto(`${BASE_URL}/?test`, { waitUntil: "networkidle" });
const visibleWithParam = await page.evaluate(
  () => !document.querySelector<HTMLInputElement>("#testInput")?.hidden,
);
await page.screenshot({ path: `${out}/05-test-input.png` });

// 输入「小城夏天的城怎么写」回车 -> 提取「城」+语境词「小城夏天」并加载,动画起播,
// 回声消歧:播报应为「城,小城夏天的城」(headless 听不到 TTS,断言 window.lastSpeech)
await page.fill("#testInput", "小城夏天的城怎么写");
await page.press("#testInput", "Enter");
// 20s 对齐 smoke:全新 context 首查要冷拉字形(无 localStorage 缓存/冷连接),
// 慢网络下 8s 不够,实测只挂这一处(smoke 同断言 20s 从不挂)。
await page.waitForSelector("#playPauseBtn.is-pause", { timeout: 20000 });
await page.waitForTimeout(900);
const title = await page.title();
const echoSpeech = await page.evaluate(() => window.lastSpeech);
await page.screenshot({ path: `${out}/06-test-loaded.png` });

// 字形数据 loader:查过的字应已进 localStorage 缓存(下次免网络)
const cached = await page.evaluate(() => !!localStorage.getItem("gwx-chardata-2.0:城"));

// 离线可用:拦掉所有字形数据请求,缓存过的「城」仍能从 localStorage 加载。
// 断言用播报文本(成功路径读「城」,失败路径读「网络不好」),不用 is-pause——
// 上一轮动画还在跑时 is-pause 恒为 true,断不出加载成败。
await page.route(/hanzi-writer-data/, (r) => r.abort());
await page.evaluate(() => {
  window.lastSpeech = "";
  void window.loadCharacter("城");
});
let offlineReplay = true;
await page
  .waitForFunction(() => window.lastSpeech === "城", undefined, { timeout: 8000 })
  .catch(() => {
    offlineReplay = false;
  });
await page.unroute(/hanzi-writer-data/); // 后面的负向用例要走真网络拿 404

// 负向:数据集里没有的字(拉丁字母 404)-> 播报「没找到」+ 画布清空 + 标题不被占
await page.evaluate(() => window.loadCharacter("A"));
await page.waitForFunction(() => (window.lastSpeech ?? "").includes("没找到"), undefined, {
  timeout: 8000,
});
await page.waitForTimeout(200);
const inkAfterMiss = await inkRatio(page);
const titleAfterMiss = await page.title();

// 负向用例故意打出 404(查不存在的字),资源 404 是预期内噪音;
// 正向加载对错另有 title/ink 断言兜着,过滤它不会漏真故障。
const unexpectedErrors = errors.filter((e) => !/status of 404/.test(e));

console.log(
  JSON.stringify(
    {
      unexpectedErrors,
      hiddenDefault,
      visibleWithParam,
      title,
      echoSpeech,
      cached,
      offlineReplay,
      inkAfterMiss,
      titleAfterMiss,
    },
    null,
    2,
  ),
);

const ok =
  unexpectedErrors.length === 0 &&
  hiddenDefault === true &&
  visibleWithParam === true &&
  title.includes("城") &&
  echoSpeech === "城，小城夏天的城" &&
  cached &&
  offlineReplay &&
  inkAfterMiss === 0 &&
  titleAfterMiss.includes("城");
await browser.close();
process.exit(ok ? 0 : 1);
