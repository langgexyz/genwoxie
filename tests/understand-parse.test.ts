// 模型脏输出的 JSON 鲁棒提取单测:用例形态来自 M0 实测翻车现场
// (代码块包裹/前后缀说明文字/非 JSON 输出)。
import test from "node:test";
import assert from "node:assert/strict";

import { extractJsonObject } from "../server/understand.ts";

const CASES: readonly [name: string, input: string, char: string, context: string][] = [
  ["纯 JSON", '{"char":"城","context":"小城夏天"}', "城", "小城夏天"],
  ["带换行缩进", '{\n  "char": "城",\n  "context": "小城夏天"\n}', "城", "小城夏天"],
  ["代码块包裹", '```json\n{"char":"张","context":"弓长张"}\n```', "张", "弓长张"],
  ["前后缀说明文字", '好的,结果如下:{"char":"李","context":"木子李"} 请查收', "李", "木子李"],
  ["完全不是 JSON", "这段音频听不清楚", "", ""],
  ["空字符串", "", "", ""],
  ["JSON 但缺字段", '{"char":"水"}', "水", ""],
  ["JSON 但字段类型错", '{"char":123,"context":null}', "", ""],
  ["坏 JSON", '{"char":"城","context":', "", ""],
];

for (const [name, input, char, context] of CASES) {
  test(`extractJsonObject:${name}`, () => {
    assert.deepEqual(extractJsonObject(input), { char, context });
  });
}
