# 跟我写（genwoxie）

给小朋友的「语音查字 + 笔顺示范」字帖网页。

小朋友按住麦克风开口说「小城夏天的城怎么写」，屏幕就把那个「城」字又大又清楚地一笔一画演示出来、并读出读音，小朋友拿着笔在自己的本子上照着写。换字就再按一次麦克风说一个。

## 交互（极简：一个输入，一个输出）

- 输入：按住麦克风说话，松手识别。识别走「录音 -> 云端多模态模型直接理解音频」（qwen3.5-omni-flash，含同音字消歧），理解服务不可用时降级到浏览器 Web Speech，再不行用 `?test` 打字框。
- 输出：田字格字帖，含
  - 毛笔书写动画：沿笔画中线一笔一笔写出来，有笔尖、起收笔提按、按笔画长短的书写速度（可播放 / 暂停）
  - 喇叭，读出这个字的读音
- 识别到字后：自动演示一遍笔顺 + 自动读一遍读音，演示完整字留在格子里供照抄。
- 回声消歧：读音会把孩子说的语境词读回去（说「小城夏天的城怎么写」→ 播报「城，小城夏天的城」）。孩子不认识屏幕上的字，听语境词对不对是他唯一能发现同音字识别错误的通道；多音字也因此在词里读出正确读音。

小朋友始终写在纸上，屏幕只当字帖参照，所以页面上没有手写 / 描红 / 打字框。

## 使用技巧(重要)

说字的时候**带一个有名的词**,识别几乎必中:「江泽民的泽」「康熙皇帝的熙」「小城夏天的城」。
只说人名(比如「余泽熙的熙」)时,同音字(溪/西/希/熙…)在语音上无法区分,模型只能猜;
此时应用会在写完后语音引导换个说法。教孩子这个习惯是准确率的最大杠杆。

## 运行

带语音理解的完整形态（静态页 + 转发函数，key 不出服务端）：

```
DASHSCOPE_API_KEY=<百炼key> DASHSCOPE_BASE_URL=<百炼endpoint> npm run dev
# 浏览器打开 http://localhost:8731 ；MOCK_UNDERSTAND=1 npm run dev 为 e2e 用 mock 模式
```

纯静态也能跑（无语音理解，走 Web Speech/打字框降级）：

```
python3 -m http.server 8731
```

改源码后重新构建（源码 TypeScript strict，`src/` → `dist/`）：

```
npm install
npm run build    # tsc 直出原生 ES modules,无打包器
npm run check    # 全量类型检查(含 tests/ e2e/)
```

语音输入依赖浏览器的 Web Speech API（`SpeechRecognition`），Chrome / Edge 支持最好。

## 技术

- 字形数据：[hanzi-writer-data](https://github.com/chanind/hanzi-writer-data)（真实楷体轮廓 + 笔画中线，覆盖全量常用字）。自己 fetch 按需拉（`src/chardata.ts`），多 CDN 源自动换源 + localStorage 缓存（查过的字离线可用），不引 hanzi-writer 库本身。
- 话术提取：`src/extract.ts` 纯函数，从整句话里取目标字 + 语境词，带单测表。
- 毛笔渲染：自己用 `<canvas>` 实现 —— 保留楷体轮廓当形状边界裁剪，在边界内用一支会运笔的毛笔沿中线盖墨写出来。字形利落（照抄字帖要形状对），毛笔感在书写过程里。
- 语音理解：`server/understand.ts`（dev server 与生产 FC 函数共用），录音在前端统一重采样为 wav 16k 单声道（`src/wav.ts` + `src/recorder.ts`，抹平 iOS mp4/Android webm 分裂）后 base64 上传。选型与实测数据见 `docs/tech/voice-pipeline-research.md`。
- 读音：浏览器自带语音合成 `speechSynthesis`。
- 无后端、无打包器：TypeScript strict 源码在 `src/`，`tsc` 直出原生 ES modules 到 `dist/`，`index.html` 一个 `<script type="module">` 入口；测试也全部强类型（`tests/` `e2e/` 均为 `.ts`）。

## 测试

```
python3 -m http.server 8731 &
npm test        # 单测:先 build 再对 dist/ 跑话术提取用例表
npm run e2e     # smoke + test-input 两套,截图落 .cache/genwoxie/
```

`e2e/smoke.ts`：playwright 加载页面，绕过语音直接写一个字，校验毛笔书写动画 / 暂停 / 写完整字留存（数 canvas 墨迹像素确认真写出了字），并截图供人核对版式。

`e2e/test-input.ts`：校验 `?test` 打字框入口（带 `?test` 参数访问才显示，正式界面不出现），并覆盖：回声消歧播报文本、字形数据 localStorage 缓存、拦掉 CDN 后缓存字离线加载、查不到的字播报「没找到」且画布保持空。

`e2e/voice.ts`：语音全链路（chromium 假麦克风真录音、mock 理解服务），含服务 502 与识别为空两条负向；`e2e/voice-replay.ts`：把真实语音 wav 当麦克风输入、打真实模型的全栈回放验证（需 key，不进默认集）。

`tests/extract.test.ts`：话术提取单测表，孩子的各种说法 → 期望的目标字 + 语境词，含负向用例。单测跑构建产物 `dist/`，顺带守住 dist 与源码不漂移。
