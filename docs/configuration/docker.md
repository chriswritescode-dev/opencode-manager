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
    container_name: opencode-manager
    ports:
      - "5003:5003"      # OpenCode Manager
      - "5100:5100"      # Dev server 1
      - "5101:5101"      # Dev server 2
      - "5102:5102"      # Dev server 3
      - "5103:5103"      # Dev server 4
    environment:
      - NODE_ENV=${NODE_ENV:-production}
      - HOST=0.0.0.0
      - PORT=5003
      - OPENCODE_SERVER_PORT=5551
      - DATABASE_PATH=/app/data/opencode.db
      - WORKSPACE_PATH=/workspace
      - AUTH_SECRET=${AUTH_SECRET}
      - AUTH_TRUSTED_ORIGINS=${AUTH_TRUSTED_ORIGINS:-http://localhost:5003}
      - ADMIN_EMAIL=${ADMIN_EMAIL:-}
      - ADMIN_PASSWORD=${ADMIN_PASSWORD:-}
      # OAuth providers (optional)
      - GITHUB_CLIENT_ID=${GITHUB_CLIENT_ID:-}
      - GITHUB_CLIENT_SECRET=${GITHUB_CLIENT_SECRET:-}
      # Passkeys (optional)
      - PASSKEY_RP_ID=${PASSKEY_RP_ID:-localhost}
      - PASSKEY_RP_NAME=${PASSKEY_RP_NAME:-OpenCode Manager}
      - PASSKEY_ORIGIN=${PASSKEY_ORIGIN:-http://localhost:5003}
      # Push notifications (optional)
      - VAPID_PUBLIC_KEY=${VAPID_PUBLIC_KEY:-}
      - VAPID_PRIVATE_KEY=${VAPID_PRIVATE_KEY:-}
      - VAPID_SUBJECT=${VAPID_SUBJECT:-}
    volumes:
      - opencode-workspace:/workspace
      - opencode-data:/app/data
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

1. **Installs Bun** if not present
2. **Installs OpenCode** if not present
3. **Upgrades OpenCode** if below minimum version (1.0.137)
4. **Validates AUTH_SECRET** is set (required for startup)
5. **Validates memory plugin** installation

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
  - opencode-workspace:/workspace
```

All cloned repositories are stored here. Uses a named volume for data persistence across container recreations.

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

# Stop
docker-compose down

# Restart
docker-compose restart

# View logs
docker-compose logs -f

# View logs (last 100 lines)
docker-compose logs --tail 100
```

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
