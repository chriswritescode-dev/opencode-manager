# OpenCode Manager

Mobile-first web interface for OpenCode AI agents. Manage, control, and code with OpenCode from any device - your phone, tablet, or desktop. Features Git integration, file management, and real-time chat in a responsive PWA. Deploy with Docker for instant setup. View diffs, edit files and much more.  

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
- **Provider Management** - Configure multiple AI providers with API keys or OAuth
- **OAuth Authentication** - Secure OAuth login for supported providers (Anthropic, GitHub Copilot)
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

### Text-to-Speech (TTS)
- **AI Message Playback** - Listen to assistant responses with TTS
- **OpenAI-Compatible** - Works with any OpenAI-compatible TTS endpoint
- **Voice & Speed Controls** - Configurable voice selection and playback speed
- **Custom Endpoints** - Connect to local or self-hosted TTS services

## Demo Videos

### Demo
![Demo](https://github.com/chriswritescode-dev/opencode-web/releases/download/0.3.0/Chat.gif)

### File Editing
![File Editing](https://github.com/chriswritescode-dev/opencode-web/releases/download/0.3.0/git-file-edit.gif)

### File Context
![File Context](https://github.com/chriswritescode-dev/opencode-web/releases/download/0.2.5/file-context.gif)

## Mobile Screenshots

<img width="250" alt="Mobile Repository List" src="https://github.com/user-attachments/assets/4a854373-9e4d-41ac-9a6c-c0eb37b0ac42" /> <img width="250" alt="Mobile Chat Interface" src="https://github.com/user-attachments/assets/57fe81c1-b169-43eb-b95f-6e027d7bea10" /> <img width="250" alt="Mobile OpenCode Configuration" src="https://github.com/user-attachments/assets/fcb16958-3134-434f-8c78-fb07259f5ce1" />

## Coming Soon

-  **Authentication** - User authentication and session management

## Installation

### Option 1: Docker (Recommended for Production)

```bash
# Clone the repository
git clone https://github.com/chriswritescode-dev/opencode-manager.git
cd opencode-manager

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
# Start container
docker-compose up -d

# Stop and remove container
docker-compose down

# Rebuild image
docker-compose build

# View logs
docker-compose logs -f

# Restart container
docker-compose restart

# Access container shell
docker exec -it opencode-manager sh
```

### Option 2: Local Development

```bash
# Clone the repository
git clone https://github.com/chriswritescode-dev/opencode-manager.git
cd opencode-manager

# Install dependencies (uses Bun workspaces)
bun install

# Copy environment configuration
cp .env.example .env

# Start development servers (backend + frontend)
npm run dev
```

## OAuth Provider Setup

OpenCode WebUI supports OAuth authentication for select providers, offering a more secure and convenient alternative to API keys.

### Supported OAuth Providers

- **Anthropic (Claude)** - OAuth login with Claude Pro/Max accounts
- **GitHub Copilot** - OAuth device flow authentication

### Setting Up OAuth

1. **Navigate to Settings → Provider Credentials**
2. **Select a provider** that shows the "OAuth" badge
3. **Click "Add OAuth"** to start the authorization flow
4. **Choose authentication method:**
   - **"Open Authorization Page"** - Opens browser for sign-in
   - **"Use Authorization Code"** - Provides code for manual entry
5. **Complete authorization** in the browser or enter the provided code
6. **Connection status** will show as "Configured" when successful



