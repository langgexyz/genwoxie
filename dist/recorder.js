// 按住说话的录音器:getUserMedia + MediaRecorder 录原生格式
// (iOS 出 mp4/aac,Android 出 webm/opus),松手后 decodeAudioData 解码、
// OfflineAudioContext 重采样为 16k 单声道,encodeWavPcm16 编成 wav 上传。
// 统一转 wav 的原因:抹平双端格式分裂 + Qwen-Omni 格式列表无 webm。
import { encodeWavPcm16 } from "./wav.js";
const TARGET_RATE = 16000;
const MIN_DURATION_S = 0.3; // 手滑误触不上传
function pickMimeType() {
    if (typeof MediaRecorder === "undefined")
        return "";
    // webm/opus 优先:Chrome 对 audio/mp4 的 isTypeSupported 会答 true 但产物
    // 依赖平台编码器,实测 headless 下录出坏文件;Safari 不支持 webm,自然落到 mp4。
    for (const t of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]) {
        if (MediaRecorder.isTypeSupported(t))
            return t;
    }
    return ""; // 交给浏览器默认
}
export function recordingSupported() {
    return !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
}
export class HoldRecorder {
    stream = null;
    recorder = null;
    starting = null;
    chunks = [];
    // 按下:拿麦克风(首次会弹授权)并开录。授权被拒/无设备会抛,调用方给用户提示。
    // starting 同步落座:授权弹窗期间用户就松手时,stop() 要能等到 start 完成,
    // 否则录音器在 stop 之后才启动,变成永不停止的僵尸录音(headless 实测竞态)。
    async start() {
        if (this.starting || this.recorder)
            return; // 已在起/已在录
        this.starting = this.doStart();
        try {
            await this.starting;
        }
        finally {
            this.starting = null;
        }
    }
    async doStart() {
        this.stream ??= await navigator.mediaDevices.getUserMedia({ audio: true });
        this.chunks = [];
        const mimeType = pickMimeType();
        this.recorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined);
        this.recorder.addEventListener("dataavailable", (e) => {
            if (e.data.size > 0)
                this.chunks.push(e.data);
        });
        this.recorder.start();
    }
    // 松手:停录并归一成 wav。录得太短(误触)返回 null。
    async stop() {
        if (this.starting) {
            try {
                await this.starting; // 等 start 落定再停,见 start() 注释
            }
            catch {
                return null; // 授权被拒等,start 侧已提示
            }
        }
        const recorder = this.recorder;
        if (!recorder)
            return null;
        this.recorder = null;
        await new Promise((resolve) => {
            recorder.addEventListener("stop", () => resolve(), { once: true });
            recorder.stop();
        });
        const raw = new Blob(this.chunks, { type: recorder.mimeType });
        this.chunks = [];
        if (raw.size === 0)
            return null;
        return this.toWav(raw);
    }
    async toWav(raw) {
        const ctx = new AudioContext();
        try {
            let decoded;
            try {
                decoded = await ctx.decodeAudioData(await raw.arrayBuffer());
            }
            catch {
                return null; // 录音数据坏(编码器问题等),按"没录到"处理而非网络错误
            }
            if (decoded.duration < MIN_DURATION_S)
                return null;
            const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * TARGET_RATE), TARGET_RATE);
            const source = offline.createBufferSource();
            source.buffer = decoded;
            source.connect(offline.destination);
            source.start();
            const rendered = await offline.startRendering();
            return new Blob([encodeWavPcm16(rendered.getChannelData(0), TARGET_RATE)], {
                type: "audio/wav",
            });
        }
        finally {
            void ctx.close();
        }
    }
}
