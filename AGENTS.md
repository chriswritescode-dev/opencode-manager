# OpenCode WebUI - Agent Guidelines

## Commands

- `pnpm dev` - Start both backend (5001) and frontend (5173)
- `pnpm dev:backend` - Backend only: `bun --watch backend/src/index.ts`
- `pnpm dev:frontend` - Frontend only: `cd frontend && vite`
- `pnpm build` - Build both backend and frontend
- `pnpm test` - Run backend tests: `cd backend && bun test`
- `cd backend && bun test <filename>` - Run single test file
- `cd backend && vitest --ui` - Test UI with coverage
- `cd backend && vitest --coverage` - Coverage report (80% threshold)
- `cd frontend && npm run lint` - Frontend linting

## Voice E2E Tests

Test STT (Speech-to-Text) and TTS (Text-to-Speech) functionality:

```bash
# Local development (no auth required)
bun run scripts/test-voice-e2e.ts

# Remote deployment (with auth)
bun run scripts/test-voice-e2e.ts --url https://your-url.com --user admin --pass secret

# Using environment variables
OPENCODE_URL=https://your-url.com OPENCODE_USER=admin OPENCODE_PASS=secret bun run scripts/test-voice-e2e.ts

# Custom test phrase
bun run scripts/test-voice-e2e.ts --text "Your custom phrase to transcribe"
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

## Talk Mode E2E Tests

Test the full Talk Mode flow (STT -> OpenCode -> TTS):

```bash
# Local development (no auth required)
bun run scripts/test-talkmode-e2e.ts

# Remote deployment (with auth)
bun run scripts/test-talkmode-e2e.ts --url https://your-url.com --user admin --pass secret
```

Tests performed:
1. Talk Mode settings verification
2. STT transcription with 16kHz WAV audio
3. OpenCode session creation
4. Full flow: Audio -> STT -> Send to OpenCode -> Poll for response
5. TTS response synthesis

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
bun run scripts/test-voice-e2e.ts --url http://localhost:5003
bun run scripts/test-talkmode-e2e.ts --url http://localhost:5003
bun run scripts/test-talkmode-browser.ts --url http://localhost:5003
```

The browser test uses `window.__TALK_MODE_TEST__` API to inject audio directly into TalkModeContext, bypassing VAD (which can't detect speech from non-microphone sources reliably). This is how companies like OpenAI/Anthropic test voice features.

## Architecture

@docs/cloudVibeCoding.md
@./README.md