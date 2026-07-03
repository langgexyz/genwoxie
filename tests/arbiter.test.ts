// GPT 裁判失败时保守回退策略的单测:一致才用 omni,分歧宁可空(请孩子重说)。
import test from "node:test";
import assert from "node:assert/strict";

import { fallbackWithoutJudge } from "../server/understand.ts";

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
