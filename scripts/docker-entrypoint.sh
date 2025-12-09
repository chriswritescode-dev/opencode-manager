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

MIN_OPENCODE_VERSION="1.0.137"

version_gte() {
  printf '%s\n%s\n' "$2" "$1" | sort -V -C
}

if ! command -v opencode >/dev/null 2>&1; then
  echo "⚠️  OpenCode not found. Installing..."
  curl -fsSL https://opencode.ai/install | bash
  
  if ! command -v opencode >/dev/null 2>&1; then
    echo "❌ Failed to install OpenCode. Exiting."
    exit 1
  fi
  echo "✅ OpenCode installed successfully"
fi

OPENCODE_VERSION=$(opencode --version 2>&1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || echo "unknown")
echo "✅ OpenCode is installed (version: $OPENCODE_VERSION)"

if [ "$OPENCODE_VERSION" != "unknown" ]; then
  if version_gte "$OPENCODE_VERSION" "$MIN_OPENCODE_VERSION"; then
    echo "✅ OpenCode version meets minimum requirement (>=$MIN_OPENCODE_VERSION)"
  else
    echo "⚠️  OpenCode version $OPENCODE_VERSION is below minimum required version $MIN_OPENCODE_VERSION"
    echo "🔄 Upgrading OpenCode..."
    opencode upgrade || curl -fsSL https://opencode.ai/install | bash
    
    OPENCODE_VERSION=$(opencode --version 2>&1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || echo "unknown")
    echo "✅ OpenCode upgraded to version: $OPENCODE_VERSION"
  fi
fi

echo "🚀 Starting OpenCode WebUI Backend..."

exec "$@"
