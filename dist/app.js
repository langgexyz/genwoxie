// 「跟我写」:语音查字 -> 毛笔沿中线一笔一笔写出来 -> 写完留在格子里供照抄。
//
// 字形数据(真实楷体轮廓 strokes + 中线 medians)由 chardata.ts 按需拉取,
// 自己用 canvas 当毛笔渲染:近实心墨沿中线运笔、轮廓裁剪保证范字形状利落、
// 起收笔提按、按笔画长短的书写速度、可播放/暂停。
//
// 坐标:字形在 1024x1024 字面坐标(y 向上),映射到 640 田字格:
//   translate(PADDING, BOARD-PADDING) 后 scale(SCALE, -SCALE),之后都在字面坐标里画。
import { extractTargetCharacter, buildSpeechText } from "./extract.js";
import { loadCharacterData } from "./chardata.js";
import { HoldRecorder, recordingSupported } from "./recorder.js";
import { probeUnderstandApi, requestUnderstand } from "./understand.js";
const BOARD = 640;
const PADDING = 50;
const SCALE = (BOARD - PADDING * 2) / 1024;
const INK = "26, 30, 34"; // 墨色 rgb
const DAB_STEP = 5; // 沿中线每隔多少字面单位盖一笔
const BASE_RADIUS = 62; // 毛笔最粗半径(字面单位),最终形状由轮廓裁剪定
const MS_PER_UNIT = 1.6; // 每字面单位多少毫秒 -> 长笔画自然写得久
const STROKE_MIN_MS = 360;
const STROKE_MAX_MS = 1400;
const BETWEEN_STROKES_MS = 230;
function mustQuery(root, selector) {
    const el = root.querySelector(selector);
    if (!el)
        throw new Error(`missing element: ${selector}`);
    return el;
}
const canvas = mustQuery(document, "#inkCanvas");
const boardHint = mustQuery(document, "#boardHint");
const boardControls = mustQuery(document, "#boardControls");
const playPauseBtn = mustQuery(document, "#playPauseBtn");
const speakBtn = mustQuery(document, "#speakBtn");
const micBtn = mustQuery(document, "#micBtn");
const micLabel = mustQuery(micBtn, ".mic-label");
const testInput = mustQuery(document, "#testInput");
const maybeCtx = canvas.getContext("2d");
if (!maybeCtx)
    throw new Error("2d canvas context unavailable");
const ctx = maybeCtx;
const dpr = window.devicePixelRatio || 1;
canvas.width = BOARD * dpr;
canvas.height = BOARD * dpr;
let currentChar = "";
let currentContext = ""; // 语境词(「小城夏天的城」的「小城夏天」),读音消歧用
let strokes = [];
let totalVt = 0; // 整字书写时间线总长(ms)
let runToken = 0; // 每次重写自增,旧动画看到 token 变了就退出
let paused = false;
let demoState = "idle";
function applyGlyphTransform() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.translate(PADDING, BOARD - PADDING);
    ctx.scale(SCALE, -SCALE);
}
function clearBoard() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
}
// 稀疏中线点按弧长重采样成密集点 + 累计弧长,供"写到一半"用。
function resampleMedian(points) {
    const dense = [];
    const cum = [0];
    let total = 0;
    for (let i = 0; i < points.length - 1; i++) {
        const [x0, y0] = points[i];
        const [x1, y1] = points[i + 1];
        const steps = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / DAB_STEP));
        for (let s = 0; s < steps; s++) {
            const t = s / steps;
            const x = x0 + (x1 - x0) * t;
            const y = y0 + (y1 - y0) * t;
            const prev = dense[dense.length - 1];
            if (prev)
                total += Math.hypot(x - prev[0], y - prev[1]);
            dense.push([x, y]);
            cum.push(total);
        }
    }
    const last = points[points.length - 1];
    const prev = dense[dense.length - 1];
    if (prev)
        total += Math.hypot(last[0] - prev[0], last[1] - prev[1]);
    dense.push([last[0], last[1]]);
    cum.push(total);
    return { dense, cum, total };
}
// 起收笔提按:两端略细、中段最粗。最终形状由轮廓裁剪决定,这里只影响饱满度。
function pressRadius(u) {
    return BASE_RADIUS * (0.55 + 0.45 * Math.sin(Math.PI * (0.08 + 0.84 * u)));
}
function inkDab(x, y, radius) {
    // 近实心:让裁剪轮廓产生利落的楷书边和尖锋,只留极细软边做抗锯齿。
    const grad = ctx.createRadialGradient(x, y, 0, x, y, radius);
    grad.addColorStop(0, `rgba(${INK}, 1)`);
    grad.addColorStop(0.92, `rgba(${INK}, 1)`);
    grad.addColorStop(1, `rgba(${INK}, 0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
}
// 在一笔的轮廓裁剪内沿中线盖墨到 revealLen 弧长处,返回当前笔尖位置。
function stampStroke(stroke, revealLen) {
    const { outline, dense, cum, total } = stroke;
    ctx.save();
    applyGlyphTransform();
    ctx.clip(outline);
    let tip = dense[0];
    for (let i = 0; i < dense.length; i++) {
        if (cum[i] > revealLen)
            break;
        inkDab(dense[i][0], dense[i][1], pressRadius(total ? cum[i] / total : 0));
        tip = dense[i];
    }
    ctx.restore();
    return tip;
}
function drawNib(stroke, tip, u) {
    ctx.save();
    applyGlyphTransform();
    ctx.clip(stroke.outline);
    const r = pressRadius(u) * 0.8;
    const grad = ctx.createRadialGradient(tip[0], tip[1], 0, tip[0], tip[1], r);
    grad.addColorStop(0, "rgba(10, 12, 16, 0.95)");
    grad.addColorStop(1, "rgba(10, 12, 16, 0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(tip[0], tip[1], r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}
function easeInOut(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}
function raf() {
    return new Promise((resolve) => requestAnimationFrame(resolve));
}
// 按整字时间线 vt(ms)渲染:已过时间的笔画铺满,正在写的笔画露到对应弧长 + 笔尖。
function renderAt(vt) {
    clearBoard();
    for (const s of strokes) {
        if (vt >= s.t1) {
            stampStroke(s, s.total);
        }
        else if (vt > s.t0) {
            const reveal = easeInOut((vt - s.t0) / (s.t1 - s.t0)) * s.total;
            const tip = stampStroke(s, reveal);
            drawNib(s, tip, s.total ? reveal / s.total : 0);
        }
    }
}
function buildTimeline(data) {
    strokes = data.strokes.map((path, i) => {
        const median = resampleMedian(data.medians[i]);
        return { outline: new Path2D(path), ...median, t0: 0, t1: 0 };
    });
    let cursor = 0;
    strokes.forEach((s, i) => {
        const dur = Math.min(STROKE_MAX_MS, Math.max(STROKE_MIN_MS, s.total * MS_PER_UNIT));
        s.t0 = cursor;
        s.t1 = cursor + dur;
        cursor = s.t1 + (i < strokes.length - 1 ? BETWEEN_STROKES_MS : 0);
    });
    totalVt = strokes.length ? strokes[strokes.length - 1].t1 : 0;
}
// 从头写一遍。paused 翻 true 时时间线冻结,翻回 false 继续(供暂停/继续)。
async function playDemo() {
    if (!strokes.length)
        return;
    const token = ++runToken;
    paused = false;
    demoState = "animating";
    setPlayGlyph("pause");
    let vt = 0;
    let last = performance.now();
    while (vt < totalVt) {
        if (token !== runToken)
            return;
        const now = performance.now();
        if (!paused) {
            vt += now - last;
            renderAt(vt);
        }
        last = now;
        await raf();
    }
    if (token !== runToken)
        return;
    renderAt(totalVt); // 整字留在格子里供照抄
    demoState = "done";
    setPlayGlyph("play");
}
function togglePlayPause() {
    if (!strokes.length)
        return;
    if (demoState === "animating") {
        paused = true;
        demoState = "paused";
        setPlayGlyph("play");
    }
    else if (demoState === "paused") {
        paused = false;
        demoState = "animating";
        setPlayGlyph("pause");
    }
    else {
        // idle / done -> 从头重写
        void playDemo();
    }
}
function setPlayGlyph(mode) {
    playPauseBtn.classList.toggle("is-pause", mode === "pause");
    playPauseBtn.setAttribute("aria-label", mode === "pause" ? "暂停笔顺" : "播放笔顺");
    playPauseBtn.title = mode === "pause" ? "暂停笔顺" : "播放笔顺";
}
function speakOnce(text) {
    if (!text)
        return;
    window.lastSpeech = text; // headless 听不到 TTS,e2e 靠这个断言播报内容
    if (!("speechSynthesis" in window))
        return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "zh-CN";
    utterance.rate = 0.9;
    window.speechSynthesis.speak(utterance);
}
function resetToIdle() {
    runToken++;
    strokes = [];
    totalVt = 0;
    currentChar = "";
    currentContext = "";
    clearBoard();
    demoState = "idle";
    setPlayGlyph("play");
    // 回到空态:唯一动作重新变成"按住说话",次级控件收起、引导语回来
    boardHint.hidden = false;
    boardControls.hidden = true;
}
// 回声消歧:识别到字后把语境词读回去(「城,小城夏天的城」)。孩子不认识
// 屏幕上的字,听语境词对不对是他唯一能校验同音字错误的通道;顺带让多音字
// 在词里读出正确读音。
async function loadCharacter(char, context = "") {
    if (!char)
        return;
    let data;
    try {
        data = await loadCharacterData(char);
    }
    catch {
        resetToIdle();
        speakOnce("网络好像不太好，等一下再试吧。");
        return;
    }
    if (!data || !data.strokes) {
        resetToIdle();
        speakOnce("这个字还没找到，换一个吧。");
        return;
    }
    currentChar = char;
    currentContext = context;
    document.title = `${char} · 跟我写`;
    buildTimeline(data);
    // 格子里有字了,"再看/再听"才有意义,此时才亮出次级控件
    boardHint.hidden = true;
    boardControls.hidden = false;
    speakOnce(buildSpeechText(char, context));
    void playDemo();
}
const MIC_IDLE_LABEL = "按住说要写的字";
// 语音输入按可用性选引擎:录音+云端理解(主) -> Web Speech(降级) -> 禁用+打字框。
// 决策记录见 docs/tech/voice-pipeline-research.md 第 1 节降级链。
async function setupVoiceInput() {
    if (recordingSupported() && (await probeUnderstandApi())) {
        setupRecorderInput();
        return;
    }
    setupSpeechRecognitionInput();
}
// 主引擎:按住录音,松手发理解服务,拿 {char, context} 进主循环。
function setupRecorderInput() {
    const recorder = new HoldRecorder();
    let holding = false;
    const startListening = (event) => {
        event.preventDefault();
        if (holding)
            return;
        holding = true;
        micBtn.classList.add("is-listening");
        micLabel.textContent = "在听…";
        recorder.start().catch(() => {
            holding = false;
            micBtn.classList.remove("is-listening");
            micLabel.textContent = "麦克风用不了，检查一下授权";
        });
    };
    const stopListening = () => {
        if (!holding)
            return;
        holding = false;
        micBtn.classList.remove("is-listening");
        micLabel.textContent = "在想…";
        void finishRecording();
    };
    async function finishRecording() {
        try {
            const wav = await recorder.stop();
            if (!wav)
                return; // 误触/太短,静默复位
            const { char, context } = await requestUnderstand(wav);
            if (char) {
                await loadCharacter(char, context);
            }
            else {
                speakOnce("没听清要写哪个字，再说一遍吧。");
            }
        }
        catch {
            speakOnce("网络好像不太好，等一下再试吧。");
        }
        finally {
            micLabel.textContent = MIC_IDLE_LABEL;
        }
    }
    micBtn.addEventListener("pointerdown", startListening);
    micBtn.addEventListener("pointerup", stopListening);
    micBtn.addEventListener("pointercancel", stopListening);
    micBtn.addEventListener("pointerleave", stopListening);
}
// 降级引擎:浏览器 Web Speech(Edge/海外 Chrome 可用,大陆 Chrome 不可用)。
function setupSpeechRecognitionInput() {
    const SpeechRecognitionCtor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
        micBtn.disabled = true;
        micLabel.textContent = "这个浏览器不支持语音";
        return;
    }
    const recognition = new SpeechRecognitionCtor();
    recognition.lang = "zh-CN";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    let holding = false;
    const startListening = (event) => {
        event.preventDefault();
        if (holding)
            return;
        holding = true;
        micBtn.classList.add("is-listening");
        micLabel.textContent = "在听…";
        try {
            recognition.start();
        }
        catch {
            // start() 在上一次还没结束时会抛,忽略即可
        }
    };
    const stopListening = () => {
        if (!holding)
            return;
        holding = false;
        micBtn.classList.remove("is-listening");
        micLabel.textContent = MIC_IDLE_LABEL;
        recognition.stop();
    };
    micBtn.addEventListener("pointerdown", startListening);
    micBtn.addEventListener("pointerup", stopListening);
    micBtn.addEventListener("pointercancel", stopListening);
    micBtn.addEventListener("pointerleave", stopListening);
    recognition.addEventListener("result", (event) => {
        const { char, context } = extractTargetCharacter(event.results[0][0].transcript);
        if (char) {
            void loadCharacter(char, context);
        }
        else {
            speakOnce("没听清要写哪个字，再说一遍吧。");
        }
    });
    recognition.addEventListener("error", () => {
        micBtn.classList.remove("is-listening");
        micLabel.textContent = MIC_IDLE_LABEL;
        holding = false;
    });
}
// 测试入口:?test 时显示打字框,绕过语音直接查字。
function setupTestInput() {
    if (!new URLSearchParams(location.search).has("test"))
        return;
    testInput.hidden = false;
    testInput.addEventListener("keydown", (event) => {
        if (event.key !== "Enter")
            return;
        const { char, context } = extractTargetCharacter(testInput.value);
        if (char)
            void loadCharacter(char, context);
    });
}
playPauseBtn.addEventListener("click", togglePlayPause);
speakBtn.addEventListener("click", () => speakOnce(buildSpeechText(currentChar, currentContext)));
// 模块作用域不再自动挂全局,显式暴露 e2e 测试钩子(headless 无麦克风)。
window.loadCharacter = loadCharacter;
void setupVoiceInput();
setupTestInput();
