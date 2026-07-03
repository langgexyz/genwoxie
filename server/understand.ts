// 语音理解核心:录音 base64 -> 百炼 qwen3.5-omni-flash -> {char, context}。
// 平台无关(node fetch),dev server 与未来的 FC 函数共用这一份。
// prompt 为 M0 实测定稿的 v3(few-shot 修掉空猜/JSON 裹字/语境词边界三类错误,
// 数据见 docs/tech/voice-pipeline-research.md 第 8 节)。

export interface UnderstandResult {
  char: string;
  context: string;
}

// 完整推理过程:result 回给前端;transcript/arbitrated 供语料落盘与异步审计。
export interface UnderstandOutcome {
  result: UnderstandResult;
  transcript: string;
  arbitrated: boolean;
}

export interface UnderstandConfig {
  apiKey: string;
  baseUrl: string; // 如 https://ws-xxx.cn-beijing.maas.aliyuncs.com
  model?: string;
  // 可选仲裁层:omni 结果与 ASR 转写不一致时,请文本大模型按证据链终审。
  arbiter?: ArbiterConfig;
}

export interface ArbiterConfig {
  // 完整端点 URL,按后缀识别协议形状:
  //   .../v1/responses         -> OpenAI Responses(如 ccdirect 的 GPT)
  //   .../v1/chat/completions  -> OpenAI Chat(如百炼 qwen,同 key 同机房)
  endpoint: string;
  apiKey: string;
  model: string; // 校准结论(2026-07-03):qwen3.7-max 关思考,三案例全对且 1.2s
}

const DEFAULT_MODEL = "qwen3.5-omni-flash";
const ASR_MODEL = "qwen3-asr-flash-2026-02-10";

export const UNDERSTAND_PROMPT = [
  '音频是孩子在问要写哪个汉字。返回 JSON:{"char":"...","context":"..."}',
  "规则:",
  "1. char=要写的单字。必须给出最可能的一个字,即使不完全确定也要猜(同音字按最常用/最可能被孩子问的选);只有音频完全听不出想写字时才空串。",
  "2. 孩子说的是多字词(如 飞机怎么写)时 char 取词的第一个字。",
  '3. context=用来定位目标字的语境词,不含"的+目标字"。',
  "示例:",
  '小城夏天的城怎么写 -> {"char":"城","context":"小城夏天"}',
  '写一个大 -> {"char":"大","context":""}',
  '弓长张的张怎么写 -> {"char":"张","context":"弓长张"}',
  '飞机怎么写 -> {"char":"飞","context":"飞机"}',
  '月亮的月 -> {"char":"月","context":"月亮"}',
  "只输出 JSON,不要任何其他文字。",
].join("\n");

// 裁判结论:字+语境+证据强度。weak=凭音频无法确定同音字(语境是普通人名/
// 无语境裸同音字,如 余泽熙/溪 错例),此类模型不可判,前端语音引导换说法。
export interface ArbiterVerdict extends UnderstandResult {
  evidence: "strong" | "weak";
}

export function parseArbiterVerdict(text: string): ArbiterVerdict | null {
  const match = text.match(/\{[\s\S]*?\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    const char = typeof parsed["char"] === "string" ? parsed["char"] : "";
    if (!char) return null;
    return {
      char,
      context: typeof parsed["context"] === "string" ? parsed["context"] : "",
      evidence: parsed["evidence"] === "weak" ? "weak" : "strong",
    };
  } catch {
    return null;
  }
}

// 16-bit PCM wav 的静音检测:峰值与 RMS 双阈值(标定见 understandAudio 注释)。
// 解析失败(非标准 RIFF)按"有声"放行,守卫只在确凿静音时拦。
export function isSilentWav(buf: Uint8Array): boolean {
  const idx = findDataChunk(buf);
  if (idx < 0) return false;
  const view = new DataView(buf.buffer, buf.byteOffset + idx, buf.byteLength - idx);
  const n = Math.floor(view.byteLength / 2);
  if (n === 0) return true;
  let peak = 0;
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const v = Math.abs(view.getInt16(i * 2, true));
    if (v > peak) peak = v;
    sumSq += v * v;
  }
  const rms = Math.sqrt(sumSq / n);
  return peak < 2500 && rms < 150;
}

function findDataChunk(buf: Uint8Array): number {
  for (let i = 12; i + 8 < buf.length; i++) {
    if (buf[i] === 0x64 && buf[i + 1] === 0x61 && buf[i + 2] === 0x74 && buf[i + 3] === 0x61) {
      return i + 8;
    }
  }
  return -1;
}

// GPT 裁判失败时的保守回退:两路一致才敢用 omni 结果;分歧时宁可返回空
// (前端引导"再说一遍")也不猜——孩子无法自判错误,准确率优先(user 拍板)。
export function fallbackWithoutJudge(transcript: string, omni: UnderstandResult): UnderstandResult {
  if (omni.char && transcript && transcript.includes(omni.char)) return omni;
  return { char: "", context: "" };
}

// 文本仲裁:把 ASR 转写 + omni 判定交给文本大模型终审(证据互相印证,含世界
// 知识如歌名/常用词)。任何失败都返回 null,调用方退回 omni 结果。
export async function arbitrate(
  transcript: string,
  omniResult: UnderstandResult,
  cfg: ArbiterConfig,
): Promise<ArbiterVerdict | null> {
  // 中转站首发常见瞬时 502(实测),重试一次
  for (let attempt = 0; attempt < 2; attempt++) {
    const verdict = await arbitrateOnce(transcript, omniResult, cfg);
    if (verdict) return verdict;
    await new Promise((r) => setTimeout(r, 800));
  }
  return null;
}

async function arbitrateOnce(
  transcript: string,
  omniResult: UnderstandResult,
  cfg: ArbiterConfig,
): Promise<ArbiterVerdict | null> {
  const prompt =
    "中文识字应用:孩子说了句话想让应用写某个汉字,两路独立识别结果如下,请你综合判定。\n" +
    `专职语音识别转写:"${transcript.replaceAll('"', "'")}"\n` +
    `音频多模态模型判定:${JSON.stringify(omniResult)}\n` +
    "两路一致通常可信;分歧时,转写更接近逐字发音,多模态直接听了音频但可能被噪音误导。" +
    "结合常用词/歌名等世界知识判断孩子最可能要写的字;孩子说的是多字词时取第一个字。" +
    "另评估证据强度 evidence:语境是常见词/名人/名作等有判别力的=strong;" +
    "语境本身是普通人名、或没有语境的裸同音字——即凭这段话无法确定是哪个同音字=weak。" +
    '只返回 JSON:{"char":"单字","context":"语境词,不含 的+目标字","evidence":"strong 或 weak"}';
  try {
    const responsesWire = cfg.endpoint.endsWith("/responses");
    const body = responsesWire
      ? { model: cfg.model, input: prompt, stream: false }
      : {
          model: cfg.model,
          messages: [{ role: "user", content: prompt }],
          stream: false,
          // DashScope 混合思考模型:裁判任务不需要长思考,关掉省 10 倍延迟
          // (18s -> 1.2s,校准质量不降);非 DashScope 后端若拒此字段再加开关。
          enable_thinking: false,
        };
    const res = await fetch(cfg.endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    if (responsesWire) {
      const data = (await res.json()) as {
        output?: { content?: { type?: string; text?: string }[] }[];
      };
      for (const item of data.output ?? []) {
        for (const c of item.content ?? []) {
          if (c.type === "output_text" && c.text) {
            const verdict = parseArbiterVerdict(c.text);
            if (verdict) return verdict;
          }
        }
      }
      return null;
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string | null } }[];
    };
    const text = data.choices?.[0]?.message?.content ?? "";
    return text ? parseArbiterVerdict(text) : null;
  } catch {
    return null;
  }
}

// 模型输出可能裹代码块/前后缀文字(M0 实测),鲁棒提取第一个 JSON 对象。
export function extractJsonObject(text: string): UnderstandResult {
  const match = text.match(/\{[\s\S]*?\}/);
  if (!match) return { char: "", context: "" };
  try {
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    return {
      char: typeof parsed["char"] === "string" ? parsed["char"] : "",
      context: typeof parsed["context"] === "string" ? parsed["context"] : "",
    };
  } catch {
    return { char: "", context: "" };
  }
}

// 混合识别:先拿专职 ASR 的逐字转写,再让 omni 结合"自己听到的+参考转写"判定。
// 依据(真实错例实证,2026-07-03 背景噪音案例):噪音下专职 ASR 抗噪强于 omni
// (转写对了"城"),而干净语音下 omni 的同音字消歧强于 ASR(M0 数据)——互补。
// ASR 失败不挡主流程,退化为纯 omni。
async function transcribe(audioB64: string, format: string, cfg: UnderstandConfig): Promise<string> {
  const body = {
    model: ASR_MODEL,
    stream: true,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "input_audio",
            input_audio: { data: `data:audio/${format};base64,${audioB64}`, format },
          },
        ],
      },
    ],
  };
  const res = await fetch(`${cfg.baseUrl}/compatible-mode/v1/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`asr HTTP ${res.status}`);
  return collectSse(await res.text());
}

export async function understandAudio(
  audioB64: string,
  format: string,
  cfg: UnderstandConfig,
  priorTranscript = "", // 追问模式:上一轮(同音字未定)的转写,两句合并消歧
): Promise<UnderstandOutcome> {
  // 默认两路混合(user 实测 28.7s 后拍板弃全同步三路):ASR 转写作参考喂给
  // omni 互相印证(eval 17/18,p50 1.7s,噪音例可修对)。配了 arbiter 才升级
  // 为三路全同步终审(代码保留,配置驱动)。
  // 静音守卫:按音频能量判定,不给模型对空音频幻觉的机会(语料回测实证:
  // 静音被猜成"大")。用真实语料标定:静音 rms<=42/peak<=1134,最弱真语音
  // (超短单字)rms=491/peak=3986,阈值取中留足余量。注意不能用"ASR 转写为空"
  // 当守卫——超短真语音 ASR 也会返回空,但 omni 听得见(语料回测误杀实证)。
  if (format === "wav" && isSilentWav(Buffer.from(audioB64, "base64"))) {
    return { result: { char: "", context: "" }, transcript: "", arbitrated: false };
  }
  const transcript = (await transcribe(audioB64, format, cfg).catch(() => "")).trim().slice(0, 100);
  const omniResult = await omniListen(audioB64, format, cfg, transcript, priorTranscript);

  if (cfg.arbiter) {
    const verdict = await arbitrate(transcript, omniResult, cfg.arbiter);
    if (verdict) return { result: verdict, transcript, arbitrated: true };
    return { result: fallbackWithoutJudge(transcript, omniResult), transcript, arbitrated: false };
  }
  return { result: omniResult, transcript, arbitrated: false };
}

async function omniListen(
  audioB64: string,
  format: string,
  cfg: UnderstandConfig,
  transcript: string,
  priorTranscript = "",
): Promise<UnderstandResult> {
  let prompt = transcript
    ? `${UNDERSTAND_PROMPT}\n专职语音识别对这段音频的参考转写(可能有错,与你自己听到的互相印证):"${transcript.replaceAll('"', "'")}"`
    : UNDERSTAND_PROMPT;
  if (priorTranscript) {
    prompt +=
      `\n重要:上一句孩子问过"${priorTranscript.replaceAll('"', "'")}",那一轮的同音字没能确定。` +
      "这一句很可能是补充描述(比如说了一个带那个字的词)——若是,把两句合并,确定他真正要写的字;" +
      "若这句明显在问一个新的字,则按新问题处理。";
  }

  const body = {
    model: cfg.model ?? DEFAULT_MODEL,
    stream: true, // omni 系列强制流式
    modalities: ["text"],
    messages: [
      {
        role: "user",
        content: [
          {
            type: "input_audio",
            input_audio: { data: `data:audio/${format};base64,${audioB64}`, format },
          },
          { type: "text", text: prompt },
        ],
      },
    ],
  };

  const res = await fetch(`${cfg.baseUrl}/compatible-mode/v1/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`understand upstream HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  // 交互是"松手后一次出结果",无需逐 token 转发:等 SSE 收完再拼装。
  return extractJsonObject(collectSse(await res.text()));
}

function collectSse(raw: string): string {
  const parts: string[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data: ") || trimmed === "data: [DONE]") continue;
    const chunk = JSON.parse(trimmed.slice(6)) as {
      choices?: { delta?: { content?: string | null } }[];
    };
    const content = chunk.choices?.[0]?.delta?.content;
    if (content) parts.push(content);
  }
  return parts.join("");
}
