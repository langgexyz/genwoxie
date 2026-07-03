// GPT 裁判失败时保守回退策略的单测:一致才用 omni,分歧宁可空(请孩子重说)。
import test from "node:test";
import assert from "node:assert/strict";

import { fallbackWithoutJudge, parseArbiterVerdict } from "../server/understand.ts";

const CASES: readonly [name: string, transcript: string, char: string, wantChar: string][] = [
  ["两路一致 -> 用 omni 结果", "小城夏天的城怎么写?", "城", "城"],
  ["分歧(蝉不在转写) -> 空,请重说", "小城夏天的城怎么说?", "蝉", ""],
  ["转写为空(ASR 挂) -> 空,不敢单信 omni", "", "城", ""],
  ["omni 为空 -> 空", "小城夏天", "", ""],
];

for (const [name, transcript, char, wantChar] of CASES) {
  test(`fallbackWithoutJudge:${name}`, () => {
    const got = fallbackWithoutJudge(transcript, { char, context: "x" });
    assert.equal(got.char, wantChar);
  });
}

const VERDICT_CASES: readonly [name: string, input: string, want: unknown][] = [
  ["强证据", '{"char":"泽","context":"江泽民","evidence":"strong"}', { char: "泽", context: "江泽民", evidence: "strong" }],
  ["弱证据(人名同音字)", '{"char":"溪","context":"余则","evidence":"weak"}', { char: "溪", context: "余则", evidence: "weak" }],
  ["缺 evidence 字段默认 strong", '{"char":"城","context":"小城"}', { char: "城", context: "小城", evidence: "strong" }],
  ["代码块包裹", '```json\n{"char":"熙","context":"康熙","evidence":"weak"}\n```', { char: "熙", context: "康熙", evidence: "weak" }],
  ["char 为空返回 null", '{"char":"","context":"x"}', null],
  ["非 JSON 返回 null", "听不清", null],
];

for (const [name, input, want] of VERDICT_CASES) {
  test(`parseArbiterVerdict:${name}`, () => {
    assert.deepEqual(parseArbiterVerdict(input), want);
  });
}
