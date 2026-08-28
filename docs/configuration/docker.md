# Docker Configuration

Advanced Docker setup and configuration options.

## Basic Setup

```bash
git clone https://github.com/chriswritescode-dev/opencode-manager.git
cd opencode-manager

# Copy and configure environment
cp .env.example .env

# Generate a secure AUTH_SECRET
openssl rand -base64 32
# Add the output to AUTH_SECRET in .env

# Start the container
docker-compose up -d
```

!!! warning "AUTH_SECRET Required"
    The container will not start without `AUTH_SECRET` set in your `.env` file. Generate one with:
    ```bash
    openssl rand -base64 32
    ```

## docker-compose.yml

Default configuration:

```yaml
services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
      args:
        TOOLS_CACHEBUST: ${TOOLS_CACHEBUST:-0}
    container_name: opencode-manager
    ports:
      - "5003:5003"
      - "5100:5100"
      - "5101:5101"
      - "5102:5102"
      - "5103:5103"
    environment:
      - NODE_ENV=${NODE_ENV:-production}
      - PUID=${PUID:-1000}
      - PGID=${PGID:-1000}
      - HOST=0.0.0.0
      - PORT=5003
      - OPENCODE_SERVER_PORT=5551
      - OPENCODE_HOST=127.0.0.1
      - DATABASE_PATH=/app/data/opencode.db
      - WORKSPACE_PATH=/workspace
      - PROCESS_START_WAIT_MS=2000
      - PROCESS_VERIFY_WAIT_MS=1000
      - HEALTH_CHECK_TIMEOUT_MS=30000
      - MAX_FILE_SIZE_MB=50
      - MAX_UPLOAD_SIZE_MB=50
      - DEBUG=false
      - AUTH_SECRET=${AUTH_SECRET}
      - AUTH_TRUSTED_ORIGINS=${AUTH_TRUSTED_ORIGINS:-http://localhost:5003}
      - ADMIN_EMAIL=${ADMIN_EMAIL:-}
      - ADMIN_PASSWORD=${ADMIN_PASSWORD:-}
      - ADMIN_PASSWORD_RESET=${ADMIN_PASSWORD_RESET:-false}
      - GITHUB_CLIENT_ID=${GITHUB_CLIENT_ID:-}
      - GITHUB_CLIENT_SECRET=${GITHUB_CLIENT_SECRET:-}
      - GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID:-}
      - GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET:-}
      - DISCORD_CLIENT_ID=${DISCORD_CLIENT_ID:-}
      - DISCORD_CLIENT_SECRET=${DISCORD_CLIENT_SECRET:-}
      - AUTH_SECURE_COOKIES=${AUTH_SECURE_COOKIES:-false}
      - PASSKEY_RP_ID=${PASSKEY_RP_ID:-localhost}
      - PASSKEY_RP_NAME=${PASSKEY_RP_NAME:-OpenCode Manager}
      - PASSKEY_ORIGIN=${PASSKEY_ORIGIN:-http://localhost:5003}
      - VAPID_PUBLIC_KEY=${VAPID_PUBLIC_KEY:-}
      - VAPID_PRIVATE_KEY=${VAPID_PRIVATE_KEY:-}
      - VAPID_SUBJECT=${VAPID_SUBJECT:-}
    volumes:
      - ${OCM_WORKSPACE_HOST_PATH:-opencode-workspace}:/workspace
      - opencode-data:/app/data
      - opencode-bin:/home/node/.opencode/bin
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:5003/api/health"]
      interval: 30s
      timeout: 3s
      retries: 3
      start_period: 40s

volumes:
  opencode-workspace:
    driver: local
  opencode-data:
    driver: local
  opencode-bin:
    driver: local
```

## Environment Variables

Create a `.env` file in the project root. The docker-compose.yml automatically reads variables from `.env`:

```bash
# Required
AUTH_SECRET=generate-with-openssl-rand-base64-32

# Optional - pre-configured admin
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=your-secure-password

# Optional - OAuth providers
GITHUB_CLIENT_ID=your-client-id
GITHUB_CLIENT_SECRET=your-client-secret

# Optional - passkeys
PASSKEY_RP_ID=localhost
PASSKEY_ORIGIN=http://localhost:5003

# Optional - push notifications
VAPID_PUBLIC_KEY=BMx-1234567890abcdefghijklmnopqrstuv...
VAPID_PRIVATE_KEY=abcd1234567890abcdef...
VAPID_SUBJECT=mailto:you@example.com
```

## Entrypoint Behavior

The container entrypoint (`scripts/docker-entrypoint.sh`) automatically:

1. **Verifies Bun** is installed (installed at build time, fallback install if missing)
2. **Reconciles the persisted OpenCode home binary** (`/home/node/.opencode/bin/opencode`):
   - any valid persisted binary is retained, including a user-selected version older than the image-bundled `OPENCODE_BUNDLED_VERSION`;
   - a persisted binary that is malformed or unversioned is removed (only that binary), so `PATH` falls back to the image-bundled `/usr/local/bin/opencode` without a download
3. **Installs OpenCode** only when no usable binary is present: if opencode is missing entirely, or if the surviving binary is still below the minimum version (1.0.137), the pinned bundled version is downloaded into the persisted `bin` volume
4. **Validates AUTH_SECRET** is set (required for startup)
5. **Aligns the `node` account** to `PUID`/`PGID` (default `1000`) before chowning the workspace, the `/app/data` directory, and the `node` home directory. If `PUID`/`PGID` are already used by another account in the image, startup aborts with an explicit error. Group alignment runs first, so a free `PGID` combined with an occupied `PUID` mutates `/etc/group` before the UID collision is detected and aborts startup; realign to the original ids or pick a free pair before retrying.

## Port Configuration

### Main Application

The application runs on port 5003 by default:

```yaml
ports:
  - "5003:5003"
```

Change the host port if needed:

```yaml
ports:
  - "8080:5003"  # Access at localhost:8080
```

### Dev Server Ports

Ports 5100-5103 are exposed for running dev servers inside repositories:

```yaml
ports:
  - "5100:5100"
  - "5101:5101"
  - "5102:5102"
  - "5103:5103"
```

Configure your dev server to use one of these ports:

=== "Vite"

    ```typescript
    // vite.config.ts
    export default {
      server: {
        port: 5100,
        host: '0.0.0.0'
      }
    }
    ```

=== "Next.js"

    ```bash
    next dev -p 5100 -H 0.0.0.0
    ```

=== "Express"

    ```javascript
    app.listen(5100, '0.0.0.0')
    ```

## Volume Mounts

### Workspace

Repository storage:

```yaml
volumes:
  - ${OCM_WORKSPACE_HOST_PATH:-opencode-workspace}:/workspace
```

All cloned repositories are stored here. Defaults to a named volume for data persistence across container recreations.

#### Accessing Repositories From the Host

To work in the cloned repositories from the host instead of through `docker exec`, bind `/workspace` to a host directory and run the container as your host user so the files stay usable from the host without root. Add to `.env`:

```bash
# Output of `id -u` and `id -g` on the host
PUID=1000
PGID=1000
OCM_WORKSPACE_HOST_PATH=/absolute/path/to/opencode-workspace
```

`OCM_WORKSPACE_HOST_PATH` is consumed verbatim as the compose mount source, so an absolute or `./`-relative path becomes a bind mount while the default value (`opencode-workspace`) stays a named volume. `PUID`/`PGID` are applied before the workspace is chowned, so agent-created files are host-owned and both sides share one uid &mdash; which also avoids git's "dubious ownership" warning.

To migrate an existing named volume to a bind mount without losing data, copy the volume contents into the host directory with a one-off container &mdash; this works whether `<host path>` already exists or not, and avoids depending on Docker's internal storage path (`/var/lib/docker/...` differs on Docker Desktop, rootless Docker, and custom data roots). The destination must be empty; if it is not, the recipe aborts without copying anything so existing files are never overwritten:

```bash
docker compose stop
mkdir -p "<host path>"
# Abort if the destination is non-empty so we never overwrite existing files.
if [ -n "$(ls -A "<host path>")" ]; then
  echo "destination '<host path>' is not empty; aborting migration" >&2
  exit 1
fi
# `<project>` is the Compose project name, usually the directory containing docker-compose.yml.
docker run --rm \
  -v <project>_opencode-workspace:/from:ro \
  -v "<host path>":/to alpine sh -c 'cp -a /from/. /to/'
sudo chown -R "$(id -u):$(id -g)" "<host path>"
docker compose up -d
# After confirming /workspace contains your repositories, remove the old volume:
docker volume rm <project>_opencode-workspace
```

The quoted `"<host path>"` keeps paths containing spaces (for example `/Users/name/My Repositories`) intact across `mkdir`, the Docker `-v` argument, and `chown`. With the empty-destination guard in place, `cp -a /from/. /to/` copies the volume's *contents* (not its `_data` directory) directly into the bind-mount root, so repositories land directly beneath the mounted `/workspace`. The named volume is left in place until you confirm the migration succeeded.

!!! warning "Set PUID before switching to a bind mount"
    A wrong `PUID` makes startup chown the whole host directory. The entrypoint prints a warning naming both uids, but it does not block the chown.

!!! warning "Concurrent git access"
    Editing a repository from the host while an agent works in the same repository or worktree can collide on `index.lock` and branch state.

!!! note "/app keeps the build-time uid"
    `/app` and its `node_modules` are chowned to uid 1000 at build time and are read-only at runtime. When `PUID` differs, the container runs the code as a different uid, but since `/app` is only read (never written) at runtime, it is left untouched and startup stays fast.

### Data

Database and configuration:

```yaml
volumes:
  - opencode-data:/app/data
```

Contains:
- SQLite database
- User settings
- Session data

Uses a named volume for data persistence.

### OpenCode Binary

```yaml
volumes:
  - opencode-bin:/home/node/.opencode/bin
```

Persists the OpenCode binary that OpenCode's own `upgrade --method curl` command (run from the UI's OpenCode settings) installs into `~/.opencode/bin`, so an upgrade survives container recreations. The volume is limited to the binary and leaves existing workspace and XDG persistence behavior for config, auth, and chat state unchanged.

On startup the entrypoint reconciles the persisted binary:

- any valid persisted binary is retained, including a user-selected version older than the image-bundled `OPENCODE_BUNDLED_VERSION`;
- a malformed or unversioned persisted binary is removed so `PATH` falls back to the image-bundled `/usr/local/bin/opencode`, avoiding a download;
- a persisted binary still below the minimum version (1.0.137) is replaced by the pinned bundled version, which is downloaded into this volume.

A fresh volume starts empty and the image-bundled binary is used until an upgrade installs into the volume.

### Import Existing OpenCode Chats From Your Host

If you already use standalone OpenCode on your machine and want Dockerized OpenCode Manager to show those chats on first setup, bind your host OpenCode config/state into the container and bind your repo root to the same absolute path that standalone OpenCode used.

Add to `.env`:

```bash
OCM_REPOS_HOST_PATH=/Users/you/Development
OCM_OPENCODE_CONFIG_HOST_PATH=/Users/you/.config/opencode
OCM_OPENCODE_STATE_HOST_PATH=/Users/you/.local/share/opencode
```

Then add a compose override:

```yaml
services:
  app:
    environment:
      - OPENCODE_IMPORT_CONFIG_PATH=/import/opencode-config/opencode.json
      - OPENCODE_IMPORT_STATE_PATH=/import/opencode-state
    volumes:
      - ${OCM_REPOS_HOST_PATH}:${OCM_REPOS_HOST_PATH}:ro
      - ${OCM_OPENCODE_CONFIG_HOST_PATH}:/import/opencode-config:ro
      - ${OCM_OPENCODE_STATE_HOST_PATH}:/import/opencode-state:ro
```

Why the repo mount uses the host path as the container path:

- standalone OpenCode stores chats against absolute directory paths
- mounting `${OCM_REPOS_HOST_PATH}` to the same path inside the container preserves those paths exactly
- OpenCode Manager can then discover that folder and create its normal workspace links under `/workspace/repos`

With a fresh Docker volume, first startup imports the host OpenCode config and state, and after you add `${OCM_REPOS_HOST_PATH}` in the Manager UI, previously existing chats appear under the discovered repositories.

## Agent Sandboxing Overlay

Optional KVM-backed agent sandboxing (see [Agent Sandboxing](../features/sandboxing.md)). The sandbox overlay (`docker-compose.sandbox.yml`) grants the container KVM and guest-networking access, passes sandbox tuning through from `.env`, and persists microsandbox state. It deliberately avoids `privileged: true`, granting only the specific devices and capability `msb` needs:

```yaml
services:
  app:
    devices:
      - "/dev/kvm:/dev/kvm"
      - "/dev/net/tun:/dev/net/tun"
    cap_add:
      - NET_ADMIN
    environment:
      - SANDBOX_IMAGE=${SANDBOX_IMAGE:-docker.io/cstechdev/ocm-sandbox@sha256:74a9f12e1c1768e36bc159c4c7efb70ab9c47da5f46f93763ddb282dd58ad79c}
      - SANDBOX_MEMORY=${SANDBOX_MEMORY:-4G}
      - SANDBOX_CPUS=${SANDBOX_CPUS:-2}
      - SANDBOX_EXEC_USER=${SANDBOX_EXEC_USER:-${PUID:-1000}}
      - SANDBOX_NET=${SANDBOX_NET:-public}
      - SANDBOX_START_TIMEOUT_MS=${SANDBOX_START_TIMEOUT_MS:-300000}
      - SANDBOX_EXEC_TIMEOUT_MS=${SANDBOX_EXEC_TIMEOUT_MS:-600000}
    volumes:
      - microsandbox-data:/home/node/.microsandbox

volumes:
  microsandbox-data:
    driver: local
```

Start the Manager with the overlay:

```bash
docker compose -f docker-compose.yml -f docker-compose.sandbox.yml up -d
```

The overlay requires a Linux host with `/dev/kvm`. Docker Desktop on macOS and Windows cannot provide `/dev/kvm`, so the sandbox toggle in Settings stays disabled there. `/dev/net/tun` and `NET_ADMIN` provide guest networking for `SANDBOX_NET=public`; if `msb` reports a missing device or capability on a particular host, add that specific entry rather than enabling full privilege.

`SANDBOX_EXEC_USER` defaults to the numeric `PUID` (falling back to `1000`), and the Manager runs every sandboxed command as that numeric uid (with the Manager's gid). Because the entrypoint realigns the container's `node` account to `PUID`/`PGID` and re-owns `/workspace`, a non-1000 `PUID` (for example `PUID=1001`) writes to the mounted repositories with the same identity as the workspace owner. If a configured `SANDBOX_EXEC_USER` cannot match the workspace owner, the toggle reports enforcement as unavailable instead of running broken commands.

The `microsandbox-data` volume persists microsandbox's own state (downloaded images, firmware cache) across container recreations, alongside the workspace and data volumes.

## Health Checks

The container includes health checks:

```yaml
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:5003/api/health"]
  interval: 30s
  timeout: 3s
  retries: 3
  start_period: 40s
```

Check health status:

```bash
docker inspect --format='{{.State.Health.Status}}' opencode-manager
```

## Resource Limits

Limit container resources:

```yaml
services:
  opencode-manager:
    # ... other config
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 4G
        reservations:
          cpus: '0.5'
          memory: 1G
```

## Networking

### Custom Network

Create an isolated network:

```yaml
services:
  opencode-manager:
    networks:
      - opencode-net

networks:
  opencode-net:
    driver: bridge
```

### Host Network

Use host networking (Linux only):

```yaml
services:
  opencode-manager:
    network_mode: host
```

## Commands

### Basic Operations

```bash
# Start
docker-compose up -d

# Stop (containers removed; named volumes are preserved)
docker-compose down

# Stop and remove containers and all named volumes (workspace, database, OpenCode binary)
docker-compose down -v

# Restart
docker-compose restart

# View logs
docker-compose logs -f

# View logs (last 100 lines)
docker-compose logs --tail 100
```

The package scripts mirror these: `pnpm docker:down` stops and removes containers while preserving all named volumes, and `pnpm docker:reset` is the destructive variant that also deletes the workspace, database, and OpenCode binary volumes.

### Maintenance

```bash
# Rebuild image
docker-compose build

# Rebuild without cache
docker-compose build --no-cache

# Update and restart (uses upgrade script)
docker-compose down
git pull
docker-compose build --no-cache
docker-compose up -d
```

### Debugging

```bash
# Access shell
docker exec -it opencode-manager sh

# View running processes
docker exec opencode-manager ps aux

# Check disk usage
docker exec opencode-manager df -h

# View environment
docker exec opencode-manager env
```

## Global Agent Instructions

The container creates a default `AGENTS.md` file at `/workspace/.config/opencode/AGENTS.md`.

### Default Content

Instructions for AI agents working in the container:
- Reserved ports information
- Available dev server ports
- Docker-specific guidelines

### Editing

**Via UI:** Settings > OpenCode > Global Agent Instructions

**Via File:**
```bash
docker exec -it opencode-manager vi /workspace/.config/opencode/AGENTS.md
```

### Precedence

Global instructions merge with repository-specific `AGENTS.md` files. Repository instructions take precedence.

## Exposing the OpenCode Server (Advanced)

By default, the OpenCode server binds to `127.0.0.1` inside the container and is **not reachable from outside the container**. This is the correct and safe default for nearly all users.

### When to Expose Externally

You only need to expose the OpenCode server on an external interface if you have a specific use case that requires other services or machines to connect directly to it.

!!! warning "Sandbox enforcement is agent-tool-scoped"
    Sandbox enforcement applies only to the OpenCode agent `bash` tool. The rewrite runs as a plugin hook inside the OpenCode process, so it guards both proxied and direct connections to the OpenCode server. WebUI shell, slash shell, PTY, and server binding follow normal OpenCode behavior while sandboxing is enabled (see [Agent Sandboxing](../features/sandboxing.md)).

### How to Expose Safely

To expose the OpenCode server on the host network:

1. **Set `OPENCODE_HOST=0.0.0.0`** in your environment
2. **Add port `5551:5551`** to the compose ports
3. **Set `OPENCODE_SERVER_PASSWORD`** — this is **required**; the managed OpenCode server will refuse to start without it

Example compose override:

```yaml
services:
  app:
    ports:
      - "5551:5551"
    environment:
      - OPENCODE_HOST=0.0.0.0
      - OPENCODE_SERVER_PASSWORD=${OPENCODE_SERVER_PASSWORD:?Set OPENCODE_SERVER_PASSWORD before exposing OpenCode on port 5551}
```

### Password Configuration

The password can be configured in two ways:

1. **Environment variable:** Set `OPENCODE_SERVER_PASSWORD` in your `.env` file or compose environment
2. **Via UI:** Use Settings → OpenCode → Server Auth to set a password at runtime

**DB-stored passwords take precedence over the environment variable.** If you set a password via the UI, it will override the env var.

### Startup Guard

If you set `OPENCODE_HOST=0.0.0.0` (or any non-localhost host) without configuring a password (either via env var or UI), the managed OpenCode server will refuse to start with an error message explaining how to fix it. The OpenCode Manager UI/API may remain available so you can configure a password and restart the managed server. The password guard applies in both sandboxing modes — an enforced server binds the configured `OPENCODE_HOST` like any other server.
