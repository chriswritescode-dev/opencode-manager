# OpenCode Manager

Mobile-first web interface for [OpenCode](https://opencode.ai) AI agents. Manage, control, and code from any device - your phone, tablet, or desktop.

<!-- Replace with your hero GIF showing the main workflow -->
![OpenCode Manager Demo](docs/images/ocmgr-demo.gif)

## Quick Start

```bash
git clone https://github.com/chriswritescode-dev/opencode-manager.git
cd opencode-manager
docker-compose up -d
# Open http://localhost:5003
```

On first launch, you'll be prompted to create an admin account. That's it!

## Screenshots

<table>
<tr>
<td><strong>Chat (Mobile)</strong></td>
</tr>
<tr>
<td><img src="https://github.com/user-attachments/assets/a48cc728-e540-4247-879a-c5f36c3fd6de" alt="chat-mobile" width="200" /></td>
</tr>
<tr>
<td><strong>File Browser (Mobile)</strong></td>
</tr>
<tr>
<td><img src="https://github.com/user-attachments/assets/24243e5e-ab02-44ff-a719-263f61c3178b" alt="files-mobile" width="200" /></td>
</tr>
<tr>
<td><strong>Inline Diff View</strong></td>
</tr>
<tr>
<td><img src="https://github.com/user-attachments/assets/b94c0ca0-d960-4888-8a25-a31ed6d5068d" alt="inline-diff-view" width="300" /></td>
</tr>
</table>

## Features

### Repository & Git
- **Multi-Repository Support** - Clone and manage multiple git repos with private repo support via GitHub PAT
- **Git Worktrees** - Work on multiple branches simultaneously
- **Source Control Panel** - View changes, commits, and branches in a unified interface
- **Diff Viewer** - Unified diffs with line numbers and change counts
- **Push PRs** - Create and push pull requests directly from the UI

### File Management
- **Directory Browser** - Navigate files with tree view and search
- **Syntax Highlighting** - Code preview with highlighting for all major languages
- **File Operations** - Create, rename, delete, and drag-and-drop upload
- **ZIP Download** - Download repos as ZIP (respects .gitignore)

### Chat & Sessions
- **Real-time Streaming** - Live message streaming with SSE
- **Slash Commands** - Built-in (`/help`, `/new`, `/compact`) and custom commands
- **File Mentions** - Reference files with `@filename` autocomplete
- **Plan/Build Modes** - Toggle between read-only and file-change modes
- **Mermaid Diagrams** - Visual diagram rendering in chat
- **Text-to-Speech** - Listen to AI responses with browser or OpenAI-compatible TTS

### AI Configuration
- **Model Selection** - Browse and filter available AI models
- **Provider Management** - Configure API keys or OAuth for providers
- **OAuth Support** - Secure OAuth login for Anthropic and GitHub Copilot
- **Custom Agents** - Create agents with custom system prompts and tool permissions
- **MCP Servers** - Add local or remote MCP servers with pre-built templates

### Mobile & PWA
- **Mobile-First Design** - Responsive UI optimized for mobile
- **PWA Installable** - Add to home screen on any device
- **iOS Optimized** - Proper keyboard handling and swipe navigation

## Installation

### Docker (Recommended)

```bash
git clone https://github.com/chriswritescode-dev/opencode-manager.git
cd opencode-manager
docker-compose up -d
```

The container automatically installs OpenCode, builds the frontend, and sets up persistent volumes.

**Common commands:**
```bash
docker-compose up -d      # Start
docker-compose down       # Stop
docker-compose logs -f    # View logs
docker-compose restart    # Restart
```

### Local Development

For contributors who want to develop locally:

```bash
# Prerequisites: pnpm, Bun, OpenCode TUI (npm i -g @opencode/tui)

git clone https://github.com/chriswritescode-dev/opencode-manager.git
cd opencode-manager
pnpm install
cp .env.example .env
pnpm dev
```

## Configuration

### Authentication

OpenCode Manager uses single-user authentication. Create your admin account on first launch, or pre-configure via environment variables:

```bash
# Pre-configured admin (optional)
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=your-secure-password

# Required for production
AUTH_SECRET=your-secure-random-secret  # Generate with: openssl rand -base64 32
```

### Remote/LAN Access

For HTTP access on local networks:

```bash
AUTH_TRUSTED_ORIGINS=http://localhost:5003
AUTH_SECURE_COOKIES=false  # Required when not using HTTPS (cookies won't work over plain HTTP otherwise)
```

### OAuth Providers (Optional)

Enable social login by configuring OAuth credentials:

```bash
# GitHub
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...

# Google
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...

# Discord
DISCORD_CLIENT_ID=...
DISCORD_CLIENT_SECRET=...
```

### Passkeys

For WebAuthn/passkey support:

```bash
PASSKEY_RP_ID=yourdomain.com
PASSKEY_RP_NAME=OpenCode Manager
PASSKEY_ORIGIN=https://yourdomain.com
```

### Dev Server Ports

The Docker container exposes ports `5100-5103` for running dev servers inside repositories:

```bash
# Example: Vite
server: { port: 5100, host: '0.0.0.0' }

# Access at http://localhost:5100
```

## Documentation

For detailed guides and configuration reference, see the **[Documentation Site](https://chriswritescode-dev.github.io/opencode-manager)**.

- [Getting Started](https://chriswritescode-dev.github.io/opencode-manager/getting-started/installation/) - Installation and first-run setup
- [Features](https://chriswritescode-dev.github.io/opencode-manager/features/overview/) - Deep dive on all features
- [Configuration](https://chriswritescode-dev.github.io/opencode-manager/configuration/environment/) - Environment variables and advanced setup
- [Troubleshooting](https://chriswritescode-dev.github.io/opencode-manager/troubleshooting/) - Common issues and solutions
- [Development](https://chriswritescode-dev.github.io/opencode-manager/development/setup/) - Contributing and local development

## Roadmap

See [ROADMAP.md](ROADMAP.md) for planned features including:
- PWA & Push Notifications
- Enhanced authentication options

## License

MIT
