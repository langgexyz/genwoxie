# 跟我写（genwoxie）

给小朋友的「语音查字 + 笔顺示范」字帖网页。

小朋友按住麦克风开口说「小城夏天的城怎么写」，屏幕就把那个「城」字又大又清楚地一笔一画演示出来、并读出读音，小朋友拿着笔在自己的本子上照着写。换字就再按一次麦克风说一个。

## 交互（极简：一个输入，一个输出）

- 输入：按住麦克风说话，松手识别。
- 输出：田字格字帖，含
  - 笔顺动画（可播放 / 暂停）
  - 喇叭，读出这个字的读音
- 识别到字后：自动演示一遍笔顺 + 自动读一遍读音，演示完整字留在格子里供照抄。

小朋友始终写在纸上，屏幕只当字帖参照，所以页面上没有手写 / 描红 / 打字框。

## 运行

纯静态页面，无需构建：

```
python3 -m http.server 8731
# 浏览器打开 http://localhost:8731
```

语音输入依赖浏览器的 Web Speech API（`SpeechRecognition`），Chrome / Edge 支持最好。

## 技术

- 笔顺与字形：[hanzi-writer](https://hanziwriter.org/)（CDN 引入，按需在线拉任意汉字的笔顺数据，不限内置字库）。
- 读音：浏览器自带语音合成 `speechSynthesis`。
- 无后端、无打包，三个文件：`index.html` / `app.js` / `styles.css`。

## 测试

`e2e/smoke.mjs`：playwright 加载页面，绕过语音直接演示一个字，校验笔顺动画 / 暂停 / 演示完整字留存，并截图供人核对版式。

```
python3 -m http.server 8731 &
node e2e/smoke.mjs   # 截图落 .cache/genwoxie/
```

`e2e/test-input.mjs`：校验 `?test` 打字框入口。带 `?test` 参数访问（`http://localhost:8731/?test`）才显示一个打字框，绕过语音直接输入要写的字、回车查字，方便手测 / e2e；正式界面（无参数）不出现这个框。
