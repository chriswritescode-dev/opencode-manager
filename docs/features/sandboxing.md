# Agent Sandboxing

Run OpenCode agent `bash` tool commands inside an isolated microVM instead of directly in the Manager container. Sandboxing does not restrict trusted OpenCode configuration or extensions and is not a per-project permission boundary.

## Overview

When sandboxing is enabled, every command an OpenCode agent runs through the `bash` tool is executed inside a microVM managed by [`msb`](https://github.com/superradcompany/microsandbox). OpenCode itself continues to run in the Manager container and loads the same global and project configuration, providers, models, plugins, tools, MCP servers, formatters, LSP servers, hooks, and shell settings as it does with sandboxing disabled.

The microVM sees repositories through bind mounts at the same paths used by the Manager. Agent commands therefore operate on the same files while running under a separate kernel without access to Manager configuration, provider credentials, or SSH keys.

## What Gets Sandboxed

| Execution path | Through the microVM |
|----------------|---------------------|
| Chat session `bash` tool calls | Yes |
| Scheduled run `bash` tool calls | Yes |
| Subagent `bash` tool calls | Yes |
| WebUI `!command` shell mode (`POST /session/:id/shell`) | Yes; it carries a tool call id like the `bash` tool, so it is planned and routed into the microVM. It is not badged in the UI because the surface fires no `tool.execute.after` hook |
| Slash-command shell templates (`` !`cmd` ``, `POST /session/:id/command`) | No; normal OpenCode behavior |
| PTY terminals (`POST /pty`, `/pty/:id/connect`) | No; normal OpenCode behavior |
| OpenCode file tools | No |
| Manager-side git operations | No |
| Plugins and custom tools | No; normal OpenCode behavior |
| The `ocm` tool (`ocm-manager.js`) | No; runs in the Manager's OpenCode process |
| Local MCP servers | No; normal OpenCode behavior |
| Formatters, LSP servers, and hooks | No; normal OpenCode behavior |
| Custom provider modules | No; normal OpenCode behavior |
| Explicit OpenCode `shell` configuration | Overridden while enforcement is on |

The Manager generates a POSIX shell shim and points OpenCode's `shell` setting at it, so the agent `bash` tool spawns the shim instead of a host shell. The Manager-owned `ocm-sandbox.js` plugin pins that setting and, before each `bash` spawn, asks the Manager for the sandbox working directory and injects it as `OCM_SANDBOX_WORKDIR`. The shim routes the command into the microVM through `msb exec` whenever that variable is set. Both the pinned setting and the injected directory are locked and verified so a later plugin cannot silently restore host execution. If the sandbox cannot be prepared, the tool call fails instead of running on the host.

The command the agent wrote is never rewritten. It reaches `msb exec` as a single argument, so the recorded tool call, the permission rules, and the model's own context all keep the original command.

Each sandboxed `bash` call is marked `sandbox` in its tool metadata, which the WebUI shows as a green badge on the tool call. Metadata is not sent to the model.

## OpenCode Configuration

Sandbox enforcement does not sanitize, rewrite, filter, or replace OpenCode configuration files. Global and project configuration loads normally, configured plugins are installed normally, and config, MCP, and authentication API requests are forwarded unchanged.

The single exception is the in-memory `shell` setting: while enforcement is on, the sandbox plugin pins it to the generated shim. No configuration file is modified. A shell the user configured is remembered and handed back to the shim for the surfaces that are not the agent `bash` tool.

Existing `.ocm-sandbox-backup` and `.ocm-quarantine` artifacts created by older releases are restored during startup and are no longer created.

Configured extensions execute with OpenCode's normal host-process privileges. This includes plugins, custom tools, local MCP servers, formatters, LSP servers, hooks, custom provider modules, and explicit shell configuration. These are trusted configuration outside the agent `bash` isolation boundary.

## Other Shell Surfaces

Slash-command shell templates and PTY terminals follow OpenCode's normal host-process behavior during enforcement. WebUI `!command` shell mode **is** sandboxed: OpenCode builds a synthetic tool part for it and passes that part's call id to `shell.env`, so it is planned and routed into the microVM exactly like an agent `bash` call.

The unsandboxed surfaces also spawn the shim, because it is the configured shell, but no working directory is injected for them, so the shim passes the command straight through to the host shell. PTY terminals receive the user's configured shell; slash-command shell templates fire no `shell.env` hook at all and fall back to the shell the Manager resolved at startup rather than a login shell.

The `shell.env` hook input carries only `{ cwd, sessionID?, callID? }`, so the presence of a call id is the only available discriminator. It separates session-attached shells (the `bash` tool and `!command` mode) from PTY creation, which has no session context. It cannot distinguish the `bash` tool from `!command` mode.

The OpenCode server binds to the configured `OPENCODE_HOST` regardless of enforcement, so the password guard for non-loopback hosts applies in both modes.

## Host Requirements

Sandboxing requires KVM on a Linux host and access to Linux `/proc` for process identity attestation. Start the Manager with the sandbox overlay:

```bash
docker compose -f docker-compose.yml -f docker-compose.sandbox.yml up -d
```

The overlay exposes `/dev/kvm`, `/dev/net/tun`, and `NET_ADMIN` without enabling full container privilege. Docker Desktop on macOS and Windows cannot provide `/dev/kvm`, so the sandbox toggle remains unavailable there.

## Scope and Lifecycle

All projects share one microVM named `ocm-workspace`:

- It mounts `/workspace/repos` and `/workspace/schedule-worktrees` at identical guest paths.
- Repositories and worktrees created after boot are visible immediately because their parent roots are mounted.
- Each command supplies its own working directory through `msb exec -w`.
- A session outside the mounted roots is refused rather than executed on the host.
- The Manager verifies the microVM image, resources, user, network policy, mounts (including the `/tmp` tmpfs size and mount options), and labels before reuse. `/tmp` is the only tmpfs the microVM may carry; any other tmpfs fails attestation.
- MSB pulls the configured `SANDBOX_IMAGE` (default `docker.io/cstechdev/ocm-sandbox:latest`) automatically; see [Sandbox Guest Image](#sandbox-guest-image) to build your own.
- The Manager pins a neutral `/usr/bin/env` entrypoint, so the image's own OCI entrypoint is never inherited.
- A stale or unverifiable microVM is removed and recreated.
- Manager shutdown and an enforced-to-disabled restart stop the managed microVM.

To remove it manually:

```bash
msb rm --force --label ocm.managed=true
```

## Mounts and Secrets

The microVM receives writable bind mounts for:

- `/workspace/repos`
- `/workspace/schedule-worktrees`

No internal API token exists anywhere under the mounted roots. The token lives in the Manager's database and reaches the generated plugins only through the `OCM_INTERNAL_TOKEN` environment variable of the Manager's own OpenCode process, which is never part of the guest environment.

Because `localhost` inside the microVM is the guest rather than the Manager, and because the guest has no token to present, an agent command cannot call the internal API with `curl`. Agents reach the Manager through the `ocm` tool instead, which executes in the Manager's own OpenCode process. The tool's `request` action covers settings, repos, OpenCode workspaces, and schedules through an allow-list of internal API routes, while `send_notification` covers push notifications.

The microVM also mounts a runtime-owned tmpfs at `/tmp`. It is sized to one quarter of the microVM memory, clamped to 1-512 MiB, so agent commands get writable scratch space that is not backed by a host filesystem.

The following remain outside the microVM:

| Host path | Contents |
|-----------|----------|
| `/workspace/config` | SSH configuration and known hosts |
| `/workspace/.ssh-keys` | Repository SSH private keys |
| `/workspace/.config` | OpenCode configuration and generated plugins |
| `/workspace/.opencode/state` | Provider credentials |

OpenCode's host process still reads these paths normally. They are omitted only from the agent command environment.

## Enabling and Enforcement

1. Enable **Sandbox** in Settings.
2. Restart the OpenCode server when prompted.
3. The Manager starts the new child with `OCM_SANDBOX_ENFORCED=true`.
4. The Manager writes the shell shim next to the generated plugins and refuses to start an enforced server if it cannot.
5. The sandbox plugin resolves each `bash` tool working directory through the internal planner and pins it for the shim.
6. If capability detection, planning, boot, attestation, or working-directory pinning fails, the tool call fails instead of running on the host.

A directory outside the mounted roots fails with:

```text
Sandbox enforcement is on but the sandbox is unavailable: working directory is outside the sandboxed project roots (/workspace/repos, /workspace/schedule-worktrees)
```

The enforcement stamp remains authoritative for the lifetime of the OpenCode child, even if the setting changes before the required restart.

## Worktree Placement

- Scheduled runs use worktrees under `/workspace/schedule-worktrees` when OpenCode's workspace API returns a path beneath unmounted state storage.
- User-created OpenCode worktrees outside the mounted roots are created normally; only a later agent `bash` call whose working directory is outside the mounts is refused by the planner.
- External repositories symlinked into `/workspace/repos` remain outside the microVM because the link target is not mounted.

## Git Credentials in the Sandbox

The guest environment is empty by default, so a sandboxed `git push`, `git pull`, or `gh` call has no credentials and fails to authenticate. This applies to agent `bash` calls and to WebUI `!command` shell mode alike, since both are routed into the microVM.

Forwarding is opt-in, off by default:

| Scope | Where | Effect |
| --- | --- | --- |
| Global | Settings → Sandbox → *Git credentials in sandbox* (`preferences.sandbox.gitCredentials`) | Default for every repo |
| Per repo | `repo_settings.sandboxGitCredentials` | Overrides the global default in either direction. The planner honours it when resolving credentials, but nothing writes it yet — there is no UI or API for the per-repo override |

When enabled, the planner resolves credentials on the host and the shim forwards them into the microVM with `msb exec -e`:

- One `http.<host>.extraheader` pair per configured host, so a command can authenticate against every host you have a credential for, not just the repo's own remote.
- Where several credentials share a host, the repo-bound credential wins, then `defaultGitCredentialId`. Exactly one credential is ever sent per host — git treats `http.<url>.extraheader` as multi-valued and would otherwise send competing `Authorization` headers.
- `GIT_AUTHOR_*` / `GIT_COMMITTER_*` so `git commit` has an identity, and `GH_TOKEN` / `GITHUB_TOKEN` for `gh`.
- At most 16 hosts. Beyond that the Manager logs a warning and forwards the first 16 rather than emitting a `GIT_CONFIG_COUNT` that git would reject.

Both the switch and the credentials themselves are resolved per command, so turning forwarding on or off, or changing a credential, takes effect on the next sandboxed command without restarting the OpenCode server. Only the sandbox enable toggle requires a restart.

Understand the trade-off before enabling it. `msb exec -e` is the only injection mechanism microsandbox offers, so the token is visible in the `msb` process arguments on the host and in the guest environment for that command's lifetime. A prompt-injected agent inside the microVM can read and exfiltrate any credential you forward. The global switch is the only exposed control today, so enabling it applies to every repo; leave it off while any agent handles untrusted input.

## Sandbox Guest Image

`SANDBOX_IMAGE` defaults to `docker.io/cstechdev/ocm-sandbox:latest`, built from `Dockerfile.sandbox` in this repository and published for `linux/amd64` and `linux/arm64` from a build host with `docker buildx`:

```bash
docker buildx build --platform linux/amd64,linux/arm64 \
  -t docker.io/cstechdev/ocm-sandbox:latest \
  --build-arg PLAYWRIGHT_VERSION=1.56.0 \
  -f Dockerfile.sandbox --load .
docker tag docker.io/cstechdev/ocm-sandbox:latest docker.io/cstechdev/ocm-sandbox:0.17.1
docker push docker.io/cstechdev/ocm-sandbox:latest
docker push docker.io/cstechdev/ocm-sandbox:0.17.1
```

It is `node:24` (Debian 12, `buildpack-deps` based), so the compile toolchain is already present, plus the package managers and CLI tooling from the Manager image:

| Tool | Source | Notes |
| --- | --- | --- |
| `gcc` / `g++` / `make` / `ld` / `pkg-config` | `node:24` | GCC 12.2, GNU Make 4.3 |
| `glib-2.0` | `node:24` | 2.74.6, with `pkg-config` metadata |
| `git`, `ssh`, `python3`, `curl`, `unzip` | `node:24` | git 2.39.5 |
| `pnpm` | corepack | Prewarmed into a shared, writable `COREPACK_HOME` (`/usr/local/share/corepack`), so the exec user runs the build-time version offline. A project `packageManager` pin of a different version downloads on first use |
| `bun`, `bunx` | official installer | Installed to `/opt/bun`, world-readable, both symlinked onto `PATH` |
| `uv`, `uvx` | Astral installer | Standalone binaries on `PATH`; `uv tool` shims land in `/opt/agent-tools/bin`, which is on `PATH` |
| `npm -g`, `pnpm -g` | npm / corepack | Global installs redirect to `/opt/agent-tools` (`npm_config_prefix`, `PNPM_HOME`), so they are writable for the exec user and their binaries are on `PATH` |
| `sudo` | apt | Passwordless for every guest user via `/etc/sudoers.d/ocm-guest`; system-wide `apt-get install` works from the exec user |
| `pip`, `venv` | apt | `python3-pip` and `python3-venv` on top of the base `python3`. Debian's externally-managed marker is removed, so `pip` and `uv pip --system` are not refused; system-wide writes still need `sudo`, so use `--user` or a venv |
| `jq`, `ripgrep`, `less`, `tree`, `file`, `procps` | apt | Common CLI tools agent workflows expect |
| `gh` | official `cli.github.com` apt repo | Current release. Debian's own package is several years stale |
| Chromium | Playwright (`PLAYWRIGHT_VERSION`, default `1.56.0`) | Installed to `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`, world-readable so `SANDBOX_EXEC_USER` can launch it |

`NODE_PATH=/usr/local/lib/node_modules` is set so agent code can `require("playwright")` from any working directory. It is only a resolution fallback; a project-local `node_modules` still wins.

The guest runs every command as a numeric host uid that has no `/etc/passwd` entry in the image, so the uncorrected default `HOME` is `/` and anything that writes per-user state — the pnpm store, uv and pip caches, `git config`, `gh` config — dies with `EACCES` on the first run. The image therefore sets `HOME=/home/ocm-agent` (mode 1777), prewarms corepack into a world-readable `COREPACK_HOME`, and puts a world-writable `/opt/agent-tools/bin` on `PATH` for `uv tool` and global package-manager installs. Image `ENV` reaches `msb exec` commands verbatim, including for unknown uids. The image build verifies the whole toolchain as an unprivileged uid so a root-only regression fails the build instead of the agent.

`sudo` also needs the exec user to exist in the guest, which the image cannot know at build time. The Manager provisions the `/etc/passwd`, `/etc/group`, and `/etc/shadow` entries for the exec uid through an idempotent root exec (verified by `getent`, so repeats are no-ops) at three points: when the workspace sandbox is created, when a stopped sandbox is started, and once at Manager startup for a sandbox that is already running. Without the entries, `sudo` refuses with "you do not exist in the passwd database" or a PAM "account validation failure". Only a sandbox created before this mechanism existed and never started again slips through; remove it once with `msb rm -f ocm-workspace` to pick up sudo and the fixed toolchain.

Chromium launches headless as the non-root exec user without extra flags. If your host kernel restricts user namespaces so Chromium's own sandbox fails, pass `--no-sandbox` — the microVM is already the isolation boundary.

The image is over 3 GB against a 1.6 GB `node:24` baseline, almost entirely Chromium and its dependencies. The first pull is bounded by `SANDBOX_START_TIMEOUT_MS`; raise it on slow links.

### Using your own image

Point `SANDBOX_IMAGE` at any OCI reference the host can pull. It must contain every tool the agent expects to run, and a shell at `/bin/sh`. Changing the value is safe at runtime: the running microVM fails image attestation and is recreated automatically.

To build it on the server instead of pulling:

```bash
docker build -f Dockerfile.sandbox -t my-sandbox:local .
# then set SANDBOX_IMAGE=my-sandbox:local
```

Pin a concrete tag or digest rather than a floating one. Attestation compares the image *reference string*, so a mutable tag keeps passing attestation while the underlying image drifts.

Override the Playwright version at build time with `--build-arg PLAYWRIGHT_VERSION=1.57.0`. If your project drives Playwright itself, match this version to the one in your `package.json`; a mismatched browser revision makes Playwright refuse to launch.

## Caveats

- The first command pays image pull and microVM boot latency, bounded by `SANDBOX_START_TIMEOUT_MS`.
- `SANDBOX_IMAGE` must contain every tool the agent expects to run.
- `SANDBOX_EXEC_USER` must match the workspace owner so commands can write mounted files.
- A `shell` the user configured does not apply to slash-command shell templates while enforcement is on, and is bypassed for `!command` shell mode because that surface is routed into the microVM.
- Credentials injected into OpenCode's host shell environment are not forwarded into the microVM unless git credential forwarding is enabled; see [Git Credentials in the Sandbox](#git-credentials-in-the-sandbox).
- Message parts recorded by older releases still hold the old `msb exec` wrapper; the WebUI unwraps them for display and still badges them.
- Plugins and other configured host-process extensions are trusted and are not isolated by agent `bash` sandboxing.
