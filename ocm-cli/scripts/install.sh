#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cli="$root/dist/ocm.js"

if [ ! -f "$cli" ]; then
  echo "ocm: $cli not found; build the package first (pnpm --filter @opencode-manager/ocm-cli build)" >&2
  exit 1
fi

exec node "$cli" install "$@"
