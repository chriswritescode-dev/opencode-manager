#!/usr/bin/env bash
set -euo pipefail

upstream_remote="${UPSTREAM_REMOTE:-upstream}"
upstream_repo="${UPSTREAM_REPO:-chriswritescode-dev/opencode-manager}"
upstream_branch="${UPSTREAM_BRANCH:-main}"
base_branch="${BASE_BRANCH:-main}"
sync_branch="${SYNC_BRANCH:-chore/sync-upstream}"
bot_email="${BOT_EMAIL:-41898282+github-actions[bot]@users.noreply.github.com}"
create_pr="${CREATE_PR:-1}"
conflict_issue_title="Upstream sync blocked by merge conflicts"
dry_run=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) dry_run=1 ;;
    *) printf 'unknown argument: %s\n' "$1" >&2; exit 2 ;;
  esac
  shift
done

log() { printf '%s\n' "$*" >&2; }

set_output() {
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    printf '%s=%s\n' "$1" "$2" >> "$GITHUB_OUTPUT"
  fi
}

set_summary() {
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    printf '%s\n' "$*" >> "$GITHUB_STEP_SUMMARY"
  fi
}

gh_ready() { command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; }

find_open_pr() {
  gh_ready || return 0
  gh pr list --head "$sync_branch" --state open --json number --jq '.[0].number // empty'
}

find_latest_pr() {
  gh_ready || return 0
  gh pr list --head "$sync_branch" --state all --limit 1 --json number --jq '.[0].number // empty'
}

find_latest_pr_state() {
  gh_ready || return 0
  gh pr list --head "$sync_branch" --state all --limit 1 --json state --jq '.[0].state // empty'
}

find_conflict_issue() {
  gh_ready || return 0
  gh issue list --state open --limit 100 --json number,title \
    --jq "[.[] | select(.title == \"$conflict_issue_title\")][0].number // empty"
}

close_conflict_issue() {
  [[ $dry_run -eq 0 ]] || return 0
  gh_ready || return 0
  local issue
  issue=$(find_conflict_issue)
  if [[ -n "$issue" ]]; then
    gh issue close "$issue" --comment "Upstream is now merged into \`$base_branch\`."
  fi
}

report_conflict() {
  local body="$1" pr issue
  if [[ $dry_run -eq 1 ]]; then
    log "[dry-run] would report the conflict"
    return 0
  fi
  gh_ready || { log "gh unavailable; skipping conflict report"; return 0; }
  pr=$(find_open_pr)
  if [[ -n "$pr" ]]; then
    gh pr comment "$pr" --body "$body"
    return 0
  fi
  issue=$(find_conflict_issue)
  if [[ -n "$issue" ]]; then
    gh issue comment "$issue" --body "$body"
  else
    gh issue create --title "$conflict_issue_title" --body "$body"
  fi
}

build_conflict_body() {
  local files="$1" file
  printf 'Automatic sync of `%s` `%s` into `%s` stopped because of merge conflicts.\n\n' "$upstream_repo" "$upstream_branch" "$base_branch"
  printf 'Conflicting files:\n\n'
  while IFS= read -r file; do
    printf -- '- `%s`\n' "$file"
  done <<< "$files"
  printf '\nResolve locally:\n\n'
  printf '```bash\n'
  printf 'git fetch %s\n' "$upstream_remote"
  printf 'git switch -c %s origin/%s\n' "$sync_branch" "$base_branch"
  printf 'git merge %s/%s\n' "$upstream_remote" "$upstream_branch"
  printf 'git push -u origin %s\n' "$sync_branch"
  printf '```\n'
}

build_pr_body() {
  printf 'Automated merge of `%s` `%s` into `%s`.\n\n' "$upstream_repo" "$upstream_branch" "$base_branch"
  printf 'Upstream commits:\n\n'
  git log --no-merges --format='- `%h` %s' "origin/${base_branch}..${target}"
  printf '\nBefore merging:\n\n'
  printf -- '- Resolve any local changes that upstream rewrote.\n'
  printf -- '- Add the `ready-for-ci` label to run CI. Pull requests opened with `GITHUB_TOKEN` do not start workflows on their own.\n'
  printf -- '- Keep auto-merge off; this branch is force-updated on the next upstream commit.\n'
}

regenerate_lockfile() {
  command -v pnpm >/dev/null 2>&1 || return 1
  log "regenerating pnpm-lock.yaml from the merged manifests"
  git checkout --theirs -- pnpm-lock.yaml
  if pnpm install --lockfile-only --ignore-scripts >/dev/null 2>&1; then
    git add pnpm-lock.yaml
    git commit --no-edit --quiet
    return 0
  fi
  return 1
}

if [[ -n "$(git status --porcelain)" ]]; then
  log "working tree is dirty; commit or stash before syncing"
  exit 1
fi

if ! git remote get-url "$upstream_remote" >/dev/null 2>&1; then
  git remote add "$upstream_remote" "https://github.com/${upstream_repo}.git"
fi

log "fetching ${upstream_repo} ${upstream_branch}"
git fetch --prune --no-tags "$upstream_remote" "+refs/heads/${upstream_branch}:refs/remotes/${upstream_remote}/${upstream_branch}"
git fetch --prune --no-tags origin

target="refs/remotes/${upstream_remote}/${upstream_branch}"
base_ref="refs/remotes/origin/${base_branch}"
remote_sync="refs/remotes/origin/${sync_branch}"

if git merge-base --is-ancestor "$target" "$base_ref"; then
  log "upstream is already merged into ${base_branch}"
  close_conflict_issue
  set_output result up-to-date
  set_summary "Upstream \`$upstream_branch\` is already merged into \`$base_branch\`."
  exit 0
fi

if git show-ref --verify --quiet "$remote_sync"; then
  if git merge-base --is-ancestor "$target" "$remote_sync"; then
    log "${sync_branch} already contains upstream; nothing to do"
    set_output result up-to-date
    set_summary "\`$sync_branch\` already contains upstream \`$upstream_branch\`."
    exit 0
  fi
  foreign=$(git log --format='%ae' "${base_ref}..${remote_sync}" --not "$target" | grep -v -F -x "$bot_email" || true)
  if [[ -n "$foreign" ]]; then
    log "${sync_branch} has commits outside the sync bot; leaving it untouched"
    report_conflict "Upstream \`$upstream_branch\` has new commits, but \`$sync_branch\` contains changes that were not made by the sync bot. Merge or close that branch, then rerun this workflow."
    set_output result blocked
    set_summary "\`$sync_branch\` has manual commits; sync skipped to avoid overwriting them."
    exit 0
  fi
fi

if git show-ref --verify --quiet "refs/heads/${sync_branch}"; then
  foreign=$(git log --format='%ae' "${base_ref}..refs/heads/${sync_branch}" --not "$target" | grep -v -F -x "$bot_email" || true)
  if [[ -n "$foreign" ]]; then
    log "local ${sync_branch} has commits outside the sync bot; switch to another branch and delete it"
    exit 1
  fi
fi

git checkout -B "$sync_branch" "$base_ref"

result=conflict
conflicts=""
if git merge --no-ff --no-edit "$target"; then
  result=clean
else
  conflicts=$(git diff --name-only --diff-filter=U | sort)
  if [[ "$conflicts" == "pnpm-lock.yaml" ]] && regenerate_lockfile; then
    result=clean
  else
    git merge --abort || true
  fi
fi

if [[ "$result" == conflict ]]; then
  log "merge conflicts in:"
  printf '%s\n' "$conflicts" >&2
  if [[ -n "${GITHUB_ACTIONS:-}" ]]; then
    printf '::warning title=Upstream sync blocked::%s\n' "$(printf '%s' "$conflicts" | tr '\n' ' ')"
  fi
  report_conflict "$(build_conflict_body "$conflicts")"
  set_output result conflict
  set_output conflict_files "$(printf '%s' "$conflicts" | tr '\n' ' ')"
  set_summary "Merge conflicts block the sync:"
  while IFS= read -r file; do
    printf -- '- `%s`\n' "$file"
  done <<< "$conflicts" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
  exit 0
fi

if [[ $dry_run -eq 1 ]]; then
  log "[dry-run] merge is clean; would push ${sync_branch} and open a pull request"
  set_output result clean
  exit 0
fi

if ! git push --force-with-lease origin "HEAD:refs/heads/${sync_branch}"; then
  log "push rejected: ${sync_branch} changed while syncing; rerun the workflow"
  set_output result blocked
  exit 1
fi

if [[ "$create_pr" != 1 ]] || ! gh_ready; then
  log "pushed ${sync_branch}; skipping pull request"
  set_output result clean
  set_summary "Pushed \`$sync_branch\` with upstream \`$upstream_branch\`."
  exit 0
fi

pr_number=$(find_open_pr)
if [[ -z "$pr_number" ]]; then
  pr_number=$(find_latest_pr)
  pr_state=$(find_latest_pr_state)
  if [[ -n "$pr_number" && "$pr_state" == "CLOSED" ]]; then
    gh pr reopen "$pr_number" >/dev/null
  elif [[ -n "$pr_number" && "$pr_state" == "MERGED" ]]; then
    pr_number=""
  fi
fi

title="chore: sync upstream ${upstream_branch}"
body=$(build_pr_body)
if [[ -n "$pr_number" ]]; then
  gh pr edit "$pr_number" --title "$title" --body "$body" >/dev/null
  log "updated pull request #${pr_number}"
else
  gh pr create --base "$base_branch" --head "$sync_branch" --title "$title" --body "$body" >/dev/null
  log "opened a pull request from ${sync_branch}"
fi

close_conflict_issue
set_output result clean
set_summary "Synced upstream \`$upstream_branch\` into \`$base_branch\` through \`$sync_branch\`."
