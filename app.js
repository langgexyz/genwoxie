const SVG_NS = "http://www.w3.org/2000/svg";
const BOARD_SIZE = 640;

const board = document.querySelector("#writingBoard");
const traceLayer = document.querySelector("#traceLayer");
const questionInput = document.querySelector("#questionInput");
const loadBtn = document.querySelector("#loadBtn");
const voiceBtn = document.querySelector("#voiceBtn");
const replayBtn = document.querySelector("#replayBtn");
const clearBtn = document.querySelector("#clearBtn");
const finishPanel = document.querySelector("#finishPanel");
const restartBtn = document.querySelector("#restartBtn");

const CHARACTERS = {
  山: { char: "山", pinyin: "shān", meaning: "高山、山坡的山" },
  城: { char: "城", pinyin: "chéng", meaning: "城市、城墙的城" },
  夏: { char: "夏", pinyin: "xià", meaning: "夏天、夏季的夏" },
  天: { char: "天", pinyin: "tiān", meaning: "天空、夏天的天" },
};

let currentData = CHARACTERS["城"];
let writer = null;
let isDemoPlaying = false;
let isDrawing = false;
let tracePoints = [];
let tracePath = null;
let lastSpoken = "";

function createSvgElement(tag, attrs = {}) {
  const element = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, value));
  return element;
}

function extractTargetCharacter(text) {
  const cleanText = text.trim();
  const possessiveMatch = cleanText.match(/的(\p{Script=Han})(?=[^，。！？,.!?]*写)/u);
  if (possessiveMatch) return possessiveMatch[1];

  const directMatch = cleanText.match(/(\p{Script=Han})(?:字)?(?:怎么|咋|如何|怎样)?写/u);
  if (directMatch) return directMatch[1];

  const chineseChars = [...cleanText].filter((char) => /\p{Script=Han}/u.test(char));
  return chineseChars[0] || "城";
}

function setCharacterInfo(data) {
  document.title = `${data.char}怎么写`;
}

function loadCharacter(char) {
  const data = CHARACTERS[char];
  clearTrace();
  finishPanel.hidden = true;

  if (!data) {
    const unknown = { char, pinyin: "待接入", meaning: "这个字还没有动画数据" };
    setCharacterInfo(unknown);
    questionInput.value = `还没有“${char}”的动画数据`;
    return;
  }

  currentData = data;
  setCharacterInfo(data);
  createWriter(data.char);
  playWritingDemo();
}

function createWriter(char) {
  if (!window.HanziWriter) {
    questionInput.value = "写字动画库没有加载成功";
    return;
  }

  removeWriterLayers();
  writer = HanziWriter.create("writingBoard", char, {
    width: BOARD_SIZE,
    height: BOARD_SIZE,
    padding: 50,
    showCharacter: false,
    showOutline: true,
    strokeColor: "#243241",
    outlineColor: "rgba(36, 50, 65, 0.16)",
    drawingColor: "#2563eb",
    strokeAnimationSpeed: 0.38,
    delayBetweenStrokes: 850,
    radicalColor: "#243241",
  });
  board.appendChild(traceLayer);
}

function removeWriterLayers() {
  [...board.querySelectorAll("g")].forEach((group) => {
    if (group.id !== "traceLayer") group.remove();
  });
}

async function playWritingDemo() {
  if (!writer || isDemoPlaying) return;
  isDemoPlaying = true;
  loadBtn.disabled = true;
  replayBtn.disabled = true;
  clearBtn.disabled = true;
  clearTrace();
  speakOnce(`看${currentData.char}怎么写。`);

  await writer.hideCharacter({ duration: 0 });
  await writer.animateCharacter();

  isDemoPlaying = false;
  loadBtn.disabled = false;
  replayBtn.disabled = false;
  clearBtn.disabled = false;
}

function boardPoint(event) {
  const rect = board.getBoundingClientRect();
  const scaleX = BOARD_SIZE / rect.width;
  const scaleY = BOARD_SIZE / rect.height;
  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  };
}

function beginTrace(event) {
  if (!currentData || isDemoPlaying) return;
  finishPanel.hidden = true;
  isDrawing = true;
  tracePoints = [boardPoint(event)];
  tracePath = createSvgElement("path", { class: "trace-line" });
  traceLayer.appendChild(tracePath);
  board.setPointerCapture(event.pointerId);
  event.preventDefault();
}

function moveTrace(event) {
  if (!isDrawing) return;
  tracePoints.push(boardPoint(event));
  tracePath.setAttribute("d", pointsToPath(tracePoints));
  event.preventDefault();
}

function endTrace(event) {
  if (!isDrawing) return;
  isDrawing = false;
  board.releasePointerCapture(event.pointerId);
}

function clearTrace() {
  traceLayer.replaceChildren();
  tracePoints = [];
  tracePath = null;
}

function pointsToPath(points) {
  if (!points.length) return "";
  return points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x} ${point.y}`).join(" ");
}

function resetPractice() {
  clearTrace();
}

function setupVoiceInput() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    voiceBtn.disabled = true;
    voiceBtn.title = "当前浏览器不支持语音输入";
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = "zh-CN";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  voiceBtn.addEventListener("click", () => {
    recognition.start();
  });

  recognition.addEventListener("result", (event) => {
    const text = event.results[0][0].transcript;
    questionInput.value = text;
    loadCharacter(extractTargetCharacter(text));
  });

  recognition.addEventListener("error", () => {
    questionInput.value = "没有听清楚，可以再说一次";
  });
}

function speakOnce(text) {
  if (!("speechSynthesis" in window) || text === lastSpoken) return;
  lastSpoken = text;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "zh-CN";
  utterance.rate = 0.9;
  window.speechSynthesis.speak(utterance);
}

loadBtn.addEventListener("click", () => loadCharacter(extractTargetCharacter(questionInput.value)));
replayBtn.addEventListener("click", playWritingDemo);
clearBtn.addEventListener("click", resetPractice);
restartBtn.addEventListener("click", playWritingDemo);
board.addEventListener("pointerdown", beginTrace);
board.addEventListener("pointermove", moveTrace);
board.addEventListener("pointerup", endTrace);
board.addEventListener("pointercancel", endTrace);

setupVoiceInput();
createWriter(currentData.char);
playWritingDemo();
