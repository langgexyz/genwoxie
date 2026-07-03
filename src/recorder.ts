// 按住说话的录音器:getUserMedia + MediaRecorder 录原生格式
// (iOS 出 mp4/aac,Android 出 webm/opus),松手后 decodeAudioData 解码、
// OfflineAudioContext 重采样为 16k 单声道,encodeWavPcm16 编成 wav 上传。
// 统一转 wav 的原因:抹平双端格式分裂 + Qwen-Omni 格式列表无 webm。

import { encodeWavPcm16 } from "./wav.js";

const TARGET_RATE = 16000;
const MIN_DURATION_S = 0.3; // 手滑误触不上传

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  // webm/opus 优先:Chrome 对 audio/mp4 的 isTypeSupported 会答 true 但产物
  // 依赖平台编码器,实测 headless 下录出坏文件;Safari 不支持 webm,自然落到 mp4。
  for (const t of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return ""; // 交给浏览器默认
}

export function recordingSupported(): boolean {
  return !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
}

export class HoldRecorder {
  private stream: MediaStream | null = null;
  // 会话序号:每次按下自增,贯穿整个异步生命周期——慢启动(授权/高负载可达秒级)
  // 期间用户再次按下时,旧会话在每个 await 后都会发现自己已过期并自我作废,
  // 否则旧录音器被误当成新一轮的(实测:两轮全部静默流产)。
  private session = 0;
  private active: { recorder: MediaRecorder; chunks: Blob[] } | null = null;
  private starting: Promise<void> | null = null;

  // 按下:拿麦克风(首次会弹授权)并开录。授权被拒/无设备会抛,调用方给用户提示。
  async start(): Promise<void> {
    const mySession = ++this.session;
    // 等上一轮的 start 落定再动手(不能早退:早退会让本轮误以为已在录)
    while (this.starting) {
      try {
        await this.starting;
      } catch {
        // 上一轮的失败不归本轮
      }
    }
    if (mySession !== this.session) return; // 等待期间又有新按下,本轮让位
    this.abandonActive(); // 上一轮没松手就再按的残留录音器,丢弃
    const p = this.doStart(mySession);
    this.starting = p;
    try {
      await p;
    } finally {
      if (this.starting === p) this.starting = null;
    }
  }

  private async doStart(mySession: number): Promise<void> {
    this.stream ??= await navigator.mediaDevices.getUserMedia({ audio: true });
    if (mySession !== this.session) return; // 慢启动期间已换轮,不再开录
    const chunks: Blob[] = []; // 按会话闭包隔离,不与旧会话共享
    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined);
    recorder.addEventListener("dataavailable", (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    });
    recorder.start();
    this.active = { recorder, chunks };
  }

  // 松手:停录并归一成 wav。换轮/太短/没录上返回 null。
  async stop(): Promise<Blob | null> {
    const mySession = this.session;
    if (this.starting) {
      try {
        await this.starting; // 等本轮 start 落定,见 start() 注释
      } catch {
        return null;
      }
    }
    if (mySession !== this.session) return null; // 等待期间已换轮
    const active = this.active;
    this.active = null;
    if (!active) return null;

    await new Promise<void>((resolve) => {
      active.recorder.addEventListener("stop", () => resolve(), { once: true });
      active.recorder.stop();
    });
    const raw = new Blob(active.chunks, { type: active.recorder.mimeType });
    if (raw.size === 0) return null;
    return this.toWav(raw);
  }

  private abandonActive(): void {
    if (!this.active) return;
    try {
      this.active.recorder.stop();
    } catch {
      // 已经停了就算了
    }
    this.active = null;
  }

  private async toWav(raw: Blob): Promise<Blob | null> {
    const ctx = new AudioContext();
    try {
      let decoded: AudioBuffer;
      try {
        decoded = await ctx.decodeAudioData(await raw.arrayBuffer());
      } catch {
        return null; // 录音数据坏(编码器问题等),按"没录到"处理而非网络错误
      }
      if (decoded.duration < MIN_DURATION_S) return null;
      const offline = new OfflineAudioContext(
        1,
        Math.ceil(decoded.duration * TARGET_RATE),
        TARGET_RATE,
      );
      const source = offline.createBufferSource();
      source.buffer = decoded;
      source.connect(offline.destination);
      source.start();
      const rendered = await offline.startRendering();
      return new Blob([encodeWavPcm16(rendered.getChannelData(0), TARGET_RATE)], {
        type: "audio/wav",
      });
    } finally {
      void ctx.close();
    }
  }
}
