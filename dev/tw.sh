#!/usr/bin/env bash
# Run a JS snippet (an async function body) in the running dev app and print the JSON answer.
#   dev/tw.sh 'return TW.state.doc.cols'      or      dev/tw.sh < snippet.js
# Needs `bun tauri dev` running (the bridge lives in the Vite dev server). TIMEOUT=seconds.
set -euo pipefail
code=${1:-$(cat)}
curl -sS -X POST --data-binary "$code" "http://localhost:5173/__bridge/eval?timeout=${TIMEOUT:-120}"
echo
