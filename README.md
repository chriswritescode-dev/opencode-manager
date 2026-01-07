# OpenCode Manager

Mobile-first web interface for OpenCode AI agents. Manage, control, and code with OpenCode from any device - your phone, tablet, or desktop. Features Git integration, file management, and real-time chat in a responsive PWA. Deploy with Docker for instant setup. View diffs, edit files and much more.

## Why We Use a Fork of OpenCode

This project builds OpenCode from [VibeTechnologies/opencode](https://github.com/VibeTechnologies/opencode), a fork of the official [sst/opencode](https://github.com/sst/opencode) repository. We maintain this fork to include critical fixes that haven't yet been merged upstream.

### Current Fork Enhancements

**File Persistence for Large Tool Outputs** ([PR #6234](https://github.com/sst/opencode/pull/6234))

The official OpenCode has a known issue where large tool outputs (WebFetch, Bash, MCP tools) can overflow the context window, causing:
- "prompt is too long" errors (e.g., `202744 tokens > 200000 maximum`)
- Sessions becoming stuck/unresponsive
- Loss of work when context overflows mid-conversation

Our fork includes the fix from PR #6234 which implements intelligent file persistence:
- Tool outputs exceeding 30,000 characters are saved to disk instead of the context
- The AI model receives a file path with instructions to explore the data using Read/Grep/jq
- Context stays small, preventing overflow errors
- Files are automatically cleaned up when sessions are deleted

This fix is essential for production use cases where AI agents frequently fetch documentation, analyze large codebases, or work with verbose tool outputs.

**Implementation Details:**

1. **VibeTechnologies/opencode fork** (branch: `dev`) contains two fixes:
   - Large tool outputs (>30k chars) are saved to disk instead of context (`packages/opencode/src/session/prompt.ts`)
   - Auto-allow read access to OpenCode storage directory to avoid permission prompts for reading saved tool results (`packages/opencode/src/tool/read.ts`)

2. **opencode-manager** deploys the fork at container startup via:
   - `docker-compose.yml` - `OPENCODE_FORK_REPO` and `OPENCODE_FORK_BRANCH` env vars
   - `scripts/docker-entrypoint.sh` - `install_from_fork()` function

**Test Results** (all 3 integration tests pass):
- 883,082 character output saved to file successfully
- No retry loop / sessions didn't get stuck
- Sessions can continue conversation after context-heavy operations

### Staying Up-to-Date

We regularly sync our fork with upstream sst/opencode to incorporate new features and fixes. Once PR #6234 is merged upstream, we plan to switch back to the official release.  

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

### QA Testing System
- **Autonomous AI Testing** - OpenCode AI agent can autonomously test the entire application
- **Quick Test Commands** - Run health, API, auth, tunnel, Docker, and E2E tests with one command
- **CI/CD Ready** - Integration-ready for GitHub Actions and other CI/CD pipelines
- **Comprehensive Coverage** - Tests server startup, API endpoints, authentication, tunnels, Docker deployment, and more

Use `@qa-tester` in OpenCode or run `scripts/qa-test.sh` for quick tests.

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

### Option 1: Docker (Recommended)

```bash
# Simple one-liner
docker run -d -p 5003:5003 -v opencode-workspace:/workspace ghcr.io/dzianisv/opencode-manager

# Or with API keys
docker run -d -p 5003:5003 \
  -e ANTHROPIC_API_KEY=sk-... \
  -v opencode-workspace:/workspace \
  ghcr.io/dzianisv/opencode-manager
```

Access the application at http://localhost:5003

**With Docker Compose** (for persistent volumes and env vars):

```bash
git clone https://github.com/VibeTechnologies/opencode-manager.git
cd opencode-manager

# Configure API keys (optional)
echo "ANTHROPIC_API_KEY=sk-..." > .env

# Start
docker compose up -d
```

The Docker setup automatically:
- Installs OpenCode CLI on first run
- Starts Whisper (STT) and Chatterbox (TTS) servers
- Sets up persistent volumes for workspace and database

**Docker Commands:**
```bash
docker compose up -d        # Start
docker compose down         # Stop
docker compose logs -f      # View logs
docker compose restart      # Restart
docker exec -it opencode-manager sh  # Shell access
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

### Option 2: Azure VM Deployment (Quick Start)

Deploy OpenCode Manager to an Azure VM with a single command. Includes automatic HTTPS via Cloudflare tunnel and Basic Auth protection.

**Prerequisites:**
- [Azure CLI](https://docs.microsoft.com/en-us/cli/azure/install-azure-cli) installed and logged in (`az login`)
- [Bun](https://bun.sh/) installed
- SSH keys configured (`~/.ssh/id_rsa.pub`)

**Quick Deploy:**

```bash
# Clone the repository
git clone https://github.com/VibeTechnologies/opencode-manager.git
cd opencode-manager

# Install dependencies
bun install

# Deploy to Azure (creates VM, configures Docker, sets up tunnel)
bun run scripts/deploy.ts
```

The script will:
1. Create an Azure resource group and VM (Standard_D2s_v5 by default)
2. Install Docker and deploy OpenCode Manager
3. Set up Caddy reverse proxy with Basic Auth
4. Create a Cloudflare tunnel for HTTPS access
5. Enable YOLO mode (auto-approve all AI permissions)

**After deployment, you'll receive:**
- Tunnel URL: `https://xxx-xxx.trycloudflare.com`
- Username: `admin` (default)
- Password: Auto-generated or prompted

**Environment Variables (optional):**

Create a `.env` file before deploying to configure:

```bash
# Basic Auth
AUTH_USERNAME=admin
AUTH_PASSWORD=your-secure-password

# Azure Configuration
AZURE_LOCATION=westus2
AZURE_VM_SIZE=Standard_D2s_v5

# GitHub Token (for cloning private repos)
GITHUB_TOKEN=ghp_xxx

# AI Provider Keys (optional - can also configure via OAuth in UI)
ANTHROPIC_API_KEY=sk-ant-xxx
OPENAI_API_KEY=sk-xxx
GEMINI_API_KEY=xxx

# OpenCode Fork (for context overflow fix - default)
OPENCODE_FORK_REPO=VibeTechnologies/opencode
OPENCODE_FORK_BRANCH=dev
```

**Deployment Commands:**

```bash
# Deploy new VM
bun run scripts/deploy.ts

# Check status (shows tunnel URL, credentials, container status)
bun run scripts/deploy.ts --status

# Update to latest code (pulls from GitHub, rebuilds containers)
bun run scripts/deploy.ts --update

# Sync local OpenCode auth to VM (GitHub Copilot, Anthropic OAuth)
bun run scripts/deploy.ts --sync-auth

# Update environment variables
bun run scripts/deploy.ts --update-env

# Change Basic Auth password
bun run scripts/deploy.ts --update-auth

# Re-enable YOLO mode (auto-approve permissions)
bun run scripts/deploy.ts --yolo

# Destroy all Azure resources
bun run scripts/deploy.ts --destroy
```

**Syncing Authentication:**

If you have GitHub Copilot or Anthropic OAuth configured locally, sync it to your VM:

```bash
# First, authenticate locally with OpenCode
opencode
/connect github-copilot

# Then sync to your Azure VM
bun run scripts/deploy.ts --sync-auth
```

**SSH Access:**

```bash
# Get VM IP and SSH command
bun run scripts/deploy.ts --status

# SSH into VM
ssh azureuser@<VM_IP>

# View container logs
ssh azureuser@<VM_IP> "sudo docker logs opencode-manager -f"
```

**Cost Estimate:**
- Standard_D2s_v5 (2 vCPU, 8GB RAM): ~$70/month
- Use `--destroy` when not in use to avoid charges

### Option 3: Native Local Development (macOS)

Run OpenCode Manager natively on macOS without Docker. This is ideal for development or when you want the web UI to connect to an existing OpenCode instance running in your terminal.

**Prerequisites:**
- [Bun](https://bun.sh/) installed
- [Node.js](https://nodejs.org/) installed (for frontend)
- [OpenCode](https://opencode.ai) installed: `curl -fsSL https://opencode.ai/install | bash`
- (Optional) [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) for tunnel mode: `brew install cloudflared`

**Quick Start:**

```bash
# Clone the repository
git clone https://github.com/VibeTechnologies/opencode-manager.git
cd opencode-manager

# Install dependencies
pnpm install

# Copy environment configuration
cp .env.local.example .env

# Start with Cloudflare tunnel (spawns opencode serve + creates public URL)
pnpm start

# Or connect to an existing opencode instance with tunnel
pnpm start:client

# Or start without tunnel (local only)
pnpm start:no-tunnel
```

**Available Commands:**

| Command | Description |
|---------|-------------|
| `pnpm start` | Start with Cloudflare tunnel - spawns `opencode serve` + public URL |
| `pnpm start:client` | Connect to existing opencode instance with tunnel |
| `pnpm start:no-tunnel` | Start without tunnel (local only) |
| `bun scripts/start-native.ts --help` | Show all available options |

**Client Mode:**

When using `--client` mode, the script will:
1. Scan for running opencode processes using `lsof`
2. Check health via `/doc` endpoint on each discovered port
3. Fetch version info from `/global/health`
4. List all healthy instances with directory, version, and PID
5. Let you select which instance to connect to

```bash
$ pnpm start:client

╔═══════════════════════════════════════╗
║   OpenCode Manager - Native Start     ║
╚═══════════════════════════════════════╝

🔍 Searching for running opencode servers...

📋 Found multiple opencode servers:

  [1] Port 5551
      Directory: /Users/you/project-a
      Version: 1.1.2
      PID: 12345

  [2] Port 61782
      Directory: /Users/you/project-b
      Version: 1.0.223
      PID: 67890

Select server [1]: 
```

This is useful when you already have `opencode` running in a terminal and want the web UI to connect to it without spawning a separate server.

**Without Tunnel (Local Only):**

```bash
# Start without tunnel
pnpm start:no-tunnel

# Or connect to existing instance without tunnel
bun scripts/start-native.ts --client
```

**Custom Port:**

```bash
# Use a different backend port
bun scripts/start-native.ts --port 3000
bun scripts/start-native.ts --client --port 3000
```

### Option 4: Local Development (Hot Reload)

```bash
# Clone the repository
git clone https://github.com/VibeTechnologies/opencode-manager.git
cd opencode-manager

# Install dependencies (uses Bun workspaces)
bun install

# Copy environment configuration
cp .env.example .env

# Start development servers (backend + frontend)
npm run dev
```

## Testing

The project includes a comprehensive QA testing system with autonomous AI testing capabilities.

### Quick Testing

Run tests using the provided command script:

```bash
# Health check (quick verification)
scripts/qa-test.sh health

# API endpoint tests
scripts/qa-test.sh api

# Authentication tests
scripts/qa-test.sh auth

# Cloudflare tunnel tests
scripts/qa-test.sh tunnel

# Docker deployment tests
scripts/qa-test.sh docker

# E2E test suite
scripts/qa-test.sh e2e

# Run all tests
scripts/qa-test.sh full

# Test remote deployment
scripts/qa-test.sh health https://your-deployment.com
```

### Autonomous AI Testing

Use OpenCode slash commands for quick testing:

```
/qa-test       # Run comprehensive QA tests
/qa-health     # Quick health check
```

Or mention the QA agent directly:

```
"@qa-tester run a full test suite and report any issues"
"Test the application and generate a comprehensive report"
```

The AI agent will autonomously:
1. Execute all test protocols
2. Evaluate results against expected outputs
3. Generate a professional test report with metrics
4. Identify issues and provide recommendations

### Available Tests

- ✅ Development server startup and health
- ✅ Backend API endpoints (health, repos, settings, OpenCode proxy)
- ✅ Authentication (with/without credentials, valid/invalid)
- ✅ Cloudflare tunnel (startup, URL generation, public access)
- ✅ Docker deployment (build, run, health checks, volumes)
- ✅ E2E test suite (voice, talk mode, browser automation)
- ✅ Database integrity
- ✅ Git operations
- ✅ Performance metrics
- ✅ Security validation

### CI/CD Integration

The QA system can be integrated into GitHub Actions:

```yaml
- name: Run QA Tests
  run: |
    scripts/qa-test.sh full
```

See the QA agent at `.opencode/agent/qa-tester.md` for detailed test protocols.

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



# Testing

1. scripts/run-local-docker.sh
Pulls and runs the CI-built Docker image from GHCR locally:
./scripts/run-local-docker.sh
2. scripts/run-e2e-tests.ts
Runs all E2E tests against a running instance:
bun run scripts/run-e2e-tests.ts --url http://localhost:5003
3. Updated AGENTS.md
Documents the E2E testing workflow with CI-built images.
The workflow
GitHub Actions (CI)          Local Machine
─────────────────────        ──────────────────────
Push to main                 
    ↓
docker-build.yml runs
    ↓
Build Docker image
    ↓
Push to GHCR ───────────────→ ./scripts/run-local-docker.sh
                                  ↓
                              Pull image from GHCR
                                  ↓
                              Run container (port 5003)
                                  ↓
                              bun run scripts/run-e2e-tests.ts
                                  ↓
                              ✅ Voice E2E tests
                              ✅ Talk Mode API tests  
                              ✅ Talk Mode Browser tests