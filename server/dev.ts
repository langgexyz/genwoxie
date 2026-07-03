// 本地开发服务:静态页 + /api/understand 转发(藏 key)。
// 生产形态是同逻辑的阿里云 FC 函数 + EdgeOne 静态托管,见调研文档;
// dev server 让整条链路在本机闭环,也是 e2e 的被测服务。
//
// 跑法:
//   真实模式: DASHSCOPE_API_KEY=... DASHSCOPE_BASE_URL=https://ws-xxx.cn-beijing.maas.aliyuncs.com npm run dev
//   mock 模式(e2e 用,不出网): MOCK_UNDERSTAND=1 npm run dev
//   PORT 可选,默认 8731

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, normalize, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { arbitrate, understandAudio, type ArbiterConfig, type UnderstandOutcome } from "./understand.ts";

const PORT = Number(process.env["PORT"] ?? 8731);
const MOCK = process.env["MOCK_UNDERSTAND"] === "1";
const API_KEY = process.env["DASHSCOPE_API_KEY"] ?? "";
const BASE_URL = process.env["DASHSCOPE_BASE_URL"] ?? "";
// 仲裁层可选:三个 ARBITER_* 都给了才启用
const ARBITER_URL = process.env["ARBITER_URL"] ?? "";
const ARBITER_KEY = process.env["ARBITER_KEY"] ?? "";
const ARBITER_MODEL = process.env["ARBITER_MODEL"] ?? "";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// 语料收集:设了 CORPUS_DIR 就把每次真实请求的音频+识别结果落盘,
// 作为回放测试/eval 语料(童声正确率没有公开数据,自采语料是核心资产)。
const CORPUS_DIR = process.env["CORPUS_DIR"] ?? "";
const MAX_BODY = 15 * 1024 * 1024;

if (!MOCK && (!API_KEY || !BASE_URL)) {
  console.error("error: 真实模式需要 DASHSCOPE_API_KEY 与 DASHSCOPE_BASE_URL 环境变量");
  console.error("help: mock 模式跑 MOCK_UNDERSTAND=1 npm run dev");
  process.exit(1);
}

// 复核结果表:auditId(=语料时间戳) -> 结论;前端轮询取,容量封顶防泄漏。
type AuditEntry =
  | { status: "pending"; transcript?: string }
  | {
      status: "done";
      agree: boolean | null;
      char?: string;
      context?: string;
      weak?: boolean;
      transcript?: string;
    };
const audits = new Map<string, AuditEntry>();
const AUDITS_MAX = 500;

function setAudit(id: string, entry: AuditEntry): void {
  if (audits.size >= AUDITS_MAX) {
    const oldest = audits.keys().next().value;
    if (oldest) audits.delete(oldest);
  }
  audits.set(id, entry);
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".map": "application/json",
  ".wav": "audio/wav",
};

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        rejectPromise(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolvePromise(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", rejectPromise);
  });
}

async function handleUnderstand(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let audio = "";
  let format = "wav";
  let prev = "";
  try {
    const parsed = JSON.parse(await readBody(req)) as Record<string, unknown>;
    audio = typeof parsed["audio"] === "string" ? parsed["audio"] : "";
    format = typeof parsed["format"] === "string" ? parsed["format"] : "wav";
    prev = typeof parsed["prev"] === "string" ? parsed["prev"] : "";
  } catch {
    sendJson(res, 400, { error: "请求体必须是 JSON,含 base64 的 audio 字段" });
    return;
  }
  if (!audio) {
    sendJson(res, 400, { error: "缺少 audio 字段" });
    return;
  }
  if (MOCK) {
    // mock 也带 auditId,/api/audit 默认回 agree,e2e 可 route 覆盖模拟纠错
    sendJson(res, 200, { char: "城", context: "小城夏天", auditId: "mock-audit" });
    return;
  }
  try {
    // 同步链路只走两路(ASR+omni,约 2s);GPT 不进同步路径(实测经中转 3-9s,
    // user 拍板:两路同步 + GPT 异步复核)。
    // 追问模式:带 prev(上一轮 auditId)时取上一轮转写,两句合并消歧
    const prior = prev ? (audits.get(prev)?.transcript ?? "") : "";
    const outcome = await understandAudio(audio, format, { apiKey: API_KEY, baseUrl: BASE_URL }, prior);
    const auditor =
      ARBITER_URL && ARBITER_KEY && ARBITER_MODEL
        ? { endpoint: ARBITER_URL, apiKey: ARBITER_KEY, model: ARBITER_MODEL }
        : undefined;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const willAudit = !!(CORPUS_DIR && auditor && outcome.transcript && outcome.result.char);
    if (willAudit) setAudit(stamp, { status: "pending", transcript: outcome.transcript });
    sendJson(res, 200, willAudit ? { ...outcome.result, auditId: stamp } : outcome.result);
    if (CORPUS_DIR) void saveCorpusAndAudit(stamp, audio, format, outcome, auditor);
  } catch (e) {
    console.error("error: understand 调用失败:", e instanceof Error ? e.message : e);
    sendJson(res, 502, { error: "模型服务暂时不可用" });
  }
}

// 语料落盘 + GPT 异步复核:已回给用户后 GPT 后台审每一条("两路同错"从沉默
// 错误变成语料里 suspect=true 的待审数据,GPT 100% 参与但零交互延迟)。
async function saveCorpusAndAudit(
  stamp: string,
  audioB64: string,
  format: string,
  outcome: UnderstandOutcome,
  auditor?: ArbiterConfig,
): Promise<void> {
  try {
    await mkdir(CORPUS_DIR, { recursive: true });
    await writeFile(join(CORPUS_DIR, `${stamp}.${format}`), Buffer.from(audioB64, "base64"));

    let audit: Record<string, unknown> = { mode: "off" };
    if (auditor && outcome.transcript && outcome.result.char) {
      const verdict = await arbitrate(outcome.transcript, outcome.result, auditor);
      audit = verdict
        ? verdict.char === outcome.result.char
          ? { mode: "async", agree: true, evidence: verdict.evidence }
          : { mode: "async", agree: false, suspect: true, gpt: verdict }
        : { mode: "async", agree: null };
      // 结论进内存表,前端轮询到后播报提示并切字;同意但证据弱(人名类同音字,
      // 模型不可判)也回传,前端语音引导换说法
      setAudit(
        stamp,
        verdict
          ? verdict.char === outcome.result.char
            ? { status: "done", agree: true, weak: verdict.evidence === "weak" }
            : { status: "done", agree: false, char: verdict.char, context: verdict.context }
          : { status: "done", agree: null },
      );
    }
    await writeFile(
      join(CORPUS_DIR, `${stamp}.json`),
      JSON.stringify(
        {
          expected: outcome.result.char,
          model: outcome.result,
          transcript: outcome.transcript,
          audit,
          format,
          savedAt: stamp,
        },
        null,
        2,
      ),
    );
    if (audit["suspect"]) {
      console.error(
        `warning: GPT 复核分歧 ${stamp}: 已返回 ${outcome.result.char}, GPT 判 ${JSON.stringify(audit["gpt"])}`,
      );
    }
  } catch (e) {
    console.error("warning: 语料落盘/复核失败(不影响主流程):", e instanceof Error ? e.message : e);
  }
}

async function serveStatic(pathname: string, res: ServerResponse): Promise<void> {
  const rel = pathname === "/" ? "/index.html" : pathname;
  const file = normalize(join(ROOT, rel));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, {
      "Content-Type": MIME[extname(file)] ?? "application/octet-stream",
      // no-cache=每次向服务器复核新鲜度(不是不缓存)。此前无任何缓存头,
      // iOS Safari 启发式缓存拿旧 JS,修复发了端上跑的还是老代码。
      // 文件小(全站 <300KB),复核成本可忽略;后续量大再上内容哈希文件名。
      "Cache-Control": "no-cache",
    });
    res.end(data);
  } catch {
    res.writeHead(404).end("not found");
  }
}

createServer((req, res) => {
  const pathname = new URL(req.url ?? "/", `http://localhost:${PORT}`).pathname;
  if (req.method === "GET" && pathname === "/api/health") {
    sendJson(res, 200, { ok: true, mock: MOCK });
    return;
  }
  if (req.method === "GET" && pathname === "/api/audit") {
    const id = new URL(req.url ?? "/", `http://localhost:${PORT}`).searchParams.get("id") ?? "";
    if (MOCK) {
      sendJson(res, 200, { status: "done", agree: true });
      return;
    }
    sendJson(res, 200, audits.get(id) ?? { status: "unknown" });
    return;
  }
  if (req.method === "POST" && pathname === "/api/understand") {
    void handleUnderstand(req, res);
    return;
  }
  if (req.method === "GET") {
    void serveStatic(pathname, res);
    return;
  }
  res.writeHead(405).end();
}).listen(PORT, () => {
  console.log(`ok: dev server http://localhost:${PORT} (${MOCK ? "mock" : "真实模型"})`);
});
