# OpenCode Manager - Testing Specification

This document defines how to test OpenCode Manager across all environments and components.

## Quick Reference

| Test Type | Command | Duration | Requirements |
|-----------|---------|----------|--------------|
| Health Check | `curl http://localhost:5001/api/health` | 1s | Backend running |
| Unit Tests | `cd backend && bun test` | 30s | None |
| Voice E2E | `bun run scripts/test-voice.ts` | 2min | Backend + Whisper |
| Browser E2E | `bun run scripts/test-browser.ts` | 3min | Full stack + Chrome |
| Tunnel Tests | See Section 9 | 5min | Backend + cloudflared |
| All E2E | `bun run scripts/run-e2e-tests.ts` | 5min | Full stack |
| QA Agent | `/qa-test` in OpenCode | 5min | Full stack |

## Prerequisites

### Required Software

```bash
# Core
bun --version      # >= 1.0
node --version     # >= 18
pnpm --version     # >= 8

# For voice tests
ffmpeg -version    # Audio conversion
say -v '?'         # macOS TTS (or espeak on Linux)

# For browser tests
# Puppeteer auto-downloads Chromium

# For tunnel tests
cloudflared --version
```

### Environment Setup

```bash
# Clone and install
git clone https://github.com/VibeTechnologies/opencode-manager.git
cd opencode-manager
pnpm install

# Copy environment config
cp .env.example .env
```

## Test Environments

### 1. Development Environment

```bash
# Start development servers
pnpm dev                    # Backend (5001) + Frontend (5173)

# Or separately
pnpm dev:backend            # Backend only
pnpm dev:frontend           # Frontend only
```

**Ports:**
- Backend API: http://localhost:5001
- Frontend: http://localhost:5173
- OpenCode Server: http://localhost:5551 (internal)
- Whisper STT: http://localhost:5552 (internal)
- Chatterbox TTS: http://localhost:5553 (internal)
- Coqui TTS: http://localhost:5554 (internal)

### 2. Native Start (with Tunnel)

```bash
# Full stack with Cloudflare tunnel
pnpm start

# Connect to existing opencode instance
pnpm start:client

# Without tunnel (local only)
pnpm start:no-tunnel
```

### 3. Docker Environment

```bash
# Pull and run CI-built image
./scripts/run-local-docker.sh

# Or build locally
docker compose up -d --build
```

**Port:** http://localhost:5003

### 4. Production (Azure VM)

```bash
# Deploy to Azure
bun run scripts/deploy.ts

# Check status
bun run scripts/deploy.ts --status
```

---

## Test Categories

### 1. Health Check Tests

Verify all services are running.

```bash
# Backend health
curl -s http://localhost:5001/api/health | jq .

# Expected response:
{
  "status": "healthy",
  "timestamp": "2026-01-11T...",
  "database": "connected",
  "opencode": "healthy",
  "opencodePort": 5551,
  "opencodeVersion": "1.1.13",
  "opencodeVersionSupported": true
}
```

```bash
# STT server status
curl -s http://localhost:5001/api/stt/status | jq .

# Expected:
{
  "server": { "running": true, "port": 5552 },
  "model": "base",
  ...
}
```

```bash
# TTS status (shows all providers)
curl -s http://localhost:5001/api/tts/status | jq .

# Expected:
{
  "enabled": true,
  "provider": "coqui",
  "chatterbox": { "running": false, ... },
  "coqui": { "running": true, "model": "tts_models/en/jenny/jenny", ... }
}
```

### 2. API Endpoint Tests

```bash
# List repositories
curl -s http://localhost:5001/api/repos | jq '.[].name'

# Get settings
curl -s http://localhost:5001/api/settings | jq '.tts.provider'

# List AI providers
curl -s http://localhost:5001/api/opencode/providers | jq '.[].name'

# OpenCode config
curl -s http://localhost:5001/api/settings/opencode-configs | jq '.[0].name'
```

### 3. Authentication Tests

When `AUTH_USERNAME` and `AUTH_PASSWORD` are set:

```bash
# Start with auth
AUTH_USERNAME=admin AUTH_PASSWORD=secret pnpm dev:backend

# Test scenarios
curl -i http://localhost:5001/api/health                    # 401 Unauthorized
curl -u admin:secret http://localhost:5001/api/health       # 200 OK
curl -u admin:wrong http://localhost:5001/api/health        # 401 Unauthorized
curl -u wrong:secret http://localhost:5001/api/health       # 401 Unauthorized
```

### 4. Voice/STT Tests

#### Manual STT Test

```bash
# Generate test audio (macOS)
say -v Samantha "Hello world" -o /tmp/test.aiff
ffmpeg -y -i /tmp/test.aiff -ar 16000 -ac 1 /tmp/test.wav

# Transcribe
AUDIO=$(base64 -i /tmp/test.wav)
curl -s -X POST http://localhost:5001/api/stt/transcribe \
  -H "Content-Type: application/json" \
  -d "{\"audio\": \"$AUDIO\", \"format\": \"wav\"}" | jq .

# Expected:
{
  "text": "Hello world.",
  "language": "en",
  "duration": 0.8
}
```

#### Automated Voice E2E

```bash
bun run scripts/test-voice.ts

# With remote URL
bun run scripts/test-voice.ts --url https://your-deployment.com

# With auth
bun run scripts/test-voice.ts --url https://your-url.com --user admin --pass secret

# Custom phrase
bun run scripts/test-voice.ts --text "Custom test phrase"

# Skip slow talk mode test
bun run scripts/test-voice.ts --skip-talkmode
```

**Tests performed:**
1. Health endpoint connectivity
2. Voice settings (TTS, STT, TalkMode config)
3. STT server status and available models
4. STT transcription with generated audio
5. TTS voices and synthesis endpoints
6. OpenCode session creation
7. Full talk mode flow: Audio -> STT -> OpenCode -> Response

### 5. TTS Tests

#### Chatterbox TTS

```bash
# Start Chatterbox (if not running)
curl -X POST http://localhost:5001/api/tts/chatterbox/start

# Check status
curl -s http://localhost:5001/api/tts/chatterbox/status | jq .

# Synthesize speech
curl -X POST http://localhost:5001/api/tts/synthesize \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello world", "provider": "chatterbox"}' \
  --output /tmp/chatterbox.wav && afplay /tmp/chatterbox.wav
```

#### Coqui TTS (Jenny)

```bash
# Start Coqui (if not running)
curl -X POST http://localhost:5001/api/tts/coqui/start

# Check status
curl -s http://localhost:5001/api/tts/coqui/status | jq .

# List voices
curl -s http://localhost:5001/api/tts/coqui/voices | jq .

# Synthesize speech
curl -X POST http://localhost:5001/api/tts/synthesize \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello world"}' \
  --output /tmp/coqui.wav && afplay /tmp/coqui.wav
```

### 6. Browser E2E Tests

Full pipeline test using Chrome's fake audio capture:

```bash
# Headless (CI mode)
bun run scripts/test-browser.ts --url http://localhost:5001

# With visible browser (debugging)
bun run scripts/test-browser.ts --url http://localhost:5001 --no-headless

# Over tunnel
bun run scripts/test-browser.ts --url https://your-tunnel.trycloudflare.com

# With auth
bun run scripts/test-browser.ts --url https://your-url.com --user admin --pass secret

# Use Web Audio API injection instead of fake device
bun run scripts/test-browser.ts --web-audio
```

**Test flow:**
1. Generate audio using `say` command
2. Launch Chrome with fake audio capture
3. Navigate to app, start Talk Mode
4. Audio captured via MediaRecorder
5. Verify STT transcription
6. Wait for OpenCode response
7. Verify response content

### 7. Unit Tests

```bash
# Run all backend tests
cd backend && bun test

# Run specific test file
cd backend && bun test src/services/whisper.test.ts

# With coverage
cd backend && vitest --coverage

# Interactive test UI
cd backend && vitest --ui
```

**Coverage threshold:** 80% minimum

### 8. Docker Tests

```bash
# Pull and run CI image
./scripts/run-local-docker.sh

# Wait for startup (~90s for model loading)
sleep 90

# Verify health
curl -s http://localhost:5003/api/health | jq '.status'

# Check STT is ready
curl -s http://localhost:5003/api/stt/status | jq '.server.running'

# Run E2E tests against container
bun run scripts/run-e2e-tests.ts --url http://localhost:5003
```

### 9. Cloudflare Tunnel Tests

Test the application over Cloudflare's quick tunnel for public HTTPS access.

#### Prerequisites

```bash
# Install cloudflared (macOS)
brew install cloudflared

# Verify installation
cloudflared --version
```

#### Option A: Start App with Integrated Tunnel

```bash
# Start full stack with tunnel (recommended)
pnpm start

# Wait for startup (~60-90s for model loading)
# Look for tunnel URL in output:
# https://xxx-xxx-xxx-xxx.trycloudflare.com
```

#### Option B: Manual Tunnel (for existing backend)

```bash
# If backend already running on port 5001
cloudflared tunnel --no-autoupdate --protocol http2 --url http://localhost:5001 2>&1 | tee /tmp/tunnel.log &

# Wait for tunnel URL
sleep 5
grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' /tmp/tunnel.log | tail -1
```

#### Tunnel Test Procedure

Once you have the tunnel URL, run these tests:

```bash
# Set tunnel URL variable
TUNNEL_URL="https://your-tunnel-url.trycloudflare.com"

# 1. Health Check
curl -s "$TUNNEL_URL/api/health" | jq '.status'
# Expected: "healthy"

# 2. STT Status
curl -s "$TUNNEL_URL/api/stt/status" | jq '{running: .server.running, model: .server.model}'
# Expected: {"running": true, "model": "base"}

# 3. TTS Status
curl -s "$TUNNEL_URL/api/tts/status" | jq '{provider: .provider, running: .coqui.running}'
# Expected: {"provider": "coqui", "running": true}

# 4. Repos API
curl -s "$TUNNEL_URL/api/repos" | jq 'length'
# Expected: number > 0

# 5. STT Transcription over Tunnel
say -v Samantha "Hello world test" -o /tmp/tunnel_test.aiff
ffmpeg -y -i /tmp/tunnel_test.aiff -ar 16000 -ac 1 /tmp/tunnel_test.wav 2>/dev/null
AUDIO=$(base64 -i /tmp/tunnel_test.wav)
curl -s -X POST "$TUNNEL_URL/api/stt/transcribe" \
  -H "Content-Type: application/json" \
  -d "{\"audio\": \"$AUDIO\", \"format\": \"wav\"}" | jq '.text'
# Expected: "Hello world test."

# 6. TTS Synthesis over Tunnel
curl -s -X POST "$TUNNEL_URL/api/tts/synthesize" \
  -H "Content-Type: application/json" \
  -d '{"text": "Testing synthesis over tunnel"}' \
  --output /tmp/tunnel_tts.wav
file /tmp/tunnel_tts.wav
# Expected: RIFF (little-endian) data, WAVE audio...
afplay /tmp/tunnel_tts.wav  # Listen to verify
```

#### Automated Tunnel Tests

```bash
# Voice E2E test over tunnel
bun run scripts/test-voice.ts --url $TUNNEL_URL

# Browser E2E test over tunnel
bun run scripts/test-browser.ts --url $TUNNEL_URL

# With authentication (if enabled)
bun run scripts/test-voice.ts --url $TUNNEL_URL --user admin --pass secret
```

#### Expected Performance

| Operation | Local | Over Tunnel |
|-----------|-------|-------------|
| Health Check | <100ms | ~200ms |
| STT (3s audio) | ~1s | ~3-4s |
| TTS (3s audio) | ~2s | ~8-10s |

Increased latency over tunnel is expected due to:
- Audio data upload through Cloudflare edge
- Round-trip to origin server
- Response download through tunnel

#### Tunnel Test Success Criteria

- [ ] Tunnel URL generated successfully
- [ ] Health endpoint returns `"status": "healthy"`
- [ ] STT transcription works and is accurate
- [ ] TTS synthesis returns valid WAV audio
- [ ] All API endpoints accessible via HTTPS
- [ ] No certificate errors

#### Cleanup

```bash
# Kill tunnel process
pkill -f "cloudflared tunnel"

# Or if using pnpm start
pnpm cleanup
```

---

## Complete E2E Test Suite

Run all E2E tests in sequence:

```bash
bun run scripts/run-e2e-tests.ts

# Against specific URL
bun run scripts/run-e2e-tests.ts --url http://localhost:5003

# With auth
bun run scripts/run-e2e-tests.ts --url https://your-url.com --user admin --pass secret
```

---

## QA Agent Testing

Use the autonomous QA agent for comprehensive testing:

```bash
# In OpenCode chat
/qa-test

# Or quick health check
/qa-health
```

The QA agent will:
1. Execute all test protocols
2. Evaluate results against expected outputs
3. Generate a professional test report
4. Identify issues and provide recommendations

---

## Manual Test Procedures

### Client Mode Auto-Registration Test

Verifies that `pnpm start:client` auto-registers the connected server's working directory.

**Pre-Conditions:**
- Reset database to fresh state
- No existing processes on managed ports

**Steps:**

1. **Clean State Setup**
   ```bash
   pnpm cleanup
   mv data/opencode.db data/opencode.db.bak 2>/dev/null || true
   ```

2. **Start OpenCode Server**
   ```bash
   opencode serve --port 5551 --hostname 127.0.0.1 &
   sleep 3
   curl -s http://127.0.0.1:5551/session | jq '.[0].directory'
   ```

3. **Start Client Mode**
   ```bash
   pnpm start:client
   # Wait ~20 seconds for full startup
   ```

4. **Verify**
   ```bash
   curl -s http://localhost:5001/api/repos | jq '.[].fullPath'
   # Should show the workspace directory
   ```

5. **Cleanup**
   ```bash
   pnpm cleanup
   mv data/opencode.db.bak data/opencode.db 2>/dev/null || true
   ```

### Voice Mode End-to-End Test

Verifies: audio capture -> STT -> OpenCode -> file creation

**Steps:**

1. **Verify Services**
   ```bash
   curl -s http://localhost:5001/api/health | jq '.status'
   curl -s http://localhost:5001/api/stt/status | jq '.server.running'
   ```

2. **Generate Test Audio**
   ```bash
   say -v Samantha "Write a simple hello world Python application" -o /tmp/voice_cmd.aiff
   ffmpeg -y -i /tmp/voice_cmd.aiff -ar 16000 -ac 1 /tmp/voice_cmd.wav
   ```

3. **Test STT**
   ```bash
   AUDIO=$(base64 -i /tmp/voice_cmd.wav)
   curl -s -X POST http://localhost:5001/api/stt/transcribe \
     -H "Content-Type: application/json" \
     -d "{\"audio\": \"$AUDIO\", \"format\": \"wav\"}" | jq '.text'
   ```

4. **Send to OpenCode** (creates file via AI)
   ```bash
   SESSION_ID=$(curl -s -X POST \
     "http://localhost:5001/api/opencode/session?directory=$PWD/workspace" \
     -H "Content-Type: application/json" \
     -d '{"title":"Voice Test"}' | jq -r '.id')
   
   curl -s -X POST \
     "http://localhost:5001/api/opencode/session/$SESSION_ID/message?directory=$PWD/workspace" \
     -H "Content-Type: application/json" \
     -d '{"parts":[{"type":"text","text":"Write hello.py with print Hello World"}]}'
   ```

5. **Verify File**
   ```bash
   sleep 10
   cat workspace/hello.py
   python3 workspace/hello.py
   ```

---

## CI/CD Integration

### GitHub Actions Workflow

```yaml
name: E2E Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Bun
        uses: oven-sh/setup-bun@v1
        
      - name: Install dependencies
        run: pnpm install
        
      - name: Install audio tools
        run: |
          sudo apt-get update
          sudo apt-get install -y ffmpeg espeak
          
      - name: Pull and run Docker image
        run: ./scripts/run-local-docker.sh &
        
      - name: Wait for services
        run: |
          sleep 90
          curl --retry 10 --retry-delay 5 http://localhost:5003/api/health
          
      - name: Run E2E tests
        run: bun run scripts/run-e2e-tests.ts --url http://localhost:5003
```

---

## Troubleshooting

### Port Conflicts

```bash
# Kill orphaned processes
pnpm cleanup

# Or manually
lsof -ti:5001,5173,5551,5552,5553,5554 | xargs kill
```

### Empty Audio Files

```bash
# Use explicit voice on macOS
say -v Samantha "Your text" -o output.aiff

# Check available voices
say -v '?'
```

### STT Returns Empty Text

```bash
# Check Whisper server
curl http://localhost:5552/health

# Verify WAV format (must be 16kHz mono)
file /tmp/test.wav
afinfo /tmp/test.wav
```

### OpenCode Not Responding

```bash
# Check OpenCode is installed
which opencode
opencode --version

# Check server is running
curl http://localhost:5551/doc
```

### Database Locked

```bash
# Find processes using database
lsof data/opencode.db

# Kill orphaned processes
pnpm cleanup
```

### TTS Server Won't Start

```bash
# Check Python venv exists
ls -la ~/.opencode-manager/coqui-venv
ls -la /opt/chatterbox-venv  # Docker

# Check logs
curl http://localhost:5001/api/tts/coqui/status | jq '.error'
```

---

## Test Data Locations

| Data | Location |
|------|----------|
| Database | `data/opencode.db` |
| TTS Cache | `data/tts-cache/` |
| Whisper Models | `~/.cache/whisper/` |
| Coqui Models | `~/.local/share/tts/` |
| Test Reports | `.test/reports/` |
| Test Audio | `/tmp/` (generated) |

---

## Verification Checklist

Before deployment, verify:

- [ ] `curl /api/health` returns `"status": "healthy"`
- [ ] `curl /api/stt/status` shows `"running": true`
- [ ] `curl /api/tts/status` shows provider running
- [ ] `curl /api/repos` returns repository list
- [ ] STT transcribes test audio correctly
- [ ] TTS generates audible speech
- [ ] Cloudflare tunnel accessible (if using)
- [ ] STT works over tunnel
- [ ] TTS works over tunnel
- [ ] Browser E2E test passes
- [ ] No console errors in browser DevTools
