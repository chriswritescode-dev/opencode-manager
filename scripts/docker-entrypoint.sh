#!/bin/bash
set -e

export HOME=/home/node
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$HOME/.opencode/bin:/usr/local/bin:$PATH"

OPENCODE_FORK_REPO="${OPENCODE_FORK_REPO:-}"
OPENCODE_FORK_BRANCH="${OPENCODE_FORK_BRANCH:-main}"
OPENCODE_DIR="$HOME/.opencode-src"

echo "Checking Bun installation..."

if ! command -v bun >/dev/null 2>&1; then
  echo "Bun not found. Installing..."
  curl -fsSL https://bun.sh/install | bash
  
  if ! command -v bun >/dev/null 2>&1; then
    echo "Failed to install Bun. Exiting."
    exit 1
  fi
  
  echo "Bun installed successfully"
else
  BUN_VERSION=$(bun --version 2>&1 || echo "unknown")
  echo "Bun is installed (version: $BUN_VERSION)"
fi

install_from_fork() {
  echo "Installing OpenCode from fork: $OPENCODE_FORK_REPO (branch: $OPENCODE_FORK_BRANCH)"
  
  local ORIG_DIR=$(pwd)
  
  if [ -d "$OPENCODE_DIR" ]; then
    echo "Updating existing clone..."
    cd "$OPENCODE_DIR"
    git fetch origin
    git checkout "$OPENCODE_FORK_BRANCH"
    git pull origin "$OPENCODE_FORK_BRANCH"
  else
    echo "Cloning repository..."
    git clone --depth 1 --branch "$OPENCODE_FORK_BRANCH" "https://github.com/$OPENCODE_FORK_REPO.git" "$OPENCODE_DIR"
    cd "$OPENCODE_DIR"
  fi
  
  echo "Installing dependencies..."
  bun install
  
  echo "Building OpenCode (single target for current platform)..."
  cd packages/opencode
  bun run build --single
  
  # Find the built binary (opencode-linux-x64 or opencode-linux-arm64)
  ARCH=$(uname -m)
  if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
    BINARY_NAME="opencode-linux-arm64"
  else
    BINARY_NAME="opencode-linux-x64"
  fi
  
  BINARY_PATH="$OPENCODE_DIR/packages/opencode/dist/$BINARY_NAME/bin/opencode"
  
  if [ -f "$BINARY_PATH" ]; then
    mkdir -p "$HOME/.opencode/bin"
    cp "$BINARY_PATH" "$HOME/.opencode/bin/opencode"
    chmod +x "$HOME/.opencode/bin/opencode"
    echo "OpenCode installed from fork successfully"
  else
    echo "ERROR: Built binary not found at $BINARY_PATH"
    ls -la "$OPENCODE_DIR/packages/opencode/dist/" 2>/dev/null || echo "dist directory not found"
    cd "$ORIG_DIR"
    exit 1
  fi
  
  cd "$ORIG_DIR"
}

install_official() {
  echo "Installing official OpenCode..."
  # Unset GITHUB_ACTIONS to prevent the install script from trying to write to $GITHUB_PATH
  # which doesn't exist inside Docker containers even when running in CI
  GITHUB_ACTIONS= curl -fsSL https://opencode.ai/install | bash
}

echo "Checking OpenCode installation..."

MIN_OPENCODE_VERSION="1.0.137"

version_gte() {
  printf '%s\n%s\n' "$2" "$1" | sort -V -C
}

if [ -n "$OPENCODE_FORK_REPO" ]; then
  install_from_fork
elif ! command -v opencode >/dev/null 2>&1; then
  echo "OpenCode not found. Installing..."
  install_official
  
  if ! command -v opencode >/dev/null 2>&1; then
    echo "Failed to install OpenCode. Exiting."
    exit 1
  fi
  echo "OpenCode installed successfully"
fi

if command -v opencode >/dev/null 2>&1; then
  OPENCODE_VERSION=$(opencode --version 2>&1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || echo "unknown")
  echo "OpenCode is installed (version: $OPENCODE_VERSION)"

  if [ -z "$OPENCODE_FORK_REPO" ] && [ "$OPENCODE_VERSION" != "unknown" ]; then
    if version_gte "$OPENCODE_VERSION" "$MIN_OPENCODE_VERSION"; then
      echo "OpenCode version meets minimum requirement (>=$MIN_OPENCODE_VERSION)"
    else
      echo "OpenCode version $OPENCODE_VERSION is below minimum required version $MIN_OPENCODE_VERSION"
      echo "Upgrading OpenCode..."
      opencode upgrade || install_official
      
      OPENCODE_VERSION=$(opencode --version 2>&1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || echo "unknown")
      echo "OpenCode upgraded to version: $OPENCODE_VERSION"
    fi
  fi
fi

echo "Starting OpenCode Manager Backend..."

exec "$@"
