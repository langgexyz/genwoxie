#!/usr/bin/env bash
# 部署 genwoxie 到 ccdirect(https://ccdirect.dev/xie/)。
# 前提:服务器已按 deploy/docker-compose.yml 头部注释完成首次部署。
# 流程 = 服务器 git pull --ff-only + compose up -d + 容器内健康检查 + 线上健康检查。
set -euo pipefail

echo "== 服务器拉取并重建容器"
ssh ccdirect 'cd /opt/genwoxie && git pull --ff-only && cd deploy && docker compose up -d --wait 2>/dev/null || docker compose up -d'

echo "== 容器健康(服务器本地)"
ssh ccdirect 'sleep 2 && curl -sf http://127.0.0.1:8850/api/health'
echo

echo "== 线上健康(公网经 nginx)"
curl -sf https://ccdirect.dev/xie/api/health
echo
echo "ok: 部署完成 https://ccdirect.dev/xie/"
