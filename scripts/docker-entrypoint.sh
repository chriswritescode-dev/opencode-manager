#!/bin/bash
set -e

export HOME=/home/node
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$HOME/.opencode/bin:$HOME/.local/bin:$PATH"

echo "🔍 Checking Bun installation..."

if ! command -v bun >/dev/null 2>&1; then
  echo "❌ Bun not found. Installing..."
  curl -fsSL https://bun.sh/install | bash
  
  if ! command -v bun >/dev/null 2>&1; then
    echo "❌ Failed to install Bun. Exiting."
    exit 1
  fi
  
  echo "✅ Bun installed successfully"
else
  BUN_VERSION=$(bun --version 2>&1 || echo "unknown")
  echo "✅ Bun is installed (version: $BUN_VERSION)"
fi

echo "🔍 Checking OpenCode installation..."

if ! command -v opencode >/dev/null 2>&1; then
  echo "⚠️  OpenCode not found in PATH"
else
  OPENCODE_VERSION=$(opencode --version 2>&1 || echo "unknown")
  echo "✅ OpenCode is installed (version: $OPENCODE_VERSION)"
fi

echo "🚀 Starting OpenCode WebUI Backend..."

exec "$@"
