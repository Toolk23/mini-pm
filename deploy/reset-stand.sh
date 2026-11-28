#!/usr/bin/env bash
# Сбросить стенд к чистому состоянию перед записью видео / питчем:
# бэклог, гипотезы, расследования, справки и лог токенов — как в исходных данных (задачи снова с T-09).
set -euo pipefail
HOST="${1:-root@77.233.220.24}"
KEY="${SSH_KEY:-$HOME/.ssh/minipm_yc}"
ssh -i "$KEY" "$HOST" 'systemctl stop minipm && rm -rf /opt/mini-pm-state/* && systemctl start minipm && sleep 10 && curl -s localhost:8000/api/backlog/tasks | python3 -c "import sys,json;print(\"задач в бэклоге:\", len(json.load(sys.stdin)))"'
