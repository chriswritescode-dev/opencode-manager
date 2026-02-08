# Docker Configuration

Advanced Docker setup and configuration options.

## Basic Setup

```bash
git clone https://github.com/chriswritescode-dev/opencode-manager.git
cd opencode-manager
docker-compose up -d
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
    volumes:
      - opencode-workspace:/workspace
      - opencode-data:/app/data
    environment:
      - NODE_ENV=production
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

## Environment Variables

### Using .env File

Create `.env` in project root:

```bash
AUTH_SECRET=your-secret-here
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=secure-password
```

Reference in docker-compose.yml:

```yaml
env_file:
  - .env
```

### Inline Environment

Set directly in docker-compose.yml:

```yaml
environment:
  - NODE_ENV=production
  - AUTH_SECRET=your-secret-here
  - ADMIN_EMAIL=admin@example.com
```

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

# Pull latest base images
docker-compose pull

# Update and restart
docker-compose pull && docker-compose up -d --build
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

## Troubleshooting

### Container Won't Start

```bash
# Check logs
docker-compose logs

# Check if port is in use
lsof -i :5003

# Try running in foreground
docker-compose up
```

### Permission Issues

```bash
# Fix workspace permissions
sudo chown -R $(id -u):$(id -g) ./workspace ./data

# Or run with specific user
docker-compose run --user $(id -u):$(id -g) opencode-manager
```

### Out of Disk Space

```bash
# Check Docker disk usage
docker system df

# Clean up unused resources
docker system prune -a

# Remove unused volumes
docker volume prune
```
