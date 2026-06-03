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
ocm push [--force] [--create] [--yes]
ocm pull [--force]
ocm logout
```

Running `ocm` with no command tries to match the current git repo's `origin`
against ready Manager repos. If one repo matches, it attaches OpenCode to that
Manager repo. If no repo matches, it falls back to the last selected repo, then
to local `opencode`.

`ocm use <repoId|name>` selects a Manager repo, remembers it as the last repo,
and attaches OpenCode to it.

`ocm push` uploads the current git repo to the matching Manager repo. Use
`--create` to create a Manager repo when no origin match exists, and `--yes` to
confirm creation in non-interactive shells.

`ocm pull` replaces the current working tree with the matching Manager repo. It
refuses to overwrite uncommitted local changes unless `--force` is passed.

## OpenCode plugin

The package default export is an OpenCode plugin entrypoint. Importing the
plugin performs a best-effort local `ocm` symlink install and then returns an
empty plugin object.

```ts
import ocm from '@opencode-manager/ocm-cli'

export default [ocm]
```

## Requirements

- `opencode` available on `PATH`
- `git` and `tar` (with gzip support, i.e. the `-z` flag) available on `PATH`
- macOS `security` CLI for Keychain-backed token storage
- An OpenCode Manager URL and bearer token
