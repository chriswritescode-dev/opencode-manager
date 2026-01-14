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
2. **Authentication enforcement** (401 without auth, 401 with wrong auth, 200 with correct auth)
3. **OpenCode proxy dynamic port** (verifies proxy uses correct port in client mode)
4. Voice settings (TTS, STT, TalkMode config)
5. STT server status and available models
6. STT transcription with generated audio
7. STT error handling (invalid base64, empty input)
8. TTS voices and synthesis endpoints
9. OpenCode model configuration check
10. OpenCode session creation
11. Full talk mode flow: Audio -> STT -> OpenCode -> Response

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

### Client Mode with Tunnel and Authentication Test

Verifies that `pnpm start:client` exposes existing opencode sessions over Cloudflare tunnel with password protection, enabling remote access from mobile devices.

**Pre-Conditions:**
- An opencode server running locally (e.g., `opencode -c` in a terminal)
- `cloudflared` installed (`brew install cloudflared`)
- No processes on managed ports (5001, 5173, 5552-5554)

**Steps:**

1. **Clean State Setup**
   ```bash
   pnpm cleanup
   ```

2. **Verify OpenCode Server Running**
   ```bash
   # Find running opencode servers
   lsof -i -P | grep opencode | grep LISTEN
   # Should show at least one opencode process
   ```

3. **Start Client Mode with Auth**
   ```bash
   AUTH_USERNAME=admin AUTH_PASSWORD=secret123 pnpm start:client
   # Wait for tunnel URL to appear (~30s)
   # Note the tunnel URL: https://xxx.trycloudflare.com
   ```

4. **Test Authentication Required (from another terminal or device)**
   ```bash
   TUNNEL_URL="https://your-tunnel-url.trycloudflare.com"
   
   # Without auth - should return 401
   curl -s -w "\nHTTP: %{http_code}\n" "$TUNNEL_URL/api/health"
   # Expected: "Unauthorized" with HTTP: 401
   
   # With wrong password - should return 401
   curl -s -u admin:wrongpass "$TUNNEL_URL/api/health"
   # Expected: "Unauthorized"
   
   # With correct auth - should succeed
   curl -s -u admin:secret123 "$TUNNEL_URL/api/health" | jq '.status'
   # Expected: "healthy"
   ```

5. **Test Session Access Over Tunnel**
   ```bash
   # Get sessions from connected opencode server
   curl -s -u admin:secret123 "$TUNNEL_URL/api/opencode/session" | jq '.[0] | {id, title}'
   # Expected: Session object with id and title
   
   # Get session messages (realtime updates)
   SESSION_ID=$(curl -s -u admin:secret123 "$TUNNEL_URL/api/opencode/session" | jq -r '.[0].id')
   curl -s -u admin:secret123 "$TUNNEL_URL/api/opencode/session/$SESSION_ID/message" | jq 'length'
   # Expected: Number of messages in session
   ```

6. **Test Full API Suite Over Tunnel**
   ```bash
   # All these should work with auth
   curl -s -u admin:secret123 "$TUNNEL_URL/api/repos" | jq 'length'
   curl -s -u admin:secret123 "$TUNNEL_URL/api/settings" | jq '.preferences.theme'
   curl -s -u admin:secret123 "$TUNNEL_URL/api/stt/status" | jq '.server.running'
   curl -s -u admin:secret123 "$TUNNEL_URL/api/opencode/config" | jq '.model'
   ```

7. **Test Mobile Access**
   - Open tunnel URL in mobile browser
   - Enter credentials when prompted (HTTP Basic Auth)
   - Verify web UI loads and shows sessions
   - Verify realtime updates when messages appear in local terminal

8. **Cleanup**
   ```bash
   pnpm cleanup
   ```

**Success Criteria:**
- [ ] Without auth: All endpoints return 401 Unauthorized
- [ ] With wrong credentials: Returns 401 Unauthorized
- [ ] With correct auth: All endpoints accessible
- [ ] Sessions from local opencode visible over tunnel
- [ ] Session messages accessible with realtime updates possible
- [ ] Mobile browser can authenticate and view sessions

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

---

## Regression Tests for Known Bugs

These tests verify fixes for bugs that were discovered and fixed. Run `bun run scripts/test-voice.ts` to execute them automatically.

### Bug #1: Authentication bypass in startup health check

**Issue:** When `AUTH_USERNAME` and `AUTH_PASSWORD` are set, `pnpm start:client` would hang indefinitely because `waitForBackendHealth()` didn't include auth headers.

**Fix:** `scripts/start-native.ts` - Added auth headers to health check requests.

**Test:** `testAuthEnforced()` in test-voice.ts
- Verifies 401 returned without credentials
- Verifies 401 returned with wrong credentials  
- Verifies 200 returned with correct credentials

**Manual verification:**
```bash
AUTH_USERNAME=admin AUTH_PASSWORD=secret pnpm start:client
# Should complete startup within 30s, not hang
```

### Bug #2: OpenCode proxy uses wrong port in client mode

**Issue:** When connecting to an existing opencode server on a non-default port (e.g., 3333 instead of 5551), the `/api/opencode/*` proxy would fail because `OPENCODE_SERVER_URL` was a constant evaluated at module import time, before the environment variable was set.

**Fix:** `backend/src/services/proxy.ts` - Changed from constant to function `getOpenCodeServerUrl()` that reads the port dynamically at request time.

**Test:** `testOpenCodeProxyDynamic()` in test-voice.ts
- Checks health endpoint for configured opencode port
- Verifies `/api/opencode/session` returns JSON (not HTML from frontend)
- Confirms sessions are accessible from the connected server

**Manual verification:**
```bash
# Start opencode on non-standard port
opencode serve --port 3333 &

# Connect via client mode
pnpm start:client

# Verify proxy works
curl http://localhost:5001/api/opencode/session | head -c 100
# Should return JSON array, not HTML
```

### Bug #3: Orphaned Coqui TTS process blocks port 5554

**Issue:** `pnpm cleanup` didn't include port 5554 (Coqui TTS), causing orphaned Python processes to block TTS synthesis on subsequent runs.

**Fix:** 
- `scripts/cleanup.ts` - Added port 5554 to PORTS.coqui
- `AGENTS.md` - Updated manual cleanup command to include 5554

**Test:** TTS Synthesis test in test-voice.ts will fail if port is blocked.

**Manual verification:**
```bash
# Check cleanup includes 5554
pnpm cleanup --dry-run
# Should show coqui on port 5554 if process exists

# Verify port is in cleanup list
grep 5554 scripts/cleanup.ts
```

### Bug #4: Model defaults missing in deployment config

**Issue:** Deploy script didn't set default models, causing failures when OAuth tokens were used without explicit model configuration.

**Fix:** `scripts/deploy.ts` - Added default `model` and `small_model` fields to `getBaseOpencodeConfig()`.

**Test:** `testOpenCodeModelAvailable()` in test-voice.ts verifies model is configured.

**Manual verification:**
```bash
curl http://localhost:5001/api/opencode/config | jq '{model, small_model}'
# Should show configured models, not null
```

### Bug #5: SSE endpoint path incorrect in PermissionContext

**Issue:** `frontend/src/contexts/PermissionContext.tsx` was connecting to `/stream` instead of `/event` for SSE events. This meant `session.idle` and `permission.updated` events were never received, breaking push notifications.

**Fix:** Changed SSE endpoint from `/stream` to `/event` in PermissionContext.tsx (lines 271, 273).

**Test:** Unit tests in `frontend/src/lib/notificationEvents.test.ts` verify event emission.

**Manual verification:**
```bash
# Open browser DevTools Network tab
# Filter by "event" 
# Should see EventSource connection to /event endpoint
# When session goes idle, should see session.idle event
```

---

## 10. Browser Push Notification Tests

Test the push notification system for session completion and permission requests.

### Unit Tests

```bash
# Run all notification-related tests
cd frontend && npm test -- --run \
  src/hooks/useNotifications.test.tsx \
  src/lib/notificationEvents.test.ts \
  src/components/settings/NotificationSettings.test.tsx \
  src/components/providers/NotificationProvider.test.tsx

# Expected: 51 tests passing
```

### Manual Browser Test

1. **Start the application**
   ```bash
   AUTH_USERNAME=admin AUTH_PASSWORD=secret123 pnpm start:client
   # Note the tunnel URL
   ```

2. **Enable notifications in browser**
   - Open app in browser (tunnel URL or localhost:5173)
   - Go to Settings → Notifications
   - Toggle "Enable notifications" ON
   - Grant browser permission when prompted
   - Toggle "Session complete" and "Permission requests" ON

3. **Test session completion notification**
   - Open a session and send a message
   - Wait for the response to complete (session goes idle)
   - Verify browser notification appears with session details
   - Click notification to navigate to session

4. **Test permission request notification** (requires YOLO mode OFF)
   - Disable YOLO mode in settings if enabled
   - Send a message that requires tool approval
   - Verify notification appears for permission request
   - Click notification to navigate and approve

### Verify SSE Connection

```bash
# Check SSE events are being received
# In browser DevTools → Network → Filter "event"
# Should see EventSource connection with events streaming
```

### Mobile Push Notification Test

1. **On mobile device:**
   - Open tunnel URL in mobile browser (Chrome/Safari)
   - Login with credentials
   - Go to Settings → Notifications → Enable all
   - Grant browser notification permission

2. **On desktop (trigger events):**
   - Open same session in desktop browser
   - Send a message and wait for completion

3. **Verify on mobile:**
   - Push notification should appear
   - Tapping notification opens app to correct session

### Architecture Notes

- Notifications handled globally via `PermissionContext`
- SSE connects to `/event` endpoint for all active repos
- `session.idle` events trigger session-complete notifications
- `permission.updated` events (when auto-approve fails) trigger permission-request notifications
- `repoId` included in events for proper navigation URL construction
