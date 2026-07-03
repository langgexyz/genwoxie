// 「跟我写」:语音查字 -> 毛笔沿中线一笔一笔写出来 -> 写完留在格子里供照抄。
//
// 字形数据用 hanzi-writer 的真实楷体轮廓(strokes)+ 中线(medians),
// 自己用 canvas 当毛笔渲染:近实心墨沿中线运笔、轮廓裁剪保证范字形状利落、
// 起收笔提按、按笔画长短的书写速度、可播放/暂停。
//
// 坐标:字形在 1024x1024 字面坐标(y 向上),映射到 640 田字格:
//   translate(PADDING, BOARD-PADDING) 后 scale(SCALE, -SCALE),之后都在字面坐标里画。

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

const canvas = document.querySelector("#inkCanvas");
const ctx = canvas.getContext("2d");
const playPauseBtn = document.querySelector("#playPauseBtn");
const speakBtn = document.querySelector("#speakBtn");
const micBtn = document.querySelector("#micBtn");
const micLabel = micBtn.querySelector(".mic-label");
const testInput = document.querySelector("#testInput");

const dpr = window.devicePixelRatio || 1;
canvas.width = BOARD * dpr;
canvas.height = BOARD * dpr;

let currentChar = "";
let strokes = []; // {outline, dense, cum, total, t0, t1}
let totalVt = 0; // 整字书写时间线总长(ms)
let runToken = 0; // 每次重写自增,旧动画看到 token 变了就退出
let paused = false;
// idle: 还没字 / animating: 正在写 / paused: 写到一半停 / done: 整字已留在格子里
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
      if (dense.length) total += Math.hypot(x - dense[dense.length - 1][0], y - dense[dense.length - 1][1]);
      dense.push([x, y]);
      cum.push(total);
    }
  }
  const last = points[points.length - 1];
  if (dense.length) total += Math.hypot(last[0] - dense[dense.length - 1][0], last[1] - dense[dense.length - 1][1]);
  dense.push(last);
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
    if (cum[i] > revealLen) break;
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
  return new Promise((r) => requestAnimationFrame(r));
}

// 按整字时间线 vt(ms)渲染:已过时间的笔画铺满,正在写的笔画露到对应弧长 + 笔尖。
function renderAt(vt) {
  clearBoard();
  for (const s of strokes) {
    if (vt >= s.t1) {
      stampStroke(s, s.total);
    } else if (vt > s.t0) {
      const reveal = easeInOut((vt - s.t0) / (s.t1 - s.t0)) * s.total;
      const tip = stampStroke(s, reveal);
      drawNib(s, tip, s.total ? reveal / s.total : 0);
    }
  }
}

function buildTimeline(data) {
  strokes = data.strokes.map((path, i) => {
    const { dense, cum, total } = resampleMedian(data.medians[i]);
    return { outline: new Path2D(path), dense, cum, total, t0: 0, t1: 0 };
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
  if (!strokes.length) return;
  const token = ++runToken;
  paused = false;
  demoState = "animating";
  setPlayGlyph("pause");
  let vt = 0;
  let last = performance.now();
  while (vt < totalVt) {
    if (token !== runToken) return;
    const now = performance.now();
    if (!paused) {
      vt += now - last;
      renderAt(vt);
    }
    last = now;
    await raf();
  }
  if (token !== runToken) return;
  renderAt(totalVt); // 整字留在格子里供照抄
  demoState = "done";
  setPlayGlyph("play");
}

function togglePlayPause() {
  if (!strokes.length) return;
  if (demoState === "animating") {
    paused = true;
    demoState = "paused";
    setPlayGlyph("play");
  } else if (demoState === "paused") {
    paused = false;
    demoState = "animating";
    setPlayGlyph("pause");
  } else {
    // idle / done -> 从头重写
    playDemo();
  }
}

function setPlayGlyph(mode) {
  playPauseBtn.classList.toggle("is-pause", mode === "pause");
  playPauseBtn.setAttribute("aria-label", mode === "pause" ? "暂停笔顺" : "播放笔顺");
  playPauseBtn.title = mode === "pause" ? "暂停笔顺" : "播放笔顺";
}

function speakOnce(text) {
  if (!("speechSynthesis" in window) || !text) return;
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
  clearBoard();
  demoState = "idle";
  setPlayGlyph("play");
}

async function loadCharacter(char) {
  if (!char || !window.HanziWriter) return;
  currentChar = char;
  document.title = `${char} · 跟我写`;

  let data;
  try {
    data = await window.HanziWriter.loadCharacterData(char);
  } catch {
    resetToIdle();
    speakOnce("这个字还没找到，换一个吧。");
    return;
  }
  if (!data || !data.strokes) {
    resetToIdle();
    speakOnce("这个字还没找到，换一个吧。");
    return;
  }

  buildTimeline(data);
  speakOnce(char);
  playDemo();
}

function setupVoiceInput() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    micBtn.disabled = true;
    micLabel.textContent = "这个浏览器不支持语音";
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = "zh-CN";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  let holding = false;

  const startListening = (event) => {
    event.preventDefault();
    if (holding) return;
    holding = true;
    micBtn.classList.add("is-listening");
    micLabel.textContent = "在听…";
    try {
      recognition.start();
    } catch {
      // start() 在上一次还没结束时会抛,忽略即可
    }
  };

  const stopListening = () => {
    if (!holding) return;
    holding = false;
    micBtn.classList.remove("is-listening");
    micLabel.textContent = "按住说要写的字";
    recognition.stop();
  };

  micBtn.addEventListener("pointerdown", startListening);
  micBtn.addEventListener("pointerup", stopListening);
  micBtn.addEventListener("pointercancel", stopListening);
  micBtn.addEventListener("pointerleave", stopListening);

  recognition.addEventListener("result", (event) => {
    const { char } = window.GWX.extractTargetCharacter(event.results[0][0].transcript);
    if (char) {
      loadCharacter(char);
    } else {
      speakOnce("没听清要写哪个字，再说一遍吧。");
    }
  });

  recognition.addEventListener("error", () => {
    micBtn.classList.remove("is-listening");
    micLabel.textContent = "按住说要写的字";
    holding = false;
  });
}

// 测试入口:?test 时显示打字框,绕过语音直接查字。
function setupTestInput() {
  if (!new URLSearchParams(location.search).has("test")) return;
  testInput.hidden = false;
  testInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    const { char } = window.GWX.extractTargetCharacter(testInput.value);
    if (char) loadCharacter(char);
  });
}

playPauseBtn.addEventListener("click", togglePlayPause);
speakBtn.addEventListener("click", () => speakOnce(currentChar || ""));

setupVoiceInput();
setupTestInput();
