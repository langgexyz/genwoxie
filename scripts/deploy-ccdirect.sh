#!/usr/bin/env bash
# 部署 genwoxie 到 ccdirect(https://ccdirect.dev/xie/)。
# 前提:服务器已按 deploy/docker-compose.yml 头部注释完成首次部署。
# 流程 = 服务器 git pull --ff-only + compose up -d + 容器内健康检查 + 线上健康检查。
set -euo pipefail

echo "== 服务器拉取并重启容器"
# 代码是 bind mount,compose 配置没变时 up -d 不会重建容器,老进程仍跑老代码——
# 必须显式 restart(实证:混合识别部署后线上仍跑旧逻辑)。
ssh ccdirect 'cd /opt/genwoxie && git pull --ff-only && cd deploy && docker compose up -d && docker compose restart web'

echo "== 容器健康(服务器本地)"
ssh ccdirect 'sleep 2 && curl -sf http://127.0.0.1:8850/api/health'
echo

echo "== 线上健康(公网经 nginx)"
curl -sf https://ccdirect.dev/xie/api/health
echo
echo "ok: 部署完成 https://ccdirect.dev/xie/"
