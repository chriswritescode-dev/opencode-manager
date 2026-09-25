#!/bin/bash

opencode_arch_suffix() {
  local arch
  arch="$(uname -m | sed 's/x86_64/x64/; s/aarch64/arm64/')"
  if ls /lib/ld-musl-* >/dev/null 2>&1; then
    arch="${arch}-musl"
  fi
  printf '%s\n' "$arch"
}

opencode_download_url() {
  local version="$1" suffix="${2:-}"
  [ -n "$suffix" ] || suffix="$(opencode_arch_suffix)"
  printf 'https://opencode.ai/files/bin/%s/opencode-linux-%s.tar.gz\n' "$version" "$suffix"
}

is_stable_opencode_version() {
  printf '%s\n' "$1" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'
}

version_gte() {
  printf '%s\n%s\n' "$2" "$1" | sort -V -C
}

is_supported_opencode_version() {
  local version="$1"
  is_stable_opencode_version "$version" || return 1
  [ -n "${OPENCODE_SUPPORTED_FLOOR:-}" ] || return 1
  [ "${version%%.*}" = "${OPENCODE_SUPPORTED_FLOOR%%.*}" ] || return 1
  version_gte "$version" "$OPENCODE_SUPPORTED_FLOOR"
}

supported_opencode_range() {
  [ -n "${OPENCODE_SUPPORTED_FLOOR:-}" ] || return 1
  printf '>=%s <%s.0.0\n' "$OPENCODE_SUPPORTED_FLOOR" "$(( ${OPENCODE_SUPPORTED_FLOOR%%.*} + 1 ))"
}

download_opencode_to() {
  local version="$1" destination="$2" staging
  if [ -z "$version" ]; then
    echo "ERROR: no OpenCode version provided; refusing to guess the pinned build" >&2
    return 1
  fi
  if ! is_stable_opencode_version "$version"; then
    echo "ERROR: OpenCode version '$version' is not an X.Y.Z version; refusing to download it" >&2
    return 1
  fi
  staging="$(mktemp -d)"
  if ! curl -fsSL "$(opencode_download_url "$version")" -o "$staging/opencode.tar.gz"; then
    echo "ERROR: failed to download OpenCode ${version}" >&2
    rm -rf "$staging"
    return 1
  fi
  if ! tar -xzf "$staging/opencode.tar.gz" -C "$staging"; then
    echo "ERROR: failed to extract OpenCode ${version}" >&2
    rm -rf "$staging"
    return 1
  fi
  mkdir -p "$(dirname "$destination")"
  mv "$staging/opencode" "$destination"
  chmod 755 "$destination"
  rm -rf "$staging"
}
