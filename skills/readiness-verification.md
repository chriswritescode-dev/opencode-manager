# Readiness Verification Skill

Quick verification playbook to ensure opencode-manager is fully operational before remote access.

## Quick Health Check (30 seconds)

```bash
# All-in-one health check
curl -s -u admin:PASSWORD http://localhost:5001/api/health | jq '{status, opencode, opencodeVersion}'
curl -s -u admin:PASSWORD http://localhost:5001/api/stt/status | jq '{running: .server.running, model: .server.model}'
curl -s -u admin:PASSWORD http://localhost:5001/api/tts/voices | jq 'length'
```

Expected output:
```json
{"status": "healthy", "opencode": "healthy", "opencodeVersion": "1.1.36"}
{"running": true, "model": "base"}
1
```

## Full Verification Checklist

### 1. Backend Health

```bash
curl -s -u admin:PASSWORD http://localhost:5001/api/health | jq .
```

| Field | Expected |
|-------|----------|
| status | "healthy" |
| database | "connected" |
| opencode | "healthy" |
| opencodeVersionSupported | true |

### 2. STT (Speech-to-Text) Verification

```bash
# Check status
curl -s -u admin:PASSWORD http://localhost:5001/api/stt/status | jq '{running: .server.running, model: .server.model}'

# Test transcription
say -v Samantha "Hello world" -o /tmp/test.aiff
ffmpeg -y -i /tmp/test.aiff -ar 16000 -ac 1 /tmp/test.wav 2>/dev/null
AUDIO=$(base64 -i /tmp/test.wav)
curl -s -u admin:PASSWORD -X POST http://localhost:5001/api/stt/transcribe \
  -H "Content-Type: application/json" \
  -d "{\"audio\": \"$AUDIO\", \"format\": \"wav\"}" | jq '.text'
```

Expected: `"Hello world."`

### 3. TTS (Text-to-Speech) Verification

```bash
# Check voices available
curl -s -u admin:PASSWORD http://localhost:5001/api/tts/voices | jq 'length'

# Test synthesis
curl -s -u admin:PASSWORD -X POST http://localhost:5001/api/tts/synthesize \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello world"}' \
  --output /tmp/tts_test.wav
file /tmp/tts_test.wav
afplay /tmp/tts_test.wav  # Listen to verify
```

Expected: WAV file that plays "Hello world"

### 4. Tunnel Verification

```bash
# Check tunnel status
pnpm tunnel:status

# Or get URL from running tunnel
cat ~/.local/run/opencode-manager/tunnel.json | jq '.url'
```

```bash
# Test over tunnel
TUNNEL_URL="https://your-url.trycloudflare.com"
curl -s -u admin:PASSWORD "$TUNNEL_URL/api/health" | jq '.status'
```

Expected: `"healthy"`

### 5. Repository Access

```bash
curl -s -u admin:PASSWORD http://localhost:5001/api/repos | jq '.[].name'
```

Expected: List of registered repository names

### 6. Session Creation Test

```bash
curl -s -u admin:PASSWORD "http://localhost:5001/api/opencode/session?directory=$(pwd)" -X POST | jq '{id, directory}'
```

Expected: Session object with id and directory

## Automated E2E Tests

```bash
# Voice E2E (11 tests)
bun run scripts/test-voice.ts --url http://localhost:5001 --user admin --pass PASSWORD --skip-talkmode

# Browser E2E (full pipeline)
bun run scripts/test-browser.ts --url http://localhost:5001 --user admin --pass PASSWORD
```

## Common Issues & Fixes

### Backend Not Running

```bash
# Check if running
lsof -ti:5001

# Start manually
cd /Users/engineer/workspace/opencode-manager
AUTH_USERNAME=admin AUTH_PASSWORD=PASSWORD PORT=5001 bun backend/src/index.ts
```

### STT Server Not Running

```bash
# Check Whisper server
curl -s http://localhost:5552/health

# Restart via backend (auto-starts on first request)
curl -s -u admin:PASSWORD http://localhost:5001/api/stt/status
```

### Tunnel Not Running

```bash
# Start tunnel
pnpm tunnel:start

# Check status
pnpm tunnel:status
```

### OpenCode Server Not Running

```bash
# Check OpenCode
lsof -ti:5551

# Start manually
opencode serve --port 5551 --hostname 127.0.0.1 &
```

### Port Conflicts

```bash
# Kill orphaned processes
pnpm cleanup

# Or manually
lsof -ti:5001,5173,5551,5552,5553,5554 | xargs kill
```

## Starting from Scratch

Complete startup sequence:

```bash
# 1. Clean up any orphaned processes
pnpm cleanup

# 2. Start OpenCode server (if not using existing)
opencode serve --port 5551 --hostname 127.0.0.1 &
sleep 3

# 3. Start persistent tunnel
pnpm tunnel:start

# 4. Start backend
AUTH_USERNAME=admin AUTH_PASSWORD=test123 PORT=5001 bun backend/src/index.ts &

# 5. Wait for Whisper model to load (~30s)
sleep 30

# 6. Verify everything
curl -s -u admin:test123 http://localhost:5001/api/health | jq '.status'
curl -s -u admin:test123 http://localhost:5001/api/stt/status | jq '.server.running'

# 7. Get tunnel URL
pnpm tunnel:status
```

## Architecture Notes

### Multiple Projects Support

OpenCode server is directory-bound. To work with multiple projects:

```bash
# Each project needs its own OpenCode server on different ports
opencode serve --port 5551 --hostname 127.0.0.1  # Project A (from dir A)
opencode serve --port 5553 --hostname 127.0.0.1  # Project B (from dir B)
```

### CLI vs Server Conflicts

If you have `opencode` CLI running in a terminal for the same directory:
- Both sessions edit the same files (potential conflicts)
- Git state changes unexpectedly
- Sessions don't know about each other's changes

Recommendation: Use either CLI or Server for a given directory, not both simultaneously.

## Settings UI Verification (MANDATORY)

Automated tests may pass while real user workflows fail. Always test via Settings UI:

1. Open http://localhost:5001 (or tunnel URL)
2. Go to Settings -> Voice
3. Click **"Test"** button for STT - verify transcription works
4. Click **"Test"** button for TTS - verify audio plays

These tests use DEFAULT settings (e.g., `language="auto"`) which may differ from test scripts.
