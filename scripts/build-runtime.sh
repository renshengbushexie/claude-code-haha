#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p bin
EXT=""
case "$(uname -s)" in MINGW*|CYGWIN*|MSYS*) EXT=".exe" ;; esac
echo "building go-runtime..."
( cd go-runtime && go build -o "../bin/oc-runtime${EXT}" ./cmd/runtime )
echo "ok: bin/oc-runtime${EXT}"
