# ocm-cli

OpenCode Manager CLI and plugin package.

`ocm` lets a local OpenCode TUI attach to repos hosted by OpenCode Manager. It
can also mirror a local git repo up to Manager or pull a Manager repo back down
to the local working tree.

## Compatibility

| ocm | OpenCode Manager | Local OpenCode |
|---|---|---|
| 0.3.x | >= 0.19.0 | >= 2.0.15, < 3 |

ocm 0.3.0 attaches through the repo-scoped Manager proxy
(`/api/opencode-proxy/repos/:repoId`), loads its plugin from the OpenCode 2
`cli.json` `plugins` list, and moves sessions with OpenCode 2 session
export/import. Older Managers lack that route; `ocm` then fails with
`OpenCode Manager at <url> is too old for ocm 0.3.0; upgrade the Manager to >= 0.19.0`.
Use ocm 0.2.x with OpenCode Manager < 0.19.0 and OpenCode 1.x, installed pinned
(`pnpm add -g @opencode-manager/ocm-cli@0.2`) with the OpenCode 1.x plugin entry pinned to
`@opencode-manager/ocm-cli@0.2`. ocm is published together with each OpenCode Manager
release.

## Install

```bash
pnpm add -g @opencode-manager/ocm-cli
```

The package exposes the `ocm` binary and an OpenCode plugin entrypoint. Global
installs link the binary through the package manager. Local workspace installs
also create a best-effort `~/.local/bin/ocm` symlink.

The package is also self-contained for a vendored install with no package
manager. `ocm install` copies the package into `<config>/plugin/ocm-cli`,
registers `./plugin/ocm-cli/dist` in `<config>/cli.json`, and links `ocm` at
`~/.local/bin/ocm`. `<config>` is `$OPENCODE_CONFIG_DIR`, else
`$XDG_CONFIG_HOME/opencode`, else `~/.config/opencode`; `--dir <path>`
overrides it. `--no-link` skips the symlink, and `--force` replaces a
non-symlink `ocm` already at the link path. Run it without an existing
`ocm` via `pnpm dlx @opencode-manager/ocm-cli install`, or from a local build
via `./scripts/install.sh`. The command is idempotent, so re-run it to upgrade.
Use the `dist` directory, not `dist/tui.js`: OpenCode 2 loads `tui.js` from
directory entries and skips file entries.

## Login

```bash
ocm login <manager-url> [token]
```

The token is stored in a platform-specific token store:

| Platform | Store |
|---|---|
| macOS | Keychain, service `opencode-manager`, account = manager URL |
| Linux | `~/.config/opencode-manager/credentials.json`, mode `0600` |

On Linux the token is stored as plaintext JSON protected only by file
permissions. CLI state is stored at `~/.config/opencode-manager/state.json`.
Windows is unsupported: the same file store is used, but the `0600` mode is not
enforced there.

`ocm` passes the token to the local `opencode` client it launches as
`OPENCODE_PASSWORD`. That variable belongs only to the local client process; never
set `OPENCODE_PASSWORD` in the OpenCode Manager server environment (the Manager
strips it because it would override the Manager-managed OpenCode password).

`OCM_TOKEN` overrides the token store for reads; `ocm login` always writes to
the platform store and `ocm logout` cannot remove the override. Run `ocm status`
to see the active store.

If `[token]` is omitted, `ocm login` reads it from hidden TTY input (requires
`bash`) or stdin.

## Commands

```bash
ocm
ocm login <manager-url> [token]
ocm status
ocm list
ocm use <repoId|name>
ocm push [repoId] [--force] [--create] [--yes] [--full]
ocm pull [repoId] [--force] [--full]
ocm install [--dir <path>] [--force] [--no-link]
ocm logout
ocm --version
ocm --help
```

`ls` is an alias for `list`, `attach` for `use`, `help`/`-h` for `--help`, and
`version`/`-v` for `--version`.

Running `ocm` with no command computes the current git repo's OpenCode project
id (the same identity OpenCode uses: normalized origin remote hash, else the
cached id, else the root commit) and matches it against ready Manager repos. If
one repo matches, it attaches OpenCode to that Manager repo. If none matches
while inside a git repo, it launches local `opencode` and does not consult the
last selected repo. Only outside a git repo does it fall back to the last
selected repo, then to local `opencode`.

`ocm use <repoId|name>` selects a Manager repo, remembers it as the last repo,
and attaches OpenCode to it.

`ocm push` syncs the current git repo to the matching Manager repo using a fast
git bundle + working-tree patch by default; the fast path prints a single result
line. Pass `--full` to use the legacy tarball mirror, which shows byte-count
upload progress. If the fast path fails, `ocm` prompts before reverting to the
tarball mirror (and proceeds automatically when there is no TTY to prompt). Use
`--create` to create a Manager repo when no project match exists, and `--yes` to
confirm creation in non-interactive shells. Creating a repo always uploads a
tarball.

`ocm pull` syncs the matching Manager repo over the current working tree using a
fast git bundle + working-tree patch by default. Pass `--full` to use the legacy
tarball mirror. If the fast path fails, `ocm` prompts before reverting to the
tarball mirror (and proceeds automatically when there is no TTY to prompt). It
refuses to overwrite uncommitted local changes unless `--force` is passed.

Safety aborts, such as uncommitted local changes on `pull` or a branch checked
out in another worktree, stop the command instead of falling back to the
tarball mirror. Without `--force`, `push` asks before discarding server-side
work (commits not present locally, or uncommitted changes on the Manager), and
`pull` asks before discarding local commits the Manager does not have. Without a
TTY both refuse; pass `--force` to override.

A base repo and one of its worktrees can both be registered as ready Manager
repos sharing the same OpenCode project id. When that happens, `ocm push` and
`ocm pull` accept an optional positional repo id to pick the target:
`ocm push [repoId]` / `ocm pull [repoId]`. The id must belong to one of the
repos matching the current project (the command fails clearly otherwise), and
any ambiguity message lists each match with its id, kind (repo or worktree),
branch, and path. The default attach reports the same details.

## OpenCode TUI plugin

The package exposes an OpenCode 2 TUI plugin (`{ id, setup }`) through its `./tui`
package export. Configure the package name and OpenCode resolves that TUI
entrypoint automatically. When attached to a Manager via `ocm`, the plugin shows a
`<host> · <repo>` indicator in the prompt and home footers; local launches
show nothing. It registers `/ocm-move`, which keeps the local session and
copies the active session to the Manager after replacing the Manager repo's
working tree with your local one (commits, staged, unstaged, and untracked
files; gitignored files on the Manager are preserved). The Manager's current
checkout is never switched: if it is on your branch the repo is replaced in
place; otherwise your branch goes into a sibling worktree (`<repo>-<branch>`,
registered as its own Manager repo), created on demand if it does not exist
yet. When multiple Manager repos match, the one already on your branch is
chosen; otherwise a picker dialog lets you choose. A confirmation dialog gates
the move before any push, states where the state will land, and lists any
server-side work (uncommitted changes or commits not present locally) that will
be discarded there. The session moves by exporting it from the local OpenCode 2
server and importing it through the Manager proxy, followed by a synthetic
reminder. While the move runs, a spinner with the current phase and a
progress bar is shown next to the prompt. On success
you can optionally warp — exit the local TUI and attach to the moved session
on the Manager immediately. Use it from inside an OpenCode session after
`ocm login` and after the repo already exists on the Manager
(`ocm push --create` if needed). It refuses, before pushing anything, a session
that is already on the Manager and a subagent session whose parent is not.

`/ocm` switches this TUI to another server, the same way the `ocm` CLI picks
one. In a local TUI it finds the Manager repo that matches the current
directory (by OpenCode project id) and asks to attach to it; when no repo or
several repos match, it shows a picker of the Manager's ready repos. In a TUI
that is already attached, the picker offers the other Manager repos (the
current one is listed as disabled) and **Local opencode**, which stays
available even when the Manager cannot be reached. Switching exits the TUI and
reattaches; switching to a repo also remembers it as the last repo. The current
session stays where it is (use `/ocm-move` to bring a local session along).

The plugin also registers two Manager-backed commands, both of which need an
attached Manager repo through `ocm`:

- `/ocm-goal [objective]` starts a Manager-driven goal on the current top-level
  session and sends the objective as the next message (queued if the session
  is busy). With no objective, a dialog asks for it, plus optional max turns
  (1-200) and token budget (a positive whole number); blank uses the Manager
  defaults. `tab` moves between fields and `ctrl+s` starts the goal. The
  objective is sent as plain text with the session's current agent and model:
  the plugin cannot read the composer's selection, so send a message first if
  you switched agent or model, and `@file` mentions are not attached. If the
  objective cannot be sent, the goal is cancelled. Scheduled runs and subagent
  sessions are rejected by the Manager. While a goal is open, a one-line status
  above the composer shows `<status> · Turn n/max`, token usage when the goal
  has a token budget, and the first line of the objective. The TUI keeps
  following the goal after you leave the session, and a toast reports the
  outcome with an option to open the session. Running `/ocm-goal` while a goal
  is open shows its live status with `p` to pause or resume and `x` (twice) to
  cancel.
- `/ocm-multirun [prompt]` opens a launch dialog: prompt, name (defaults to the
  prompt's first line), a filterable model checklist (up to 5, `enter`
  toggles), isolated workspaces or the shared repo directory, and, for isolated
  workspaces, an optional ref to start from (default: current HEAD). `ctrl+s`
  launches; the started sessions open in tabs, or the first one opens when tabs
  are off. With no prompt, `/ocm-multirun` opens the runs browser for the
  attached repo. On the run list, `↑`/`↓` select a run, `enter` or `→` opens
  it, `n` starts a new multi-run, and `r` refreshes. In a run, `enter` or `o`
  opens an entry or fusion session, `space` selects results for fusion, `d`
  (twice) discards an entry (and removes its workspace when isolated), and `←`
  goes back. `f`, on the run list or in a run with nothing selected, opens the
  fusion form with the run's started results preselected (2-5 needed). The
  fusion form takes a synthesis model, an optional ref to start from, and
  optional instructions; `ctrl+s` fuses and `ctrl+b` goes back. A fusion always
  runs in a new isolated workspace.

Both commands need an OpenCode Manager release that exposes
`/api/internal/session-goals` and `/api/internal/multi-runs`. An older Manager
rejects these routes with `401 Unauthorized` even for a valid token, or with a
non-JSON `404`; on a `401` the TUI checks the token against another Manager
route and then reports that the Manager must be upgraded instead of asking you
to log in again.

The attached `opencode` process carries `OCM_REMOTE_MANAGER_URL`,
`OCM_REMOTE_REPO_NAME`, and `OCM_REMOTE_REPO_ID`. They drive the indicator and
tell `/ocm`, `/ocm-goal`, and `/ocm-multirun` which Manager and repo they act
on; `/ocm-multirun` requires `OCM_REMOTE_REPO_ID`. These commands authenticate
with the stored token (or `OCM_TOKEN`) for that Manager URL, not with
`OPENCODE_PASSWORD`.

Enable it in `~/.config/opencode/cli.json`:

```jsonc
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": ["@opencode-manager/ocm-cli"]
}
```

The `ocm` binary is installed via the package `postinstall` (or `bin` field on
global installs); the plugin surface is TUI-only.

## Requirements

- macOS or Linux (Windows is unsupported)
- OpenCode >= 2.0.15 (same major, 2.x) available on `PATH`
- OpenCode Manager >= 0.19.0
- `git` and `tar` (with gzip support, i.e. the `-z` flag) available on `PATH`
- `bash`, used for hidden token entry and interactive confirmations
- macOS only: `/usr/bin/security`, used for Keychain-backed token storage (Linux uses a mode-`0600` file under the user config dir `~/.config/opencode-manager`)
- An OpenCode Manager URL and bearer token
