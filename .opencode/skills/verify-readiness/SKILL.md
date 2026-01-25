---
name: verify-readiness
description: Verify opencode-manager is fully operational before remote access. Use when checking health, after deployment, or when troubleshooting service issues.
metadata:
  author: opencode-manager
  version: "1.0"
---

Verify opencode-manager is fully operational.

## Quick Health Check (30 seconds)

Run these commands to verify all services:

```bash
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

### 2. STT (Speech-to-Text)

```bash
curl -s -u admin:PASSWORD http://localhost:5001/api/stt/status | jq '{running: .server.running, model: .server.model}'

say -v Samantha "Hello world" -o /tmp/test.aiff
ffmpeg -y -i /tmp/test.aiff -ar 16000 -ac 1 /tmp/test.wav 2>/dev/null
AUDIO=$(base64 -i /tmp/test.wav)
curl -s -u admin:PASSWORD -X POST http://localhost:5001/api/stt/transcribe \
  -H "Content-Type: application/json" \
  -d "{\"audio\": \"$AUDIO\", \"format\": \"wav\"}" | jq '.text'
```

Expected: `"Hello world."`

### 3. TTS (Text-to-Speech)

```bash
curl -s -u admin:PASSWORD http://localhost:5001/api/tts/voices | jq 'length'

curl -s -u admin:PASSWORD -X POST http://localhost:5001/api/tts/synthesize \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello world"}' \
  --output /tmp/tts_test.wav
file /tmp/tts_test.wav
afplay /tmp/tts_test.wav
```

### 4. Tunnel

```bash
pnpm tunnel:status
cat ~/.local/run/opencode-manager/tunnel.json | jq '.url'

TUNNEL_URL="https://your-url.trycloudflare.com"
curl -s -u admin:PASSWORD "$TUNNEL_URL/api/health" | jq '.status'
```

### 5. Repositories

```bash
curl -s -u admin:PASSWORD http://localhost:5001/api/repos | jq '.[].name'
```

### 6. Session Creation

```bash
curl -s -u admin:PASSWORD "http://localhost:5001/api/opencode/session?directory=$(pwd)" -X POST | jq '{id, directory}'
```

## Automated E2E Tests

```bash
bun run scripts/test-voice.ts --url http://localhost:5001 --user admin --pass PASSWORD --skip-talkmode
bun run scripts/test-browser.ts --url http://localhost:5001 --user admin --pass PASSWORD
```

## Common Issues

### Backend Not Running

```bash
lsof -ti:5001
cd /Users/engineer/workspace/opencode-manager
AUTH_USERNAME=admin AUTH_PASSWORD=PASSWORD PORT=5001 bun backend/src/index.ts
```

### STT Server Not Running

```bash
curl -s http://localhost:5552/health
curl -s -u admin:PASSWORD http://localhost:5001/api/stt/status
```

### Tunnel Not Running

```bash
pnpm tunnel:start
pnpm tunnel:status
```

### OpenCode Server Not Running

```bash
lsof -ti:5551
opencode serve --port 5551 --hostname 127.0.0.1 &
```

### Port Conflicts

```bash
pnpm cleanup
lsof -ti:5001,5173,5551,5552,5553,5554 | xargs kill
```

## Starting from Scratch

```bash
pnpm cleanup
opencode serve --port 5551 --hostname 127.0.0.1 &
sleep 3
pnpm tunnel:start
AUTH_USERNAME=admin AUTH_PASSWORD=test123 PORT=5001 bun backend/src/index.ts &
sleep 30
curl -s -u admin:test123 http://localhost:5001/api/health | jq '.status'
curl -s -u admin:test123 http://localhost:5001/api/stt/status | jq '.server.running'
pnpm tunnel:status
```

## Settings UI Verification (MANDATORY)

Automated tests may pass while real user workflows fail. Always test via Settings UI:

1. Open http://localhost:5001 (or tunnel URL)
2. Go to Settings -> Voice
3. Click "Test" button for STT - verify transcription works
4. Click "Test" button for TTS - verify audio plays

These tests use DEFAULT settings (e.g., `language="auto"`) which may differ from test scripts.
