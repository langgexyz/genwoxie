// 语音理解核心:录音 base64 -> 百炼 qwen3.5-omni-flash -> {char, context}。
// 平台无关(node fetch),dev server 与未来的 FC 函数共用这一份。
// prompt 为 M0 实测定稿的 v3(few-shot 修掉空猜/JSON 裹字/语境词边界三类错误,
// 数据见 docs/tech/voice-pipeline-research.md 第 8 节)。

export interface UnderstandResult {
  char: string;
  context: string;
}

export interface UnderstandConfig {
  apiKey: string;
  baseUrl: string; // 如 https://ws-xxx.cn-beijing.maas.aliyuncs.com
  model?: string;
  // 可选仲裁层:omni 结果与 ASR 转写不一致时,请文本大模型按证据链终审。
  arbiter?: ArbiterConfig;
}

export interface ArbiterConfig {
  baseUrl: string; // OpenAI Responses 兼容端点,如 https://ccdirect.dev
  apiKey: string;
  model: string; // 如 gpt-5.5
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

// 仲裁触发判据:omni 判的字没出现在 ASR 转写里 = 两路听感分歧(真实错例
// 「蝉」不在转写「小城夏天的城怎么说」里,正是该签名);转写为空不触发
// (无证据可仲裁);char 为空不触发(产品层走"没听清"引导)。
export function needsArbitration(transcript: string, char: string): boolean {
  if (!transcript || !char) return false;
  return !transcript.includes(char);
}

// 文本仲裁:把 ASR 转写 + omni 判定交给文本大模型终审(证据互相印证,含世界
// 知识如歌名/常用词)。任何失败都返回 null,调用方退回 omni 结果。
export async function arbitrate(
  transcript: string,
  omniResult: UnderstandResult,
  cfg: ArbiterConfig,
): Promise<UnderstandResult | null> {
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
): Promise<UnderstandResult | null> {
  const prompt =
    "中文识字应用:孩子说了句话想让应用写某个汉字,两路识别有分歧,请你终审。\n" +
    `专职语音识别转写:"${transcript.replaceAll('"', "'")}"\n` +
    `音频多模态模型判定:${JSON.stringify(omniResult)}\n` +
    "转写通常更接近逐字发音;多模态模型直接听了音频但可能被噪音误导。结合常用词/" +
    '歌名等世界知识判断孩子最可能要写的字。只返回 JSON:{"char":"单字","context":"语境词,不含 的+目标字"}';
  try {
    const res = await fetch(`${cfg.baseUrl}/v1/responses`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: cfg.model, input: prompt, stream: false }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      output?: { content?: { type?: string; text?: string }[] }[];
    };
    for (const item of data.output ?? []) {
      for (const c of item.content ?? []) {
        if (c.type === "output_text" && c.text) {
          const parsed = extractJsonObject(c.text);
          if (parsed.char) return parsed;
        }
      }
    }
    return null;
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
): Promise<UnderstandResult> {
  let transcript = "";
  try {
    transcript = (await transcribe(audioB64, format, cfg)).trim().slice(0, 100);
  } catch {
    // ASR 挂了退化为纯 omni
  }
  const prompt = transcript
    ? `${UNDERSTAND_PROMPT}\n专职语音识别对这段音频的参考转写(可能有错,与你自己听到的互相印证):"${transcript.replaceAll('"', "'")}"`
    : UNDERSTAND_PROMPT;

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
  const omniResult = extractJsonObject(collectSse(await res.text()));

  // 条件仲裁:两路一致(绝大多数请求)直接返回,不加延迟;分歧才请终审。
  if (cfg.arbiter && needsArbitration(transcript, omniResult.char)) {
    const verdict = await arbitrate(transcript, omniResult, cfg.arbiter);
    if (verdict) return verdict;
  }
  return omniResult;
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
