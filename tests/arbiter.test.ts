// GPT 裁判失败时保守回退策略的单测:一致才用 omni,分歧宁可空(请孩子重说)。
import test from "node:test";
import assert from "node:assert/strict";

import { fallbackWithoutJudge, isSilentWav, parseArbiterVerdict } from "../server/understand.ts";

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

function makeWav(amplitude: number, n = 1600): Uint8Array {
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const ascii = (o: number, t: string) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  ascii(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); ascii(8, "WAVE"); ascii(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 16000, true); v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  ascii(36, "data"); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.round(Math.sin(i / 5) * amplitude), true);
  return new Uint8Array(buf);
}

test("isSilentWav:底噪级振幅判静音(语料标定 rms<=42)", () => {
  assert.equal(isSilentWav(makeWav(60)), true);
});
test("isSilentWav:真语音级振幅放行(最弱真语音 rms=491)", () => {
  assert.equal(isSilentWav(makeWav(4000)), false);
});
test("isSilentWav:非 RIFF 数据放行(守卫只拦确凿静音)", () => {
  assert.equal(isSilentWav(new Uint8Array([1, 2, 3, 4])), false);
});
