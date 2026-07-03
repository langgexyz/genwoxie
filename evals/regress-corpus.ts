// 语料全量回测器:把收集的每条真实录音重放过当前识别管线,对账标签。
//
// 判分规则:
//   1. 普通条目: 返回 char === expected
//   2. 人名类(json note 含"人名",单发不可判): 给出最优猜测且复核标 weak
//      (触发追问)即通过
//   3. expected 为自动预填(无 note 的人工痕迹)会在报告标注"未核标",
//      其通过仅代表与当时输出一致,不代表真值——回测前尽量人工核标
//
// 跑法:
//   1. 起真实模式 server(含 ARBITER_*): 见 deploy/.env.example
//   2. BASE_URL=http://localhost:8731 CORPUS=.cache/corpus \
//      node --experimental-strip-types evals/regress-corpus.ts
// 退出码: 0=全过, 1=有失败

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const BASE_URL = process.env["BASE_URL"] ?? "http://localhost:8731";
const CORPUS = process.env["CORPUS"] ?? ".cache/corpus";

interface CorpusMeta {
  expected?: string;
  note?: string;
  transcript?: string;
}

interface UnderstandResponse {
  char?: string;
  context?: string;
  auditId?: string;
}

interface AuditResponse {
  status?: string;
  agree?: boolean | null;
  weak?: boolean;
}

async function understand(wavPath: string): Promise<{ res: UnderstandResponse; ms: number; audit: AuditResponse | null }> {
  const audio = (await readFile(wavPath)).toString("base64");
  const t0 = Date.now();
  const r = await fetch(`${BASE_URL}/api/understand`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ audio, format: "wav" }),
  });
  if (!r.ok) throw new Error(`understand HTTP ${r.status}`);
  const res = (await r.json()) as UnderstandResponse;
  const ms = Date.now() - t0;

  let audit: AuditResponse | null = null;
  if (res.auditId) {
    for (let i = 0; i < 10; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const a = (await (await fetch(`${BASE_URL}/api/audit?id=${encodeURIComponent(res.auditId)}`)).json()) as AuditResponse;
      if (a.status === "done") {
        audit = a;
        break;
      }
    }
  }
  return { res, ms, audit };
}

const files = (await readdir(CORPUS)).filter((f) => f.endsWith(".json")).sort();
let pass = 0;
let weakPass = 0;
let unverified = 0;
const failures: string[] = [];
const latencies: number[] = [];

for (const jf of files) {
  const meta = JSON.parse(await readFile(join(CORPUS, jf), "utf-8")) as CorpusMeta;
  const expected = meta.expected ?? "";
  const humanVerified = (meta.note ?? "").includes("人工");
  if (!humanVerified) unverified++;
  const isNameCase = (meta.note ?? "").includes("人名");
  try {
    const { res, ms, audit } = await understand(join(CORPUS, jf.replace(/\.json$/, ".wav")));
    latencies.push(ms);
    const got = res.char ?? "";
    const weak = audit?.weak === true;
    if (got === expected) {
      pass++;
      console.log(`PASS ${(ms / 1000).toFixed(1)}s 期望[${expected}] -> [${got}]${weak ? " weak" : ""}${humanVerified ? "" : " (未核标)"}`);
    } else if (isNameCase && weak) {
      weakPass++;
      console.log(`PASS(weak追问) ${(ms / 1000).toFixed(1)}s 期望[${expected}] -> [${got}]`);
    } else {
      failures.push(`${jf}: 期望[${expected}] -> [${got}]${weak ? " weak" : ""}`);
      console.log(`FAIL ${(ms / 1000).toFixed(1)}s 期望[${expected}] -> [${got}]`);
    }
  } catch (e) {
    failures.push(`${jf}: ${e instanceof Error ? e.message : String(e)}`);
    console.log(`ERR ${jf}: ${e instanceof Error ? e.message : e}`);
  }
}

latencies.sort((a, b) => a - b);
const n = files.length;
const p = (q: number): string => ((latencies[Math.min(Math.floor(latencies.length * q), latencies.length - 1)] ?? 0) / 1000).toFixed(1);
console.log(`\n===== 回测报告 =====`);
console.log(`总计 ${n}: 通过 ${pass + weakPass} (${Math.floor(((pass + weakPass) * 100) / n)}%) = 字正确 ${pass} + 人名类正确追问 ${weakPass}; 失败 ${failures.length}`);
console.log(`延迟 p50=${p(0.5)}s p90=${p(0.9)}s; 未人工核标 ${unverified} 条(其通过=与当时输出一致,非真值)`);
for (const f of failures) console.log(`失败: ${f}`);
process.exit(failures.length === 0 ? 0 : 1);
