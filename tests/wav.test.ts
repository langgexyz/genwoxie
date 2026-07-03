// wav 编码器单测:字节级断言 RIFF 结构与量化,不是"没抛异常就算过"。
import test from "node:test";
import assert from "node:assert/strict";

import { encodeWavPcm16 } from "../dist/wav.js";

function ascii(buf: ArrayBuffer, offset: number, len: number): string {
  return new TextDecoder().decode(new Uint8Array(buf, offset, len));
}

test("RIFF/WAVE/fmt/data 四个标记齐全", () => {
  const buf = encodeWavPcm16(new Float32Array([0]), 16000);
  assert.equal(ascii(buf, 0, 4), "RIFF");
  assert.equal(ascii(buf, 8, 4), "WAVE");
  assert.equal(ascii(buf, 12, 4), "fmt ");
  assert.equal(ascii(buf, 36, 4), "data");
});

test("fmt 字段:PCM/单声道/采样率/字节率/位深", () => {
  const buf = encodeWavPcm16(new Float32Array(10), 16000);
  const v = new DataView(buf);
  assert.equal(v.getUint16(20, true), 1); // PCM
  assert.equal(v.getUint16(22, true), 1); // 单声道
  assert.equal(v.getUint32(24, true), 16000);
  assert.equal(v.getUint32(28, true), 32000); // 字节率
  assert.equal(v.getUint16(34, true), 16); // 位深
});

test("总长度与 data 大小 = 44 + n*2", () => {
  const buf = encodeWavPcm16(new Float32Array(100), 16000);
  assert.equal(buf.byteLength, 44 + 200);
  assert.equal(new DataView(buf).getUint32(40, true), 200);
});

test("样本量化:0 / 0.5 / -0.5 / 越界削顶", () => {
  const buf = encodeWavPcm16(new Float32Array([0, 0.5, -0.5, 2, -2]), 16000);
  const v = new DataView(buf);
  assert.equal(v.getInt16(44, true), 0);
  assert.equal(v.getInt16(46, true), 16384);
  // JS Math.round 半数向正方向进位:-16383.5 -> -16383(1 LSB 不对称,音频无感)
  assert.equal(v.getInt16(48, true), -16383);
  assert.equal(v.getInt16(50, true), 32767); // 正向削顶
  assert.equal(v.getInt16(52, true), -32767); // 负向削顶
});

test("空样本:只有 44 字节头", () => {
  const buf = encodeWavPcm16(new Float32Array(0), 16000);
  assert.equal(buf.byteLength, 44);
});
