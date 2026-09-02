# ocm-cli

OpenCode Manager CLI and plugin package.

`ocm` lets a local OpenCode TUI attach to repos hosted by OpenCode Manager. It
can also mirror a local git repo up to Manager or pull a Manager repo back down
to the local working tree.

## Install

```bash
pnpm add -g @opencode-manager/ocm-cli
```

The package exposes the `ocm` binary and an OpenCode plugin entrypoint. Global
installs link the binary through the package manager. Local workspace installs
also create a best-effort `~/.local/bin/ocm` symlink.

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

`OCM_TOKEN` overrides the token store for reads; `ocm login` always writes to
the platform store and `ocm logout` cannot remove the override. Run `ocm status`
to see the active store.

If `[token]` is omitted, `ocm login` reads it from hidden TTY input (requires
`bash`) or stdin.

## Commands

```bash
ocm
ocm status
ocm list
ocm use <repoId|name>
ocm push [repoId] [--force] [--create] [--yes] [--full]
ocm pull [repoId] [--force] [--full]
ocm logout
```

Running `ocm` with no command computes the current git repo's OpenCode project
id (the same identity OpenCode uses: normalized origin remote hash, else the
cached id, else the root commit) and matches it against ready Manager repos. If
one repo matches, it attaches OpenCode to that Manager repo. If no repo matches,
it falls back to the last selected repo, then to local `opencode`.

`ocm use <repoId|name>` selects a Manager repo, remembers it as the last repo,
and attaches OpenCode to it.

`ocm push` syncs the current git repo to the matching Manager repo using a fast
git bundle + working-tree patch by default. The CLI reports granular progress
phases during push: bundling, uploading (with byte counts), server processing,
and patching. Pass `--full` to use the legacy tarball mirror. If the fast path
fails, `ocm` prompts before reverting to the tarball mirror (and proceeds
automatically when there is no TTY to prompt). Use `--create` to create a Manager
repo when no project match exists, and `--yes` to confirm creation in
non-interactive shells.

`ocm pull` syncs the matching Manager repo over the current working tree using a
fast git bundle + working-tree patch by default. Pass `--full` to use the legacy
tarball mirror. If the fast path fails, `ocm` prompts before reverting to the
tarball mirror (and proceeds automatically when there is no TTY to prompt). It
refuses to overwrite uncommitted local changes unless `--force` is passed.

A base repo and one of its worktrees can both be registered as ready Manager
repos sharing the same OpenCode project id. When that happens, `ocm push` and
`ocm pull` accept an optional positional repo id to pick the target:
`ocm push [repoId]` / `ocm pull [repoId]`. The id must belong to one of the
repos matching the current project (the command fails clearly otherwise), and
any ambiguity message lists each match with its id, kind (repo or worktree),
branch, and path. The default attach reports the same details.

## OpenCode TUI plugin

The package exposes an OpenCode TUI plugin through its `./tui` package export.
Configure the package name and OpenCode resolves that TUI entrypoint
automatically. When attached to a Manager via `ocm`, the plugin shows a
`REMOTE <host> · <repo>` indicator at the bottom of the TUI; local launches
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
be discarded there. While the move runs, a spinner with the current phase and a
progress bar is shown next to the prompt. On success
you can optionally warp — exit the local TUI and attach to the moved session
on the Manager immediately. Use it from inside an OpenCode session after
`ocm login` and after the repo already exists on the Manager
(`ocm push --create` if needed).

Enable it in `tui.json`:

```jsonc
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["@opencode-manager/ocm-cli"]
}
```

The `ocm` binary is installed via the package `postinstall` (or `bin` field on
global installs); the plugin surface is TUI-only.

## Requirements

- macOS or Linux (Windows is unsupported)
- `opencode` available on `PATH`
- `git` and `tar` (with gzip support, i.e. the `-z` flag) available on `PATH`
- `bash`, used for hidden token entry and interactive confirmations
- macOS only: `/usr/bin/security`, used for Keychain-backed token storage (Linux uses a mode-`0600` file under the user config dir `~/.config/opencode-manager`)
- An OpenCode Manager URL and bearer token
