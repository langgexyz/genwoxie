// 话术提取单测表:孩子的真实说法 -> 期望的 {char, context}。
// 跑法: npm test (先 build,再对构建产物 dist/ 跑,顺带守住 dist 与源码不漂移)
import test from "node:test";
import assert from "node:assert/strict";

import { extractTargetCharacter, buildSpeechText, type ExtractResult } from "../dist/extract.js";

const CASES: readonly [input: string, char: string, context: string][] = [
  // 「语境词的X…写」:最标准的问法,语境词用于消歧
  ["小城夏天的城怎么写", "城", "小城夏天"],
  ["城市的城怎么写", "城", "城市"],
  ["长大的长怎么写", "长", "长大"],
  ["妈妈的妈妈字怎么写", "妈", "妈妈"],
  // 「语境词的X」结尾,没说"写"
  ["妈妈的妈", "妈", "妈妈"],
  ["月亮的月", "月", "月亮"],
  ["写字的字", "字", "写字"],
  // 语境词带口头填充词,要剥掉
  ["就是那个飞机的飞怎么写", "飞", "飞机"],
  // 「写(一个)X」
  ["写一个大", "大", ""],
  ["怎么写城", "城", ""],
  ["帮我写个火", "火", ""],
  ["我想写水字", "水", ""],
  ["请写一下月亮的月", "月", "月亮"],
  // 「X(字)(怎么)写」
  ["城怎么写", "城", ""],
  ["城字怎么写", "城", ""],
  ["水咋写", "水", ""],
  // 说的是词:取首字,整词当语境
  ["飞机怎么写", "飞", "飞机"],
  // 裸字 / 裸词兜底
  ["大", "大", ""],
  ["一", "一", ""],
  // 负向:取不到字
  ["", "", ""],
  ["hello", "", ""],
  ["写", "", ""],
  ["怎么写", "", ""],
];

for (const [input, char, context] of CASES) {
  test(`extract(${JSON.stringify(input)}) -> ${char || "(空)"}/${context || "(无语境)"}`, () => {
    const expected: ExtractResult = { char, context };
    assert.deepEqual(extractTargetCharacter(input), expected);
  });
}

test("buildSpeechText:有语境词读「字,语境的字」", () => {
  assert.equal(buildSpeechText("城", "小城夏天"), "城，小城夏天的城");
});
test("buildSpeechText:无语境只读字", () => {
  assert.equal(buildSpeechText("大", ""), "大");
});
test("buildSpeechText:语境词等于字本身时退化为只读字", () => {
  assert.equal(buildSpeechText("城", "城"), "城");
});
test("buildSpeechText:无字返回空", () => {
  assert.equal(buildSpeechText("", ""), "");
});
