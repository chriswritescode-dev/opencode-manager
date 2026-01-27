# Installation

Choose your preferred installation method.

## Docker (Recommended)

Docker is the fastest way to get started and recommended for production use.

```bash
git clone https://github.com/chriswritescode-dev/opencode-manager.git
cd opencode-manager
docker-compose up -d
```

Open [http://localhost:5003](http://localhost:5003) in your browser.

### What Docker Sets Up

The container automatically:

- Installs OpenCode if not present
- Builds and serves the frontend
- Creates persistent volumes for workspace and database
- Configures health checks and auto-restart

### Docker Commands

```bash
# Start the container
docker-compose up -d

# Stop and remove container
docker-compose down

# Rebuild the image
docker-compose build

# View logs
docker-compose logs -f

# Restart
docker-compose restart

# Access container shell
docker exec -it opencode-manager sh
```

### Volume Mounts

| Path | Purpose |
|------|---------|
| `./workspace` | Repository storage |
| `./data` | Database and config |
| `opencode-cache` | OpenCode cache |

## Local Development

For contributors who want to develop locally instead of using Docker.

### Prerequisites

- [pnpm](https://pnpm.io/installation) - Package manager (required for workspaces)
- [Bun](https://bun.sh) - Backend runtime
- [OpenCode TUI](https://opencode.ai) - `npm install -g @opencode/tui`
- Node.js 18+

### Setup

```bash
# Clone the repository
git clone https://github.com/chriswritescode-dev/opencode-manager.git
cd opencode-manager

# Install dependencies
pnpm install

# Copy environment configuration
cp .env.example .env

# Start development servers
pnpm dev
```

This starts:

- Backend on http://localhost:5003
- Frontend on http://localhost:5173 (with HMR)

## Verifying Installation

After starting the application:

1. Open your browser to the appropriate URL
2. You should see the login page or setup wizard
3. Check logs if you encounter issues: `docker-compose logs -f`

## Next Steps

- [Quick Start](quickstart.md) - First steps after installation
- [First Run Setup](first-run.md) - Creating your admin account
- [Docker Configuration](../configuration/docker.md) - Advanced Docker settings
