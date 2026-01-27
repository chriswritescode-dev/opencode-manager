# OpenCode Manager

Mobile-first web interface for [OpenCode](https://opencode.ai) AI agents. Manage, control, and code from any device - your phone, tablet, or desktop.

<!-- Replace with your hero GIF -->
![OpenCode Manager Demo](images/ocmgr-demo.gif)

## Quick Start

```bash
git clone https://github.com/chriswritescode-dev/opencode-manager.git
cd opencode-manager
docker-compose up -d
```

Open [http://localhost:5003](http://localhost:5003) and create your admin account. That's it!

## What is OpenCode Manager?

OpenCode Manager provides a web-based interface for OpenCode AI agents, allowing you to:

- **Manage repositories** - Clone, browse, and work with multiple git repos
- **Chat with AI** - Real-time streaming chat with file mentions and slash commands
- **View diffs** - See code changes with syntax highlighting
- **Control from anywhere** - Mobile-first PWA works on any device
- **Configure AI** - Manage models, providers, and MCP servers

## Key Features

- **Multi-Repository Support** - Clone and manage multiple git repos with private repo support
- **Git Integration** - View diffs, manage branches, create PRs directly from the UI
- **Real-time Chat** - Stream responses with file mentions and custom slash commands
- **Mobile-First PWA** - Install as an app on any device with offline support
- **AI Configuration** - Configure models, providers, OAuth, and custom agents
- **MCP Servers** - Add local or remote MCP servers with pre-built templates

## System Requirements

### Docker (Recommended)

- Docker Engine 20.10+
- Docker Compose v2+
- 2GB RAM minimum
- 5GB disk space

### Local Development

- [pnpm](https://pnpm.io) - Package manager
- [Bun](https://bun.sh) - Backend runtime
- [OpenCode TUI](https://opencode.ai) - `npm i -g @opencode/tui`
- Node.js 18+

## Next Steps

- [Installation Guide](getting-started/installation.md) - Detailed setup instructions
- [Quick Start](getting-started/quickstart.md) - Get up and running fast
- [Features Overview](features/overview.md) - Explore all features
- [Configuration](configuration/environment.md) - Environment variables and setup
