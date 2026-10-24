#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$ROOT/e2e/.tmp"

rm -rf "$TMP"
mkdir -p "$TMP/home" "$TMP/data" "$TMP/workspace" "$TMP/tmp" "$TMP/run" "$TMP/app"
ln -s "$ROOT/frontend" "$TMP/app/frontend"
trap 'rm -rf "$TMP"' EXIT

if [[ -z "${E2E_SERVER_ENV_KEYS:-}" ]]; then
  echo "E2E_SERVER_ENV_KEYS is empty; refusing to start the E2E backend" >&2
  exit 1
fi

args=()
for key in $E2E_SERVER_ENV_KEYS; do
  args+=("$key=${!key}")
done

cd "$TMP/app"
env -i PATH="$PATH" "${args[@]}" bun --no-env-file run "$ROOT/backend/dist/index.js" &
BACKEND_PID=$!
trap 'kill -TERM "$BACKEND_PID" 2>/dev/null || true' TERM INT
wait "$BACKEND_PID" || wait "$BACKEND_PID"
