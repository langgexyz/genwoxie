// 仲裁触发判据单测:分歧签名 = omni 判的字不在 ASR 转写里。
import test from "node:test";
import assert from "node:assert/strict";

import { needsArbitration } from "../server/understand.ts";

const CASES: readonly [name: string, transcript: string, char: string, want: boolean][] = [
  ["真实错例签名:蝉不在转写里 -> 触发", "小城夏天的城怎么说?", "蝉", true],
  ["两路一致 -> 不触发", "小城夏天的城怎么说?", "城", false],
  ["同音字都在转写里 -> 不触发", "怎么写成", "成", false],
  ["转写为空(ASR 挂了) -> 不触发,无证据可仲裁", "", "城", false],
  ["char 为空(没听清) -> 不触发,走引导", "小城夏天", "", false],
];

for (const [name, transcript, char, want] of CASES) {
  test(`needsArbitration:${name}`, () => {
    assert.equal(needsArbitration(transcript, char), want);
  });
}
