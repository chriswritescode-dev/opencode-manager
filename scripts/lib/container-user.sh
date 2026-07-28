#!/bin/bash

OCM_TARGET_UID=""
OCM_TARGET_GID=""
OCM_UID_CHANGED=0
OCM_GID_CHANGED=0

resolve_target_ids() {
  OCM_TARGET_UID="${PUID:-1000}"
  OCM_TARGET_GID="${PGID:-1000}"

  case "$OCM_TARGET_UID" in
    ''|*[!0-9]*)
      echo "PUID must be a numeric user id, got '$OCM_TARGET_UID'" >&2
      return 1
      ;;
  esac

  case "$OCM_TARGET_GID" in
    ''|*[!0-9]*)
      echo "PGID must be a numeric group id, got '$OCM_TARGET_GID'" >&2
      return 1
      ;;
  esac
}

account_holding_gid() {
  getent group "$1" 2>/dev/null | cut -d: -f1 || true
}

account_holding_uid() {
  getent passwd "$1" 2>/dev/null | cut -d: -f1 || true
}

align_group_id() {
  local account="$1" target_gid="$2" current_gid holder
  current_gid="$(id -g "$account")"

  if [ "$current_gid" = "$target_gid" ]; then
    return 0
  fi

  holder="$(account_holding_gid "$target_gid")"
  if [ -n "$holder" ] && [ "$holder" != "$account" ]; then
    echo "PGID $target_gid is already used by group '$holder' in this image" >&2
    echo "Pick a different PGID (see 'id -g' on the host) or chgrp the host workspace to a free group id" >&2
    return 1
  fi

  echo "Aligning $account group to gid $target_gid"
  groupmod -g "$target_gid" "$account" || return 1
  OCM_GID_CHANGED=1
}

align_user_id() {
  local account="$1" target_uid="$2" current_uid holder
  current_uid="$(id -u "$account")"

  if [ "$current_uid" = "$target_uid" ]; then
    return 0
  fi

  holder="$(account_holding_uid "$target_uid")"
  if [ -n "$holder" ] && [ "$holder" != "$account" ]; then
    echo "PUID $target_uid is already used by user '$holder' in this image" >&2
    echo "Pick a different PUID (see 'id -u' on the host) or chown the host workspace to a free user id" >&2
    return 1
  fi

  echo "Aligning $account user to uid $target_uid"
  usermod -u "$target_uid" "$account" || return 1
  OCM_UID_CHANGED=1
}

align_container_user() {
  local account="${1:-node}"

  resolve_target_ids || return 1
  align_group_id "$account" "$OCM_TARGET_GID" || return 1
  align_user_id "$account" "$OCM_TARGET_UID" || return 1
}

warn_if_workspace_owner_differs() {
  local path="$1" target_uid="$2" target_gid="$3" owner current_uid current_gid

  [ -d "$path" ] || return 0
  [ -n "$(ls -A "$path" 2>/dev/null)" ] || return 0

  owner="$(stat -c '%u %g' "$path" 2>/dev/null)" || return 0
  current_uid="${owner%% *}"
  current_gid="${owner##* }"

  if [ "$current_uid" != "$target_uid" ] || [ "$current_gid" != "$target_gid" ]; then
    echo "WARNING: $path is owned by uid $current_uid/gid $current_gid but the container will run as uid $target_uid/gid $target_gid" >&2
    echo "WARNING: startup is about to chown $path to uid $target_uid/gid $target_gid, rewriting ownership of existing files" >&2
    echo "WARNING: stop the container now and set PUID/PGID from 'id -u' and 'id -g' if that is not intended" >&2
  fi
}
