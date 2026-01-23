# OpenCode WebUI - Agent Guidelines

## ⚠️ CRITICAL: Verification Before Committing

**NEVER commit code claiming a feature or fix works without actually testing it end-to-end.**

Before committing any change that affects startup or core functionality:

1. **Kill all processes and clean up:**
   ```bash
   pnpm cleanup
   # Or manually: lsof -ti:5001,5173,5551,5552,5553,5554 | xargs kill
   ```

2. **Start fresh and verify:**
   ```bash
   # For client mode (connecting to existing opencode)
   opencode serve --port 5551 --hostname 127.0.0.1 &
   sleep 3
   pnpm start:client
   
   # Or for standalone mode
   pnpm start
   ```

3. **Wait for full startup** (~60-90s for model loading) and verify:
   ```bash
   curl -s http://localhost:5001/api/health | jq '.status'  # Should be "healthy"
   curl -s http://localhost:5001/api/stt/status | jq '.server.running'  # Should be true
   curl -s http://localhost:5001/api/repos | jq '.[].fullPath'  # Should list repos
   ```

4. **Test the actual feature** you changed (e.g., voice transcription, file creation, etc.)

**DO NOT** trust that previous test runs are still valid after making changes.

## ⚠️ CRITICAL: Never Kill OpenCode Processes

**NEVER run `pkill -f opencode` or similar commands that kill opencode processes.**

The user runs `opencode -c` in their terminal sessions. Killing these processes will terminate the user's active coding sessions and potentially lose their work.

Safe alternatives:
- Kill specific PIDs you spawned: `kill <specific-pid>`
- Use `pnpm cleanup` to kill only managed ports (5001, 5173, 5551, 5552, 5553, 5554)
- Kill by port: `lsof -ti:5551 | xargs kill` (only kills process on that port)

## Commands

- `pnpm dev` - Start both backend (5001) and frontend (5173)
- `pnpm dev:backend` - Backend only: `bun --watch backend/src/index.ts`
- `pnpm dev:frontend` - Frontend only: `cd frontend && vite`
- `pnpm start` - Native start with Cloudflare tunnel (spawns opencode serve)
- `pnpm start:client` - Connect to existing opencode instance with tunnel
- `pnpm start:no-tunnel` - Native start without tunnel
- `pnpm cleanup` - Kill orphaned processes on managed ports
- `pnpm build` - Build both backend and frontend
- `pnpm test` - Run backend tests: `cd backend && bun test`
- `cd backend && bun test <filename>` - Run single test file
- `cd backend && vitest --ui` - Test UI with coverage
- `cd backend && vitest --coverage` - Coverage report (80% threshold)
- `cd frontend && npm run lint` - Frontend linting

## Native Local Development (No Docker)

Run opencode-manager natively on macOS without Docker:

```bash
# Normal mode - spawns opencode serve with Cloudflare tunnel
pnpm start

# Client mode - connect to existing opencode instance with tunnel
# (shows list of running opencode servers to choose from)
pnpm start:client

# Without Cloudflare tunnel (local only)
pnpm start:no-tunnel

# Client mode without tunnel
bun scripts/start-native.ts --client

# Custom port
bun scripts/start-native.ts --port 3000
```

### Requirements

- Bun installed
- Node.js (for frontend)
- `cloudflared` for tunnel mode: `brew install cloudflared`
- OpenCode installed: `curl -fsSL https://opencode.ai/install | bash`

### How Client Mode Works

When using `--client`, the script:
1. Scans for running opencode processes using `lsof`
2. Checks health via `/doc` endpoint on each discovered port
3. Fetches version info from `/global/health`
4. Lists all healthy instances with directory, version, and PID
5. Lets you select which instance to connect to
6. Starts the backend in "client mode" (doesn't spawn opencode serve)

This is useful when you already have `opencode` running in a terminal and want the web UI to connect to it.

## Voice E2E Tests

Test STT (Speech-to-Text), TTS (Text-to-Speech), and Talk Mode functionality:

```bash
# Local development (no auth required)
bun run scripts/test-voice.ts

# Remote deployment (with auth)
bun run scripts/test-voice.ts --url https://your-url.com --user admin --pass secret

# Using environment variables
OPENCODE_URL=https://your-url.com OPENCODE_USER=admin OPENCODE_PASS=secret bun run scripts/test-voice.ts

# Custom test phrase
bun run scripts/test-voice.ts --text "Your custom phrase to transcribe"

# Skip slow talk mode flow test
bun run scripts/test-voice.ts --skip-talkmode
```

Requirements for STT test:
- macOS with `say` command (for audio generation)
- `ffmpeg` installed (for audio conversion)
- Whisper server running (auto-starts with backend)

Tests performed:
1. Health endpoint connectivity
2. Voice settings (TTS, STT, TalkMode config)
3. STT server status and available models
4. STT transcription with generated audio
5. TTS voices and synthesis endpoints
6. OpenCode session creation
7. Full talk mode flow: Audio -> STT -> Send to OpenCode -> Poll for response

## Browser E2E Test (Real Audio Pipeline)

Test the complete voice pipeline using Chrome's fake audio capture:

```bash
# Start the app with Cloudflare tunnel
pnpm start

# Wait for startup (~90s for model loading), then note the tunnel URL
# Example: https://wallet-geographical-task-governance.trycloudflare.com

# Run browser E2E test over tunnel (headless)
bun run scripts/test-browser.ts --url https://YOUR-TUNNEL-URL.trycloudflare.com

# Run with visible browser for debugging
bun run scripts/test-browser.ts --url https://YOUR-TUNNEL-URL.trycloudflare.com --no-headless

# Local testing (no tunnel)
bun run scripts/test-browser.ts --url http://localhost:5001

# Use Web Audio API injection (alternative to fake audio device)
bun run scripts/test-browser.ts --web-audio
```

This test:
1. Generates test audio using macOS `say` command (or espeak/pico2wave on Linux)
2. Launches Chrome with `--use-file-for-fake-audio-capture` flag OR Web Audio API injection
3. Opens the app, navigates to a session, starts Talk Mode
4. Chrome captures audio from the fake device instead of microphone
5. Audio flows through real STT pipeline (MediaRecorder → /api/stt/transcribe → Whisper)
6. Verifies transcription matches expected text
7. Waits for OpenCode to respond and verifies the answer

Requirements:
- macOS with `say` command OR Linux with espeak/pico2wave
- `ffmpeg` installed (`brew install ffmpeg`)
- Chromium/Chrome installed (Puppeteer downloads automatically)

### Cloudflare Tunnel Notes

The tunnel uses HTTP/2 protocol to avoid QUIC conflicts with Tailscale VPN:
- QUIC protocol causes Cloudflare Error 1033 when Tailscale is running
- Backend must be healthy before starting tunnel (models take ~90s to load)
- The `pnpm start` command handles this automatically

## Code Style

- No comments, self-documenting code only
- Strict TypeScript everywhere, proper typing required
- Named imports only: `import { Hono } from 'hono'`, `import { useState } from 'react'`

### Backend (Bun + Hono)

- Hono framework with Zod validation, Better SQLite3 database
- Error handling with try/catch and structured logging
- Follow existing route/service/utility structure
- Use async/await consistently, avoid .then() chains
- Test coverage: 80% minimum required

### Frontend (React + Vite)

- @/ alias for components: `import { Button } from '@/components/ui/button'`
- Radix UI + Tailwind CSS, React Hook Form + Zod
- React Query (@tanstack/react-query) for state management
- ESLint TypeScript rules enforced
- Use React hooks properly, no direct state mutations

### General

- DRY principles, follow existing patterns
- ./temp/opencode is reference only, never commit has opencode src
- Use shared types from workspace package (@opencode-manager/shared)
- OpenCode server runs on port 5551, backend API on port 5001
- Prefer pnpm over npm for all package management


## Deployment

### Deploy to Cloud (Azure VM with Basic Auth)

Use the deployment script for proper setup with Caddy reverse proxy and basic authentication:

```bash
# Fresh deployment (creates Azure VM, sets up Docker, Caddy, Cloudflare tunnel)
bun run scripts/deploy.ts

# Check deployment status and get current tunnel URL
bun run scripts/deploy.ts --status

# Update to latest code (pulls from GitHub, rebuilds containers)
bun run scripts/deploy.ts --update

# Update environment variables (API keys, etc.)
bun run scripts/deploy.ts --update-env

# Sync local OpenCode auth to remote (GitHub Copilot, Anthropic OAuth)
bun run scripts/deploy.ts --sync-auth

# Enable YOLO mode (auto-approve all permissions)
bun run scripts/deploy.ts --yolo

# Destroy all Azure resources
bun run scripts/deploy.ts --destroy
```

Environment variables for deployment (set in `.env` or environment):
- `AUTH_USERNAME` - Basic auth username (default: admin)
- `AUTH_PASSWORD` - Basic auth password (prompted if not set)
- `GITHUB_TOKEN` - For cloning private repos
- `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` - AI provider keys
- `TARGET_HOST` - Deploy to existing server instead of creating Azure VM

### Deploy to Existing Server

```bash
# Deploy to your own server (skips Azure VM creation)
TARGET_HOST=your-server.com bun run scripts/deploy.ts
```

### Architecture (Deployed)

```
Cloudflare Tunnel (trycloudflare.com)
    ↓
Caddy (port 80, basic auth)
    ↓
opencode-manager app (port 5003)
    ├── OpenCode server (port 5551, internal)
    └── Whisper STT (port 5552, internal)
```

### Important: Never bypass docker compose

**DO NOT** run containers directly with `docker run`. Always use `docker compose`:

```bash
# CORRECT: Uses docker-compose.yml + docker-compose.override.yml
# Sets up Caddy auth, cloudflared tunnel, proper networking
ssh user@server "cd ~/opencode-manager && sudo docker compose up -d"

# WRONG: Bypasses Caddy auth, exposes app directly without protection
ssh user@server "sudo docker run -d -p 5003:5003 ghcr.io/dzianisv/opencode-manager"
```

The `docker-compose.override.yml` configures:
- **caddy-auth**: Reverse proxy with basic authentication
- **cloudflared-tunnel**: Cloudflare tunnel for HTTPS access
- **app**: The main application (not exposed directly)

### Credentials

Deployment credentials are saved to `.secrets/YYYY-MM-DD.json`:
```json
{
  "url": "https://xxx.trycloudflare.com",
  "username": "admin",
  "password": "generated-password"
}
```

### Troubleshooting

```bash
# SSH to VM
ssh azureuser@<VM_IP>

# Check all containers are running (should see 3: opencode-manager, caddy-auth, cloudflared-tunnel)
sudo docker ps

# View logs
sudo docker logs opencode-manager
sudo docker logs caddy-auth
sudo docker logs cloudflared-tunnel

# Get current tunnel URL
sudo docker logs cloudflared-tunnel 2>&1 | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | tail -1

# Restart all services
cd ~/opencode-manager && sudo docker compose restart

# Rebuild and restart (after code changes)
cd ~/opencode-manager && sudo docker compose up -d --build
```

## CI/CD

The project uses GitHub Actions for CI/CD. Workflows are in `.github/workflows/`:

- **docker-build.yml** - Builds and pushes Docker image to GHCR on push to main

### E2E Testing with CI-built Image

The recommended flow is: CI builds Docker image → pull locally → run E2E tests.

```bash
# 1. Pull and run the CI-built Docker image locally
./scripts/run-local-docker.sh

# 2. In another terminal, run all E2E tests
bun run scripts/run-e2e-tests.ts

# Or run individual tests
bun run scripts/test-voice.ts --url http://localhost:5003
bun run scripts/test-browser.ts --url http://localhost:5003
```

The browser test uses Chrome's `--use-file-for-fake-audio-capture` flag to inject real audio into the browser's audio capture pipeline. This tests the complete STT flow through MediaRecorder → Whisper without mocking.

### Complete Voice Testing Workflow

The recommended workflow for testing voice/Talk Mode:

```bash
# 1. Start the app with tunnel (waits for model loading automatically)
pnpm start
# Wait for "✓ Backend is ready!" and tunnel URL (~90s)

# 2. Verify health endpoints
curl https://YOUR-TUNNEL-URL.trycloudflare.com/api/health
curl https://YOUR-TUNNEL-URL.trycloudflare.com/api/stt/status

# 3. Run browser E2E test over tunnel
bun run scripts/test-browser.ts --url https://YOUR-TUNNEL-URL.trycloudflare.com

# 4. For debugging, run with visible browser
bun run scripts/test-browser.ts --url https://YOUR-TUNNEL-URL.trycloudflare.com --no-headless
```

Key points:
- `pnpm start` now waits for backend health before starting tunnel
- Whisper model takes ~30s to load, Chatterbox ~50s
- Tunnel uses HTTP/2 protocol (QUIC causes issues with Tailscale VPN)
- Browser test injects real audio via Chrome's fake audio device

## Testing Documentation

See [docs/testing.md](docs/testing.md) for detailed test procedures:
- Client Mode Auto-Registration Test
- Voice Mode End-to-End Test (full voice-to-code pipeline)

## Feature Development Workflow

Follow this workflow for all features, bug fixes, and improvements.

### 1. Create GitHub Issue

Before starting work, create a GitHub issue:

```bash
gh issue create --repo dzianisv/opencode-manager \
  --title "Brief description of feature/bug" \
  --body "Description, root cause (if bug), acceptance criteria"
```

Include:
- Problem description
- Proposed solution
- Acceptance criteria (checkboxes)

### 2. Create Feature Branch

```bash
git checkout main
git pull origin main
git checkout -b feature/issue-NUMBER-short-description
# Example: git checkout -b feature/issue-4-talk-mode-audio-fix
```

### 3. Development

- Follow code style in AGENTS.md (no comments, strict TypeScript, named imports)
- Keep commits atomic with clear messages
- Reference issue in commits: `fix: convert WebM to WAV (#4)`

### 4. Testing Requirements

**Before committing, run ALL relevant tests:**

```bash
# Unit tests (80% coverage required)
pnpm test

# Voice E2E test
bun run scripts/test-voice.ts --url http://localhost:5001 --user admin --pass PASSWORD

# Browser E2E test (for UI changes)
bun run scripts/test-browser.ts --url http://localhost:5001 --user admin --pass PASSWORD

# Full startup test
bun run scripts/test-startup.ts
```

**For npm package changes:**
```bash
# Reinstall and verify
bun remove -g opencode-manager
bun install -g github:dzianisv/opencode-manager --force
opencode-manager install-service
opencode-manager status
```

### 5. Verification Protocol

**CRITICAL: Follow the verification steps in "Verification Before Committing" section above.**

Do NOT claim a feature works without:
1. Killing all processes: `pnpm cleanup`
2. Starting fresh: `pnpm start` or `opencode-manager install-service`
3. Waiting for full startup (~60-90s)
4. Testing the actual feature manually
5. Running automated E2E tests

### 6. Create Pull Request

```bash
git push -u origin feature/issue-NUMBER-short-description

gh pr create --title "fix: Brief description (#NUMBER)" --body "$(cat <<'EOF'
## Summary
- What was changed and why

## Testing Done
- [ ] Unit tests pass: `pnpm test`
- [ ] Voice E2E test pass: `bun run scripts/test-voice.ts`
- [ ] Manual verification: [describe what you tested]

## Issue
Closes #NUMBER
EOF
)"
```

### 7. Review and Merge

- Wait for CI to pass
- Address review feedback
- Squash and merge when approved
- Delete feature branch after merge

### Example Workflow

```bash
# 1. Create issue
gh issue create --title "Talk Mode not recognizing speech"

# 2. Create branch
git checkout -b feature/issue-4-talk-mode-audio-fix

# 3. Make changes
vim scripts/whisper-server.py

# 4. Test
pnpm cleanup
opencode-manager install-service
sleep 60
bun run scripts/test-voice.ts --url http://localhost:5001 --user admin --pass PASSWORD

# 5. Commit
git add scripts/whisper-server.py
git commit -m "fix: convert WebM/Opus to WAV before transcription (#4)"

# 6. Push and create PR
git push -u origin feature/issue-4-talk-mode-audio-fix
gh pr create --title "fix: Convert WebM to WAV for reliable STT (#4)"

# 7. After merge
git checkout main
git pull
git branch -d feature/issue-4-talk-mode-audio-fix
```

## Architecture

@docs/cloudVibeCoding.md
@./README.md