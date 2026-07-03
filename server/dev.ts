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

import { understandAudio } from "./understand.ts";

const PORT = Number(process.env["PORT"] ?? 8731);
const MOCK = process.env["MOCK_UNDERSTAND"] === "1";
const API_KEY = process.env["DASHSCOPE_API_KEY"] ?? "";
const BASE_URL = process.env["DASHSCOPE_BASE_URL"] ?? "";
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
  try {
    const parsed = JSON.parse(await readBody(req)) as Record<string, unknown>;
    audio = typeof parsed["audio"] === "string" ? parsed["audio"] : "";
    format = typeof parsed["format"] === "string" ? parsed["format"] : "wav";
  } catch {
    sendJson(res, 400, { error: "请求体必须是 JSON,含 base64 的 audio 字段" });
    return;
  }
  if (!audio) {
    sendJson(res, 400, { error: "缺少 audio 字段" });
    return;
  }
  if (MOCK) {
    sendJson(res, 200, { char: "城", context: "小城夏天" });
    return;
  }
  try {
    const result = await understandAudio(audio, format, { apiKey: API_KEY, baseUrl: BASE_URL });
    if (CORPUS_DIR) void saveCorpus(audio, format, result);
    sendJson(res, 200, result);
  } catch (e) {
    console.error("error: understand 调用失败:", e instanceof Error ? e.message : e);
    sendJson(res, 502, { error: "模型服务暂时不可用" });
  }
}

// 语料落盘:同名 wav+json 一对;expected 字段初值取模型输出,人工纠错时改 json 即可。
async function saveCorpus(
  audioB64: string,
  format: string,
  result: { char: string; context: string },
): Promise<void> {
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await mkdir(CORPUS_DIR, { recursive: true });
    await writeFile(join(CORPUS_DIR, `${stamp}.${format}`), Buffer.from(audioB64, "base64"));
    await writeFile(
      join(CORPUS_DIR, `${stamp}.json`),
      JSON.stringify({ expected: result.char, model: result, format, savedAt: stamp }, null, 2),
    );
  } catch (e) {
    console.error("warning: 语料落盘失败(不影响主流程):", e instanceof Error ? e.message : e);
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
    res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" });
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
