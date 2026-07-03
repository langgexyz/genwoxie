// 毛笔沙沙声:Web Audio 合成,零素材零依赖。
// 原理:循环噪声缓冲 -> 带通滤波(纸笔摩擦的频段) -> 增益随笔画提按调制
// (粗笔画重按声音略沉厚,收笔尖锋渐轻),笔画间隙静音。
// AudioContext 惰性创建且必须发生在用户手势链里(iOS 自动播放策略)。
const FILTER_FREQ = 3600; // 摩擦声主频段(Hz)
const RAMP = 0.04; // 音量趋近时间常数(s),避免咔哒
export class BrushSound {
    ctx = null;
    gain = null;
    failed = false;
    // 在用户手势链里调用;失败(不支持/被策略拒)则静默降级为无声
    ensure() {
        if (this.ctx || this.failed) {
            void this.ctx?.resume().catch(() => { });
            return;
        }
        try {
            const ctx = new AudioContext();
            const noise = ctx.createBufferSource();
            const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate); // 1s 噪声,循环
            const data = buf.getChannelData(0);
            // 近似粉噪:白噪一阶低通,比纯白噪更接近纸面摩擦
            let last = 0;
            for (let i = 0; i < data.length; i++) {
                const white = Math.random() * 2 - 1;
                last = 0.96 * last + 0.04 * white;
                data[i] = last * 6;
            }
            noise.buffer = buf;
            noise.loop = true;
            const filter = ctx.createBiquadFilter();
            filter.type = "bandpass";
            filter.frequency.value = FILTER_FREQ;
            filter.Q.value = 0.7;
            const gain = ctx.createGain();
            gain.gain.value = 0;
            noise.connect(filter).connect(gain).connect(ctx.destination);
            noise.start();
            this.ctx = ctx;
            this.gain = gain;
            void ctx.resume().catch(() => { });
        }
        catch {
            this.failed = true; // 无声降级,不影响主流程
        }
    }
    // level 0-1:0=静音,书写中按提按深浅调制
    set(level) {
        if (!this.ctx || !this.gain)
            return;
        window.brushLevel = level; // 测试钩子:headless 听不到声音,e2e 靠这个断言
        this.gain.gain.setTargetAtTime(level, this.ctx.currentTime, RAMP);
    }
    stop() {
        this.set(0);
    }
}
