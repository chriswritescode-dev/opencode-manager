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
| WebUI `!command` shell mode (`POST /session/:id/shell`) | No; normal OpenCode behavior |
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

WebUI `!command` shell mode, slash-command shell templates, and PTY terminals follow OpenCode's normal host-process behavior during enforcement. Only the OpenCode `bash` tool is routed into the microVM; these surfaces are not sandboxed.

They also spawn the shim, because it is the configured shell, but no working directory is injected for them, so the shim passes the command straight through to the host shell. PTY terminals receive the user's configured shell; `!command` shell mode and slash-command shell templates fall back to the shell the Manager resolved at startup rather than a login shell.

The OpenCode server binds to the configured `OPENCODE_HOST` regardless of enforcement, so the password guard for non-loopback hosts applies in both modes.

## Host Requirements

Sandboxing requires KVM on a Linux host. Start the Manager with the sandbox overlay:

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
- MSB pulls the configured `SANDBOX_IMAGE` (default `node:24`) automatically; no custom image build is needed.
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

## Caveats

- The first command pays image pull and microVM boot latency, bounded by `SANDBOX_START_TIMEOUT_MS`.
- `SANDBOX_IMAGE` must contain every tool the agent expects to run.
- `SANDBOX_EXEC_USER` must match the workspace owner so commands can write mounted files.
- A `shell` the user configured does not apply to `!command` shell mode or slash-command shell templates while enforcement is on.
- Credentials injected into OpenCode's host shell environment are not forwarded into the microVM.
- Message parts recorded by older releases still hold the old `msb exec` wrapper; the WebUI unwraps them for display and still badges them.
- Plugins and other configured host-process extensions are trusted and are not isolated by agent `bash` sandboxing.
