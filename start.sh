#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [[ ! -x "$ROOT_DIR/backend/.venv/bin/python" || ! -d "$ROOT_DIR/frontend/node_modules" ]]; then
  echo 'Önce README.tr.md içindeki bağımlılık kurulumu adımlarını çalıştırın.' >&2
  exit 1
fi
PRESET="${1:-${TWIN_LAYOUT_PRESET:-large}}"
case "$PRESET" in small|medium|large|mega|legacy) ;; *) echo 'Depo boyutu: small, medium, large, mega veya legacy' >&2; exit 1 ;; esac
# Never change geometry while an older backend/frontend still owns the application ports.
if lsof -nP -iTCP:8000 -iTCP:5173 -sTCP:LISTEN >/dev/null 2>&1; then
  echo '8000 veya 5173 portu kullanımda. Çalışan start.sh oturumunu durdurup yeniden başlatın.' >&2
  exit 1
fi
"$ROOT_DIR/backend/.venv/bin/python" "$ROOT_DIR/scripts/select_layout.py" "$PRESET"
export TWIN_LAYOUT_PRESET="$PRESET"
BACKEND_PID=''
FRONTEND_PID=''
cleanup() {
  [[ -z "$BACKEND_PID" ]] || kill "$BACKEND_PID" 2>/dev/null || true
  [[ -z "$FRONTEND_PID" ]] || kill "$FRONTEND_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM
(cd "$ROOT_DIR/backend" && exec .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000) &
BACKEND_PID=$!
(cd "$ROOT_DIR/frontend" && exec npm run dev -- --host 127.0.0.1 --strictPort) &
FRONTEND_PID=$!
echo 'WareTwin: http://localhost:5173 · API: http://127.0.0.1:8000/docs'
while kill -0 "$BACKEND_PID" 2>/dev/null && kill -0 "$FRONTEND_PID" 2>/dev/null; do
  sleep 1
done
