# `ocm` CLI

`ocm` is a small CLI that attaches your local OpenCode TUI to a repo hosted on an OpenCode Manager. Prompts execute on the Manager's filesystem against a single shared OpenCode server, while your laptop terminal hosts the TUI.

## Quickstart

1. **Get your Manager URL** — the web UI address where your OpenCode Manager is running (e.g., `https://manager.example.com`)
2. **Generate an internal token** — go to **Settings → Manager Token** in the web UI and click **Generate**
3. **Install the CLI** — `pnpm add -g @opencode-manager/ocm-cli`
4. **Log in** — `ocm login https://your-manager-url` (paste the token when prompted)
5. **List repos** — `ocm list` to see repos configured on the Manager
6. **Attach** — `ocm use <repo-id>` to start an OpenCode session attached to that repo

## Compatibility

| ocm | OpenCode Manager | Local OpenCode |
|---|---|---|
| 0.3.x | >= 0.19.0 | >= 2.0.15, < 3 |

ocm 0.3.0 requires a local OpenCode 2 client (>= 2.0.15, same major), is configured through the OpenCode 2 `cli.json` `plugins` list, attaches through the repo-scoped Manager route `/api/opencode-proxy/repos/:repoId`, and moves sessions with OpenCode 2 session export/import. When the Manager does not serve the repo-scoped route (it answers `404`), `ocm` and `/ocm-move` stop before attaching or pushing with:

```text
OpenCode Manager at <url> is too old for ocm 0.3.0; upgrade the Manager to >= 0.19.0
```

Keep ocm 0.2.x for OpenCode Manager < 0.19.0 and OpenCode 1.x: install it pinned with
`pnpm add -g @opencode-manager/ocm-cli@0.2`, and pin the plugin entry to
`@opencode-manager/ocm-cli@0.2` in your OpenCode 1.x TUI config so it does not resolve to
the latest release. ocm is published together with each OpenCode Manager release.

When the Manager rejects the stored token (`401`), returns another error, or cannot be
reached while `ocm` prepares the repo-scoped route, `ocm` and `/ocm-move` stop before
attaching with a message naming the cause.

## Architecture Overview

| Component | Where it runs | Role |
|---|---|---|
| **`ocm` CLI** | Laptop / local shell | Lists repos, attaches `opencode` against the Manager proxy, mirrors `$PWD` up/down |
| **Manager backend** | Manager server | Exposes repo metadata + token-protected OpenCode proxy + tarball mirror endpoints |
| **Manager web UI** | Manager server | Reads from the shared OpenCode server; sessions created via `ocm` appear normally |

There is no per-repo OpenCode process. All sessions share one OpenCode server on the Manager, with file-level isolation via the location directory (`x-opencode-directory` / `location[directory]`).

---

## 1. Install

The CLI is published as `@opencode-manager/ocm-cli`. There are two install paths.

### Option A — install via OpenCode's plugin loader (recommended)

Add the package to your OpenCode 2 CLI config and OpenCode will fetch it on next start. The package exposes a `./tui` entrypoint, and OpenCode resolves that entrypoint automatically from the package name. The package `postinstall` script self-installs a `~/.local/bin/ocm` symlink for local plugin installs, so the `ocm` binary becomes available on your PATH automatically.

```jsonc
// ~/.config/opencode/cli.json
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": ["@opencode-manager/ocm-cli"]
}
```

The next time OpenCode starts it will run `bun install` for the plugin. The installer stays quiet so it does not break the TUI layout; after the plugin loads, OpenCode shows a one-time toast confirming where `ocm` was linked.

If `~/.local/bin` is not on your PATH, add this to your shell rc:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

The `@opencode-manager/ocm-cli` package entry registers `/ocm-move`, a TUI command that keeps the local session and copies the active session to the Manager after pushing the current repo state. Run it from inside a local OpenCode session after `ocm login` and after the repo exists on the Manager (`ocm push --create` if needed).

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

The token is stored in a platform-specific token store: the macOS Keychain (service `opencode-manager`, account = manager URL) on macOS, or `~/.config/opencode-manager/credentials.json` at mode `0600` on Linux. On Linux the token is plaintext JSON protected only by file permissions. Run `ocm status` to see the active store. The manager URL itself is persisted to `~/.config/opencode-manager/state.json`.

Windows is not supported: the CLI falls back to the same file store, but the `0600` mode is not enforced there and hidden token entry requires `bash`.

Generate or rotate your internal token from **Settings → Manager Token** in the Manager web UI (Settings cog in the sidebar, then **Manager Token**).

---

## 3. Commands

```text
ocm                       Attach to the Manager repo matching $PWD's git origin,
                          or fall back to the last selected repo
ocm login <url> [token]   Save manager URL + token (token via stdin if omitted)
ocm logout                Forget saved token and state
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

Under the hood, `ocm` execs (OpenCode 2 connects with `--server` and reads the password from `OPENCODE_PASSWORD`):

```bash
OCM_REMOTE_MANAGER_URL=https://manager.example.com \
OCM_REMOTE_REPO_NAME=my-repo \
OPENCODE_PASSWORD=<manager-token> \
  opencode --server https://manager.example.com/api/opencode-proxy/repos/42
```

`OPENCODE_PASSWORD` is set only on this local `opencode` client invocation that `ocm` execs, from the stored Manager token; you do not need to export it yourself. Never put `OPENCODE_PASSWORD` in the OpenCode Manager server environment: the Manager strips it from its own env because it would override the Manager-managed OpenCode server password.

The repo-scoped proxy mount sets the repo directory as the default request location
(the `x-opencode-directory` header, a `location[directory]` query, the session list
`directory` filter, and a `location` in a JSON body), so the child TUI can run from any
local working directory. It is convenience scoping, not isolation: routes addressed by
session ID are not restricted to the repo, and the Manager token grants full access to
the OpenCode API through the unscoped `/api/opencode-proxy/*` route as well. The child takes over the terminal
(`stdio: inherit`); closing the TUI exits `ocm` but leaves the Manager-side session
intact.

When the TUI plugin is installed, these internal child-process variables add a `REMOTE <host> · <repo>` indicator to the bottom of Manager-attached TUI windows. Local launches show no indicator.

### Mirror commands

`ocm push` uses a fast git bundle + working-tree patch by default to sync `$PWD` to the matching Manager repo. Pass `--full` to use the legacy tarball mirror (skipping `node_modules`, `dist`, `.next`, `.venv`, `__pycache__`, `.turbo`, and anything matched by `.gitignore`). If the fast path fails, `ocm` prompts before reverting to the tarball mirror (and proceeds automatically when there is no TTY to prompt).

`ocm pull` uses a fast git bundle + working-tree patch by default to sync the matching Manager repo over `$PWD`. Pass `--full` to use the legacy tarball mirror. If the fast path fails, `ocm` prompts before reverting to the tarball mirror (and proceeds automatically when there is no TTY to prompt).

### TUI `/ocm-move`

When the TUI plugin entry is installed, `/ocm-move` is available in local OpenCode sessions. It checks that the matching Manager repo has not diverged, pushes the local git state with the fast bundle + working-tree patch path, exports the active session through the local OpenCode 2 server (`session.export`), rewrites local repo directories and file attachment URIs to the Manager repo directory, imports the session's messages through the Manager proxy (`session.import`), and sends a synthetic reminder (`session.synthetic`) to the remote session (best-effort, never fails the move). The local session is retained. When multiple Manager repos match, a select dialog lets you pick the destination. A confirmation dialog gates the move before any push. On success you can choose to warp — exit the local TUI and attach to the moved session on the Manager immediately — or keep the local copy with the previous toast behavior.

- `--force` skips the dirty-working-tree check on `pull` and the safety bail on `push`.
- `--create` (on `push`) creates a new Manager repo when no `origin` match is found.
- `--yes` skips the interactive create confirmation.

---

## 4. Environment variables

The CLI's environment and token inputs:

| Variable | Description |
|---|---|
| `OPENCODE_MANAGER_URL` | Manager base URL (e.g., `https://manager.example.com`). Not currently consumed by the CLI — use `ocm login`. |
| `OPENCODE_PASSWORD` | Set by `ocm` on the local `opencode` child only (value = Manager token). Client-side only; never set it in the Manager server environment, which strips it. |
| `OCM_REMOTE_MANAGER_URL` | Internal child-process context set by `ocm attach`; controls the remote TUI indicator. Not a login setting. |
| `OCM_REMOTE_REPO_NAME` | Internal child-process context set by `ocm attach`; labels the remote TUI indicator. Not a login setting. |
| `OCM_TOKEN` | Read-only override for the stored token; takes priority over the platform token store. `ocm login` never writes it, and `ocm logout` cannot remove it. Because the manager URL still comes from `state.json`, CI must run `ocm login` first, so this override does not yet avoid writing a token to disk. |
| Token store entry under `<manager url>` | Token used for Bearer auth on Manager API calls and Basic auth on the OpenCode proxy. macOS Keychain (service `opencode-manager`) or `~/.config/opencode-manager/credentials.json` (mode `0600`) on Linux. |

---

## 5. Related endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/internal/opencode-workspaces` | GET | List ready repos with directory + originUrl |
| `/api/internal/repo-mirror/:repoId/up` | POST | Receive tarball, write to repo dir |
| `/api/internal/repo-mirror/:repoId/down` | GET | Stream tarball of repo dir |
| `/api/opencode-proxy/*` | ALL | Token-protected proxy from Manager to single OpenCode server |
| `/api/opencode-proxy/repos/:repoId/*` | ALL | Token-protected proxy that defaults the request location to the repo directory |
