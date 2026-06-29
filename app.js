const BOARD_SIZE = 640;

const board = document.querySelector("#writingBoard");
const playPauseBtn = document.querySelector("#playPauseBtn");
const speakBtn = document.querySelector("#speakBtn");
const micBtn = document.querySelector("#micBtn");
const micLabel = micBtn.querySelector(".mic-label");

let writer = null;
let currentChar = "";
// idle: 还没字 / animating: 正在演示 / paused: 演示中暂停 / done: 整字已留在格子里
let demoState = "idle";

function extractTargetCharacter(text) {
  const cleanText = text.trim();
  const possessiveMatch = cleanText.match(/的(\p{Script=Han})(?=[^，。！？,.!?]*写)/u);
  if (possessiveMatch) return possessiveMatch[1];

  const directMatch = cleanText.match(/(\p{Script=Han})(?:字)?(?:怎么|咋|如何|怎样)?写/u);
  if (directMatch) return directMatch[1];

  const chineseChars = [...cleanText].filter((char) => /\p{Script=Han}/u.test(char));
  return chineseChars[0] || "";
}

function loadCharacter(char) {
  if (!char || !window.HanziWriter) return;
  currentChar = char;
  document.title = `${char} · 跟我写`;

  removeWriterLayers();
  writer = HanziWriter.create("writingBoard", char, {
    width: BOARD_SIZE,
    height: BOARD_SIZE,
    padding: 50,
    showCharacter: false,
    showOutline: true,
    strokeColor: "#243241",
    outlineColor: "rgba(36, 50, 65, 0.16)",
    strokeAnimationSpeed: 0.38,
    delayBetweenStrokes: 850,
    radicalColor: "#243241",
    onLoadCharDataError: () => {
      demoState = "idle";
      currentChar = "";
      setPlayGlyph("play");
      speakOnce("这个字还没找到，换一个吧。");
    },
  });

  speakOnce(char);
  playDemo();
}

function removeWriterLayers() {
  [...board.querySelectorAll("g")].forEach((group) => group.remove());
}

async function playDemo() {
  if (!writer) return;
  demoState = "animating";
  setPlayGlyph("pause");
  await writer.hideCharacter({ duration: 0 });
  await writer.animateCharacter({
    onComplete: () => {
      // 演示完整字留在格子里供照抄
      demoState = "done";
      setPlayGlyph("play");
    },
  });
}

function togglePlayPause() {
  if (!writer) return;
  if (demoState === "animating") {
    writer.pauseAnimation();
    demoState = "paused";
    setPlayGlyph("play");
  } else if (demoState === "paused") {
    writer.resumeAnimation();
    demoState = "animating";
    setPlayGlyph("pause");
  } else {
    // idle / done -> 从头重放
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
      // start() 在上一次还没结束时会抛，忽略即可
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
    const text = event.results[0][0].transcript;
    const char = extractTargetCharacter(text);
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

playPauseBtn.addEventListener("click", togglePlayPause);
speakBtn.addEventListener("click", () => speakOnce(currentChar || ""));

setupVoiceInput();
