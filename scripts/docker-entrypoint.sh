#!/bin/bash
set -e

export HOME=/home/node
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$HOME/.opencode/bin:/usr/local/bin:$PATH"

install_opencode() {
  echo "Installing OpenCode latest..."
  curl -fsSL "https://github.com/anomalyco/opencode/releases/latest/download/opencode-linux-$(uname -m | sed 's/x86_64/x64/; s/aarch64/arm64/').tar.gz" \
    -o /tmp/opencode.tar.gz
  tar -xzf /tmp/opencode.tar.gz -C /tmp
  mkdir -p "$HOME/.opencode/bin"
  mv /tmp/opencode "$HOME/.opencode/bin/opencode"
  chmod 755 "$HOME/.opencode/bin/opencode"
  rm -f /tmp/opencode.tar.gz
}

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

echo "Checking OpenCode installation..."

MIN_OPENCODE_VERSION="1.0.137"

version_gte() {
  printf '%s\n%s\n' "$2" "$1" | sort -V -C
}

if ! command -v opencode >/dev/null 2>&1; then
  echo "OpenCode not found. Installing..."
  install_opencode

  if ! command -v opencode >/dev/null 2>&1; then
    echo "Failed to install OpenCode. Exiting."
    exit 1
  fi
  echo "OpenCode installed successfully"
fi

OPENCODE_VERSION=$(opencode --version 2>&1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || echo "unknown")
echo "OpenCode is installed (version: $OPENCODE_VERSION)"

if [ "$OPENCODE_VERSION" != "unknown" ]; then
  if version_gte "$OPENCODE_VERSION" "$MIN_OPENCODE_VERSION"; then
    echo "OpenCode version meets minimum requirement (>=$MIN_OPENCODE_VERSION)"
  else
    echo "OpenCode version $OPENCODE_VERSION is below minimum required version $MIN_OPENCODE_VERSION"
    echo "Upgrading OpenCode..."
    opencode upgrade || install_opencode

    OPENCODE_VERSION=$(opencode --version 2>&1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || echo "unknown")
    echo "OpenCode upgraded to version: $OPENCODE_VERSION"
  fi
fi

echo "Starting OpenCode Manager Backend..."

if [ -z "$AUTH_SECRET" ]; then
  echo "AUTH_SECRET is required but not set"
  echo ""
  echo "Please set AUTH_SECRET environment variable with a secure random string."
  echo "Generate one with: openssl rand -base64 32"
  echo ""
  echo "Example in docker-compose.yml:"
  echo "  environment:"
  echo "    - AUTH_SECRET=your-secure-random-secret-here"
  echo ""
  echo "Example with Docker run:"
  echo "  docker run -e AUTH_SECRET=\$(openssl rand -base64 32) ..."
  echo ""
  exit 1
fi

mkdir -p /app/data /workspace /home/node/.cache /home/node/.opencode
chown -R node:node /app/data /workspace /home/node

if [ -S /var/run/docker.sock ]; then
  DOCKER_GID=$(stat -c '%g' /var/run/docker.sock)
  EXISTING_GROUP=$(getent group "$DOCKER_GID" | cut -d: -f1 || true)
  if [ -n "$EXISTING_GROUP" ]; then
    DOCKER_GROUP="$EXISTING_GROUP"
  else
    DOCKER_GROUP="dockerhost"
    groupadd -g "$DOCKER_GID" "$DOCKER_GROUP"
  fi
  usermod -aG "$DOCKER_GROUP" node
fi

exec runuser -u node -- "$@"
