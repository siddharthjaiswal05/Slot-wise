#!/usr/bin/env bash
# Build course data from the Excel file (if it's newer) and serve SlotWise locally.
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-8765}"
DATA="web/data/courses.json"
XLSX="$(ls -t ./*.xlsx 2>/dev/null | head -n1 || true)"

if [[ -n "$XLSX" ]]; then
  if [[ ! -f "$DATA" || "$XLSX" -nt "$DATA" || scripts/build_data.py -nt "$DATA" ]]; then
    python3 -I scripts/build_data.py "$XLSX"
  fi
elif [[ ! -f "$DATA" ]]; then
  echo "No .xlsx course schedule in $(pwd) and no $DATA to fall back on" >&2
  exit 1
fi

echo "SlotWise running at http://localhost:$PORT  (Ctrl+C to stop)"
if [[ "${OPEN:-1}" == "1" ]] && command -v open >/dev/null; then
  (sleep 1 && open "http://localhost:$PORT") &
fi
exec python3 -I -m http.server "$PORT" --bind 127.0.0.1 --directory web
