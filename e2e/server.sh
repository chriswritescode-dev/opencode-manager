#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$ROOT/e2e/.tmp"

rm -rf "$TMP"
mkdir -p "$TMP/home" "$TMP/data" "$TMP/workspace" "$TMP/tmp" "$TMP/run"

cd "$ROOT"
exec bun run backend/dist/index.js
