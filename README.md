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
- **ZIP Download** - Download repos as ZIP excluding gitignored files

### Chat & Session Features
- **Slash Commands** - Built-in commands (`/help`, `/new`, `/models`, `/export`, `/compact`, etc.)
- **Custom Commands** - Create custom slash commands with templates
- **File Mentions** - Reference files with `@filename` autocomplete
- **Plan/Build Mode Toggle** - Switch between read-only and file-change modes
- **Mermaid Diagram Support** - Visual diagram rendering in chat messages
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
- **Enter Key Send** - Press Enter to automatically close keyboard and send messages
- **Swipe-to-Navigate** - Swipe right from left edge to navigate back

### Text-to-Speech (TTS)
- **Dual Provider Support** - Browser-native Web Speech API + external OpenAI-compatible endpoints
- **Browser-Native TTS** - Built-in Web Speech API for instant playback without API keys
- **AI Message Playback** - Listen to assistant responses with TTS
- **OpenAI-Compatible** - Works with any OpenAI-compatible TTS endpoint
- **Voice & Speed Discovery** - Automatic voice detection with caching (1hr TTL)
- **Voice & Speed Controls** - Configurable voice selection and playback speed
- **Audio Caching** - 24-hour cache with 200MB limit for performance
- **Markdown Sanitization** - Filters unreadable symbols for smooth playback
- **Floating Controls** - Persistent stop button for audio control
- **Custom Endpoints** - Connect to local or self-hosted TTS services

## Screenshots

<table>
<tr>
<td><strong>Files (Mobile)</strong></td>
<td><strong>Files (Desktop)</strong></td>
</tr>
<tr>
<td><img src="https://github.com/user-attachments/assets/24243e5e-ab02-44ff-a719-263f61c3178b" alt="files-mobile" /></td>
<td><img src="https://github.com/user-attachments/assets/0a37feb0-391c-48a1-8bda-44a046aad913" alt="files-desktop" /></td>
</tr>
<tr>
<td><strong>Chat (Mobile)</strong></td>
<td><strong>Chat (Desktop)</strong></td>
</tr>
<tr>
<td><img src="https://github.com/user-attachments/assets/a48cc728-e540-4247-879a-c5f36c3fd6de" alt="chat-mobile" width="250" /></td>
<td><img src="https://github.com/user-attachments/assets/5fe34443-1d06-4847-a397-ef472aae0932" alt="chat-desktop" width="600" /></td>
</tr>
<tr>
<td><strong>Inline Diff View</strong></td>
<td></td>
</tr>
<tr>
<td><img src="https://github.com/user-attachments/assets/b94c0ca0-d960-4888-8a25-a31ed6d5068d" alt="inline-diff-view" width="250" /></td>
<td></td>
</tr>
</table>

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

### Dev Server Ports

The Docker container exposes ports `5100-5103` for running dev servers inside your repositories. Configure your project's dev server to use one of these ports and access it directly from your browser.

**Example usage:**
```bash
# Vite (vite.config.ts)
server: { port: 5100, host: '0.0.0.0' }

# Next.js
next dev -p 5100 -H 0.0.0.0

# Express/Node
app.listen(5100, '0.0.0.0')
```

Access your dev server at `http://localhost:5100` (or your Docker host IP).

To customize the exposed ports, edit `docker-compose.yml`:
```yaml
ports:
  - "5003:5003"      # OpenCode Manager
  - "5100:5100"      # Dev server 1
  - "5101:5101"      # Dev server 2
  - "5102:5102"      # Dev server 3
  - "5103:5103"      # Dev server 4
```

### Global Agent Instructions (AGENTS.md)

OpenCode Manager creates a default `AGENTS.md` file in the workspace config directory (`/workspace/.config/opencode/AGENTS.md`). This file provides global instructions to AI agents working within the container.

**Default instructions include:**
- Reserved ports (5003 for OpenCode Manager, 5551 for OpenCode server)
- Available dev server ports (5100-5103)
- Guidelines for binding to `0.0.0.0` for Docker accessibility

**Editing AGENTS.md:**
- Via UI: Settings > OpenCode > Global Agent Instructions
- Via file: Edit `/workspace/.config/opencode/AGENTS.md` directly

This file is merged with any repository-specific `AGENTS.md` files, with repository instructions taking precedence for their respective codebases.

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



