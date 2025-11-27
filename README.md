# OpenCode Web Manager

A full-stack web application for running [OpenCode](https://github.com/sst/opencode) in local processes, controllable via a modern web interface. Designed to allow users to run and control OpenCode from their phone or any device with a web browser.  

## Features

### Repository Management
- **Multi-Repository Support** - Clone and manage multiple git repos/worktrees in local workspaces
- **Private Repository Support** - GitHub PAT configuration for cloning private repos
- **Worktree Support** - Create and manage Git worktrees for working on multiple branches

### Git Integration
- **Git Diff Viewer** - View file changes with unified diff, line numbers, and addition/deletion counts
- **Git Status Panel** - See all uncommitted changes (modified, added, deleted, renamed, untracked)
- **Branch Switching** - Switch between branches via dropdown
- **Branch/Worktree Creation** - Create new branch workspaces from any repository
- **Ahead/Behind Tracking** - Shows commits ahead/behind remote
- **Push PRs to GitHub** - Create and push pull requests directly from your phone

### File Browser
- **Directory Navigation** - Browse files and folders with tree view
- **File Search** - Search files within directories
- **Syntax Highlighting** - Code preview with syntax highlighting
- **File Operations** - Create files/folders, rename, delete
- **Drag-and-Drop Upload** - Upload files by dragging into the browser
- **Large File Support** - Virtualization for large files

### Chat & Session Features
- **Slash Commands** - Built-in commands (`/help`, `/new`, `/models`, `/export`, `/compact`, etc.)
- **Custom Commands** - Create custom slash commands with templates
- **File Mentions** - Reference files with `@filename` autocomplete
- **Plan/Build Mode Toggle** - Switch between read-only and file-change modes
- **Session Management** - Create, search, delete, and bulk delete sessions
- **Real-time Streaming** - Live message streaming with SSE

### AI Model & Provider Configuration
- **Model Selection** - Browse and select from available AI models with filtering
- **Provider Management** - Configure multiple AI providers with API keys
- **Context Usage Indicator** - Visual progress bar showing token usage
- **Agent Configuration** - Create custom agents with system prompts and tool permissions

### MCP Server Management
- **MCP Server Configuration** - Add local (command-based) or remote (HTTP) MCP servers
- **Server Templates** - Pre-built templates for common MCP servers
- **Enable/Disable Servers** - Toggle servers on/off with auto-restart

### Settings & Customization
- **Theme Selection** - Dark, Light, or System theme
- **Keyboard Shortcuts** - Customizable keyboard shortcuts
- **OpenCode Config Editor** - Raw JSON editor for advanced configuration

### Mobile & PWA
- **Mobile-First Design** - Responsive UI optimized for mobile use
- **PWA Support** - Installable as Progressive Web App
- **iOS Keyboard Support** - Proper keyboard handling on iOS

## Demo Videos

### Demo
![Demo](https://github.com/chriswritescode-dev/opencode-web/releases/download/0.2.5/demo1.gif)

### File Editing
![File Editing](https://github.com/chriswritescode-dev/opencode-web/releases/download/0.2.5/edit-file.gif)

### File Context
![File Context](https://github.com/chriswritescode-dev/opencode-web/releases/download/0.2.5/file-context.gif)

## Coming Soon

-  **Authentication** - User authentication and session management

## Installation

### Option 1: Docker (Recommended for Production)

```bash
# Clone the repository
git clone https://github.com/yourusername/opencode-webui.git
cd opencode-webui

# Start with Docker Compose (single container)
docker-compose up -d

# Access the application at http://localhost:5001
```

The Docker setup automatically:
- Installs OpenCode if not present
- Builds and serves frontend from backend
- Sets up persistent volumes for workspace and database
- Includes health checks and auto-restart

**Docker Commands:**
```bash
# Production mode (single container)
npm run docker:up          # Start container
npm run docker:down        # Stop and remove container
npm run docker:build       # Rebuild image
npm run docker:logs        # View logs
npm run docker:restart     # Restart container

# Development mode (separate backend + frontend with hot reload)
npm run docker:dev         # Start in dev mode
npm run docker:dev:down    # Stop dev containers

# Access container shell
docker exec -it opencode-webui sh
```

### Option 2: Local Development

```bash
# Clone the repository
git clone https://github.com/yourusername/opencode-webui.git
cd opencode-webui

# Install dependencies (uses Bun workspaces)
bun install

# Copy environment configuration
cp .env.example .env

# Start development servers (backend + frontend)
npm run dev
```


