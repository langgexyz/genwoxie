// 浏览器环境的补充声明:测试钩子 + lib.dom 还没收录的 Web Speech 识别 API。

// SpeechRecognition 仍是带前缀的实验 API,lib.dom.d.ts 未收录,这里只声明用到的最小面。
interface GwxSpeechRecognitionEvent {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
}

interface GwxSpeechRecognition {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  addEventListener(type: "result", listener: (event: GwxSpeechRecognitionEvent) => void): void;
  addEventListener(type: "error", listener: () => void): void;
}

interface Window {
  SpeechRecognition?: new () => GwxSpeechRecognition;
  webkitSpeechRecognition?: new () => GwxSpeechRecognition;

  // 测试钩子(e2e 用,headless 没麦克风/听不到 TTS):
  loadCharacter: (char: string, context?: string) => Promise<void>;
  lastSpeech?: string;
}
