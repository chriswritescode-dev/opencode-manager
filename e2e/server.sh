#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$ROOT/e2e/.tmp"

rm -rf "$TMP"
mkdir -p "$TMP/home" "$TMP/data" "$TMP/workspace" "$TMP/tmp" "$TMP/run"
trap 'rm -rf "$TMP"' EXIT

cd "$ROOT"
bun run backend/dist/index.js &
BACKEND_PID=$!
trap 'kill -TERM "$BACKEND_PID" 2>/dev/null || true' TERM INT
wait "$BACKEND_PID" || wait "$BACKEND_PID"
