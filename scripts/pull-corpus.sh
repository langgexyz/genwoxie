#!/usr/bin/env bash
# 把线上收集的语音语料(童声,个人数据,不进公开 repo)拉回本地 .cache/corpus/。
set -euo pipefail
DEST=".cache/corpus"
mkdir -p "$DEST"
rsync -az ccdirect:/opt/genwoxie-data/ "$DEST/"
COUNT=$(ls "$DEST"/*.json 2>/dev/null | wc -l | tr -d " ")
echo "ok: 语料 ${COUNT} 条 -> $DEST"
