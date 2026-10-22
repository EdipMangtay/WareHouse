#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
PYTHON_BIN="${TWIN_PYTHON:-$ROOT_DIR/apps/api/.venv/bin/python}"
"$PYTHON_BIN" -m pytest tests apps/api/tests -q
npm --prefix apps/web test
npm --prefix apps/web run build
"$PYTHON_BIN" scripts/export_contracts.py --check
