#!/bin/bash
# Run manually from Finder to start WareTwin in the user's Terminal session.
set -u
ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR" || exit 1

server_pid=''
cleanup() {
  if [[ -n "$server_pid" ]]; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM

./start.sh large &
server_pid=$!
ready=0
for ((attempt=0; attempt<60; attempt++)); do
  if ! kill -0 "$server_pid" 2>/dev/null; then
    break
  fi
  if curl --silent --fail --max-time 1 http://127.0.0.1:8000/api/health >/dev/null 2>&1 &&
     curl --silent --fail --max-time 1 http://127.0.0.1:5173/ >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done

if [[ "$ready" == 1 ]]; then
  open 'http://127.0.0.1:5173/#warehouse'
  echo 'WareTwin çalışıyor. Durdurmak için bu pencerede Ctrl+C tuşlarına basın.'
  wait "$server_pid"
else
  echo 'WareTwin başlatılamadı. Yukarıdaki hata mesajını kontrol edin.'
  read -r -p 'Pencereyi kapatmak için Enter tuşuna basın. ' _
  exit 1
fi
