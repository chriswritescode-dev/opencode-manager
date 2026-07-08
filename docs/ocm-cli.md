# `ocm` CLI

`ocm` is a small CLI that attaches your local OpenCode TUI to a repo hosted on an OpenCode Manager. Prompts execute on the Manager's filesystem against a single shared OpenCode server, while your laptop terminal hosts the TUI.

## Quickstart

1. **Get your Manager URL** — the web UI address where your OpenCode Manager is running (e.g., `https://manager.example.com`)
2. **Generate an internal token** — go to **Settings → Manager Token** in the web UI and click **Generate**
3. **Install the CLI** — `pnpm add -g @opencode-manager/ocm-cli`
4. **Log in** — `ocm login https://your-manager-url` (paste the token when prompted)
5. **List repos** — `ocm list` to see repos configured on the Manager
6. **Attach** — `ocm use <repo-id>` to start an OpenCode session attached to that repo

## Architecture Overview

| Component | Where it runs | Role |
|---|---|---|
| **`ocm` CLI** | Laptop / local shell | Lists repos, attaches `opencode` against the Manager proxy, mirrors `$PWD` up/down |
| **Manager backend** | Manager server | Exposes repo metadata + token-protected OpenCode proxy + tarball mirror endpoints |
| **Manager web UI** | Manager server | Reads from the shared OpenCode server; sessions created via `ocm` appear normally |

There is no per-repo OpenCode process. All sessions share one OpenCode server on the Manager, with file-level isolation via `--dir`.

---

## 1. Install

The CLI is published as `@opencode-manager/ocm-cli`. There are two install paths.

### Option A — install via OpenCode's plugin loader (recommended)

Add the TUI plugin entry to your OpenCode config and OpenCode will fetch the package on next start. The package `postinstall` script self-installs a `~/.local/bin/ocm` symlink for local plugin installs, so the `ocm` binary becomes available on your PATH automatically.

```jsonc
// ~/.config/opencode/opencode.json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@opencode-manager/ocm-cli/tui"]
}
```

The next time OpenCode starts it will run `bun install` for the plugin. The installer stays quiet so it does not break the TUI layout; after the plugin loads, OpenCode shows a one-time toast confirming where `ocm` was linked.

If `~/.local/bin` is not on your PATH, add this to your shell rc:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

The `./tui` entry registers `/ocm-move`, a TUI command that keeps the local session and copies the active session to the Manager after pushing the current repo state. Run it from inside a local OpenCode session after `ocm login` and after the repo exists on the Manager (`ocm push --create` if needed).

### Option B — global package manager install

If you don't use the OpenCode plugin loader, install globally:

```bash
pnpm add -g @opencode-manager/ocm-cli
```

This puts `ocm` on your PATH via the package manager's own bin shim. The `~/.local/bin` symlink is skipped for global installs.

### Option C — from this repository (dev)

```bash
pnpm install
pnpm --filter @opencode-manager/ocm-cli build
# postinstall creates ~/.local/bin/ocm symlink
```

## 2. Log in

Use the URL where your Manager web UI is accessible:

```bash
ocm login https://your-manager-url
# paste your Manager internal token when prompted
```

The token is stored in the macOS Keychain under the manager URL. The manager URL is persisted to `~/.config/opencode-manager/state.json`.

Generate or rotate your internal token from **Settings → Manager Token** in the Manager web UI (Settings cog in the sidebar, then **Manager Token**).

---

## 3. Commands

```text
ocm                       Attach to the Manager repo matching $PWD's git origin,
                          or fall back to the last selected repo
ocm login <url> [token]   Save manager URL + token (token via stdin if omitted)
ocm logout                Forget saved token (Keychain) and state
ocm status                Show current manager URL, repo, and whether token is set
ocm list                  List ready repos from the manager
ocm use <repoId|name>     Attach to a specific repo and remember it as last
ocm push [--force] [--create] [--yes] [--full]   Mirror $PWD to the matching Manager repo (fast bundle/patch sync by default)
ocm pull [--force] [--full]                      Mirror the matching Manager repo over $PWD (fast bundle/patch sync by default)
ocm --help                Show this help
```

### How bare `ocm` resolves the target

1. If `$PWD` is inside a git repo and its `origin` matches exactly one Manager repo by URL, attach to that repo and remember it as `last`.
2. If multiple Manager repos match `origin`, fail with a hint to use `ocm use <repoId>`.
3. Otherwise fall back to the previously used repo (`last`).
4. If there is no `last` either, fail with a hint to run `ocm list` then `ocm use <repoId>`.

`origin` matching uses the same normalisation as `ocm push` / `ocm pull` (case-insensitive, `.git` stripped, `git@host:path` rewritten to `ssh://git@host/path`).

### Attach command equivalent

Under the hood, `ocm` execs:

```bash
opencode attach https://manager.example.com/api/opencode-proxy \
  --dir /path/to/repo/on/manager \
  --password <manager-token> \
  --username opencode
```

The child takes over the terminal (`stdio: inherit`); closing the TUI exits `ocm` but leaves the Manager-side session intact.

### Mirror commands

`ocm push` uses a fast git bundle + working-tree patch by default to sync `$PWD` to the matching Manager repo. Pass `--full` to use the legacy tarball mirror (skipping `node_modules`, `dist`, `.next`, `.venv`, `__pycache__`, `.turbo`, and anything matched by `.gitignore`). If the fast path fails, `ocm` prompts before reverting to the tarball mirror (and proceeds automatically when there is no TTY to prompt).

`ocm pull` uses a fast git bundle + working-tree patch by default to sync the matching Manager repo over `$PWD`. Pass `--full` to use the legacy tarball mirror. If the fast path fails, `ocm` prompts before reverting to the tarball mirror (and proceeds automatically when there is no TTY to prompt).

### TUI `/ocm-move`

When the TUI plugin entry is installed, `/ocm-move` is available in local OpenCode sessions. It checks that the matching Manager repo has not diverged, pushes the local git state with the fast bundle + working-tree patch path, reads the active session history from the local OpenCode SQLite event database, rewrites local repo directories to the Manager repo directory, and replays the session through `/api/opencode-proxy/sync/replay`. The local session is retained.

- `--force` skips the dirty-working-tree check on `pull` and the safety bail on `push`.
- `--create` (on `push`) creates a new Manager repo when no `origin` match is found.
- `--yes` skips the interactive create confirmation.

---

## 4. Environment variables

Both can be used in place of `ocm login`:

| Variable | Description |
|---|---|
| `OPENCODE_MANAGER_URL` | Manager base URL (e.g., `https://manager.example.com`). Not currently consumed by the CLI — use `ocm login`. |
| Keychain entry under `https://manager.example.com` | Token used for Bearer auth on Manager API calls and Basic auth on the OpenCode proxy. |

---

## 5. Related endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/internal/opencode-workspaces` | GET | List ready repos with directory + originUrl |
| `/api/internal/repo-mirror/:repoId/up` | POST | Receive tarball, write to repo dir |
| `/api/internal/repo-mirror/:repoId/down` | GET | Stream tarball of repo dir |
| `/api/opencode-proxy/*` | ALL | Token-protected proxy from Manager to single OpenCode server |
