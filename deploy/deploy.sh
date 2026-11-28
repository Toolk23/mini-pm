#!/usr/bin/env bash
# Обновить стенд: собрать фронт локально, залить на сервер, подтянуть бэкенд из GitHub, перезапустить.
# Запуск с машины разработчика: deploy/deploy.sh [root@77.233.220.24]
# Ключи (.env) на сервер копируются один раз вручную: scp .env root@HOST:/opt/mini-pm/.env
set -euo pipefail
HOST="${1:-root@77.233.220.24}"
KEY="${SSH_KEY:-$HOME/.ssh/minipm_yc}"
cd "$(dirname "$0")/.."
(cd frontend && npm ci --silent && npm run build)
rsync -az --delete -e "ssh -i $KEY" frontend/dist/ "$HOST:/opt/mini-pm/frontend/dist/"
ssh -i "$KEY" "$HOST" 'cd /opt/mini-pm && git pull -q && .venv/bin/pip install -q -r requirements.txt && systemctl restart minipm && sleep 8 && curl -s localhost:8000/api/health | head -c 120; echo'
