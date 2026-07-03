#!/usr/bin/env bash
# 语料回放:把 .cache/corpus/ 里每条录音灌假麦克风走全链路(e2e/voice-replay.ts),
# 期望字取同名 json 的 expected 字段(初值=当时模型输出,人工纠错请改 json)。
# 前提:mock 或真实模式 dev server 在跑;BASE_URL 可覆盖(默认 http://localhost:8731)。
set -euo pipefail
DIR="${1:-.cache/corpus}"
PASS=0; FAIL=0
for wav in "$DIR"/*.wav; do
  [ -e "$wav" ] || { echo "usage: 先 scripts/pull-corpus.sh 拉语料"; exit 2; }
  json="${wav%.wav}.json"
  expected=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['expected'])" "$json")
  if REPLAY_WAV="$wav" REPLAY_CHAR="$expected" node --experimental-strip-types e2e/voice-replay.ts >/dev/null 2>&1; then
    PASS=$((PASS+1)); echo "PASS $expected  $(basename "$wav")"
  else
    FAIL=$((FAIL+1)); echo "FAIL $expected  $(basename "$wav")"
  fi
done
echo "回放: $PASS pass / $FAIL fail"
[ "$FAIL" -eq 0 ]
