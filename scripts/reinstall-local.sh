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

# Clean up stale endpoints
rm -f "$HOME/.local/run/opencode-manager/endpoints.json"

echo "[2/6] Removing global installation..."
bun remove -g opencode-manager 2>/dev/null || true

echo "[3/6] Installing dependencies..."
cd "$REPO_DIR"
pnpm install

echo "[4/6] Building backend and frontend..."
pnpm build

echo "[5/6] Installing globally from local repo..."
cd "$REPO_DIR"
# Update the dist tarballs with fresh builds
# Tarballs should contain backend/dist and frontend/dist paths
tar -czf backend-dist.tar.gz backend/dist
tar -czf frontend-dist.tar.gz frontend/dist

# Use npm pack to create tarball, then install from it (avoids bun workspace issues)
npm pack --quiet
TARBALL="$REPO_DIR/$(ls -t opencode-manager-*.tgz | head -1)"
echo "Installing from $TARBALL..."
bun install -g "$TARBALL"
rm -f "$TARBALL"

echo "[6/6] Installing and starting service..."
opencode-manager install-service

echo ""
echo "=== Waiting for service to be ready (max 90s) ==="

AUTH_FILE="$HOME/.local/run/opencode-manager/auth.json"
if [ -f "$AUTH_FILE" ]; then
  AUTH_CREDS=$(jq -r '"\(.username):\(.password)"' "$AUTH_FILE")
  CURL_AUTH="-u $AUTH_CREDS"
else
  CURL_AUTH=""
fi

for i in {1..30}; do
  if curl -sf $CURL_AUTH http://localhost:5001/api/health | grep -q '"status":"healthy"'; then
    echo ""
    echo "=== Service is healthy! ==="
    curl -s $CURL_AUTH http://localhost:5001/api/health | jq .
    
    # Wait a bit for tunnel to establish and print endpoints
    echo ""
    echo "=== Waiting for tunnel (max 30s) ==="
    ENDPOINTS_FILE="$HOME/.local/run/opencode-manager/endpoints.json"
    for j in {1..10}; do
      if [ -f "$ENDPOINTS_FILE" ] && jq -e '.endpoints[] | select(.type == "tunnel")' "$ENDPOINTS_FILE" > /dev/null 2>&1; then
        echo ""
        echo "=== Endpoints ==="
        TUNNEL_URL=$(jq -r '.endpoints[] | select(.type == "tunnel") | .url' "$ENDPOINTS_FILE" | tail -1)
        LOCAL_URL=$(jq -r '.endpoints[] | select(.type == "local") | .url' "$ENDPOINTS_FILE" | tail -1)
        echo "Local:  $LOCAL_URL"
        echo "Tunnel: $TUNNEL_URL"
        exit 0
      fi
      echo -n "."
      sleep 3
    done
    
    echo ""
    echo "=== Tunnel not available yet, check with: opencode-manager status ==="
    exit 0
  fi
  echo -n "."
  sleep 3
done

echo ""
echo "=== Service did not become healthy in time ==="
opencode-manager status
exit 1
