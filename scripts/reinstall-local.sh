#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"

echo "=== Reinstalling opencode-manager from local repo ==="
echo "Repo: $REPO_DIR"
echo ""

echo "[1/6] Stopping service..."
opencode-manager stop 2>/dev/null || true
opencode-manager uninstall-service 2>/dev/null || true

echo "[2/6] Removing global installation..."
bun remove -g opencode-manager 2>/dev/null || true

echo "[3/6] Installing dependencies..."
cd "$REPO_DIR"
pnpm install

echo "[4/6] Building backend and frontend..."
pnpm build

echo "[5/6] Installing globally from local repo..."
cd "$REPO_DIR"
bun install -g .

echo "[6/6] Installing and starting service..."
opencode-manager install-service

echo ""
echo "=== Waiting for service to be ready (max 90s) ==="
for i in {1..30}; do
  if curl -sf http://localhost:5001/api/health | grep -q '"status":"healthy"'; then
    echo ""
    echo "=== Service is healthy! ==="
    curl -s http://localhost:5001/api/health | jq .
    exit 0
  fi
  echo -n "."
  sleep 3
done

echo ""
echo "=== Service did not become healthy in time ==="
opencode-manager status
exit 1
