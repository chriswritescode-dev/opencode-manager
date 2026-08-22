#!/bin/bash
set -e

export HOME=/home/node
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$HOME/.opencode/bin:/usr/local/bin:$PATH"

source /usr/local/lib/ocm/container-user.sh

grant_kvm_access() {
  local dev="${1:-/dev/kvm}"
  [ -e "$dev" ] || return 0

  local dev_gid group_name holder
  dev_gid="$(stat -c '%g' "$dev" 2>/dev/null)" || return 0
  case "$dev_gid" in
    ''|*[!0-9]*) return 0 ;;
  esac

  holder="$(getent group "$dev_gid" 2>/dev/null | cut -d: -f1 || true)"
  if [ -n "$holder" ]; then
    group_name="$holder"
  else
    group_name="kvm"
    if ! groupadd -g "$dev_gid" "$group_name"; then
      echo "ERROR: could not create group '$group_name' (gid $dev_gid) required for $dev access" >&2
      return 1
    fi
  fi

  if ! usermod -aG "$group_name" node; then
    echo "ERROR: could not add node to group '$group_name' (gid $dev_gid) required for $dev access" >&2
    return 1
  fi

  if ! runuser -u node -- test -r "$dev" || ! runuser -u node -- test -w "$dev"; then
    echo "ERROR: node cannot access $dev (group '$group_name', gid $dev_gid)" >&2
    echo "ERROR: grant the container group access to $dev or run the sandbox overlay (docker-compose.sandbox.yml)" >&2
    return 1
  fi

  echo "Granted node access to $dev (group '$group_name', gid $dev_gid)"
}

MIN_OPENCODE_VERSION="1.0.137"

version_gte() {
  printf '%s\n%s\n' "$2" "$1" | sort -V -C
}

install_opencode() {
  local opencode_version="${OPENCODE_BUNDLED_VERSION:-}"
  if [ -z "$opencode_version" ]; then
    echo "ERROR: OPENCODE_BUNDLED_VERSION is not set; refusing to guess the pinned OpenCode build" >&2
    return 1
  fi
  if [[ ! "$opencode_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "ERROR: OPENCODE_BUNDLED_VERSION='$opencode_version' is not an X.Y.Z version; refusing to download it" >&2
    return 1
  fi
  if ! version_gte "$opencode_version" "$MIN_OPENCODE_VERSION"; then
    echo "ERROR: OPENCODE_BUNDLED_VERSION=$opencode_version is below the minimum supported $MIN_OPENCODE_VERSION; refusing to download it" >&2
    return 1
  fi
  echo "Installing OpenCode ${opencode_version}..."
  local staging
  staging="$(mktemp -d)"
  curl -fsSL "https://github.com/anomalyco/opencode/releases/download/v${opencode_version}/opencode-linux-$(uname -m | sed 's/x86_64/x64/; s/aarch64/arm64/').tar.gz" \
    -o "$staging/opencode.tar.gz"
  tar -xzf "$staging/opencode.tar.gz" -C "$staging"
  mkdir -p "$HOME/.opencode/bin"
  mv "$staging/opencode" "$HOME/.opencode/bin/opencode"
  chmod 755 "$HOME/.opencode/bin/opencode"
  rm -rf "$staging"
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
    echo "Reinstalling bundled OpenCode version ${OPENCODE_BUNDLED_VERSION}..."
    install_opencode

    OPENCODE_VERSION=$(opencode --version 2>&1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || echo "unknown")
    echo "OpenCode reinstalled as version: $OPENCODE_VERSION"
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

if ! align_container_user node; then
  exit 1
fi

if ! grant_kvm_access; then
  echo "WARNING: continuing without /dev/kvm access; agent sandboxing will report itself unavailable" >&2
fi

warn_if_workspace_owner_differs /workspace "$OCM_TARGET_UID" "$OCM_TARGET_GID"

mkdir -p /app/data /workspace /home/node/.cache /home/node/.opencode /home/node/.microsandbox
chown -R node:node /app/data /workspace /home/node

exec runuser -u node -- "$@"
