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

The token is stored in macOS Keychain under the `opencode-manager` service. CLI
state is stored at `~/.config/opencode-manager/state.json`.

If `[token]` is omitted, `ocm login` reads it from hidden TTY input or stdin.

## Commands

```bash
ocm
ocm status
ocm list
ocm use <repoId|name>
ocm push [--force] [--create] [--yes] [--full]
ocm pull [--force] [--full]
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
git bundle + working-tree patch by default. Pass `--full` to use the legacy
tarball mirror. If the fast path fails, `ocm` prompts before reverting to the
tarball mirror (and proceeds automatically when there is no TTY to prompt). Use
`--create` to create a Manager repo when no project match exists, and `--yes` to
confirm creation in non-interactive shells.

`ocm pull` syncs the matching Manager repo over the current working tree using a
fast git bundle + working-tree patch by default. Pass `--full` to use the legacy
tarball mirror. If the fast path fails, `ocm` prompts before reverting to the
tarball mirror (and proceeds automatically when there is no TTY to prompt). It
refuses to overwrite uncommitted local changes unless `--force` is passed.

## OpenCode TUI plugin

The package exposes an OpenCode TUI plugin through its `./tui` package export.
Configure the package name and OpenCode resolves that TUI entrypoint
automatically. When attached to a Manager via `ocm`, the plugin shows a
`REMOTE <host> · <repo>` indicator at the bottom of the TUI; local launches
show nothing. It registers `/ocm-move`, which keeps the local session and
copies the active session to the Manager after pushing the current repo state.
When multiple Manager repos match, a picker dialog lets you choose the
destination. A confirmation dialog gates the move before any push. On success
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

- `opencode` available on `PATH`
- `git` and `tar` (with gzip support, i.e. the `-z` flag) available on `PATH`
- macOS `security` CLI for Keychain-backed token storage
- An OpenCode Manager URL and bearer token
