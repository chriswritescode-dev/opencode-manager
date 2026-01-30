# OpenCode Manager - Product Requirements

This document defines the core requirements for opencode-manager. All features MUST work as specified here. Reference this document when implementing or modifying functionality.

## 1. Cloudflare Tunnel (MANDATORY)

### Requirement
opencode-manager MUST always start with a Cloudflare tunnel, regardless of how it is started:
- `pnpm start`
- `opencode-manager start`
- macOS plist service (`opencode-manager install-service`)
- Docker container

### Behavior
1. On startup, cloudflared tunnel MUST be started automatically
2. The tunnel URL MUST be written to `~/.local/run/opencode-manager/endpoints.json`
3. The endpoints.json MUST always contain a valid, accessible tunnel endpoint
4. If tunnel fails to start, the service should retry or fail with clear error

### Endpoints File Format
```json
{
  "endpoints": [
    {
      "type": "local",
      "url": "http://localhost:5001",
      "timestamp": "2026-01-30T04:38:11.083Z"
    },
    {
      "type": "tunnel",
      "url": "https://user:pass@xxx.trycloudflare.com",
      "timestamp": "2026-01-30T04:38:11.083Z"
    }
  ]
}
```

### Why This Matters
The user accesses opencode-manager from mobile devices and remote locations via the tunnel URL. Without a working tunnel endpoint in endpoints.json, remote access is impossible.

---

## 2. Text-to-Speech (TTS)

### Requirement
TTS MUST work with two providers, switchable in Settings → Voice:

| Provider | Description | Requirements |
|----------|-------------|--------------|
| **Coqui/Chatterbox** | Local neural TTS | Model auto-downloads on first use |
| **Browser API** | Web Speech API | No server-side requirements |

### Behavior
1. User selects TTS provider in Settings → Voice
2. Selected provider is persisted in database
3. TTS synthesis works via `/api/tts/synthesize` endpoint
4. Browser API fallback available when Coqui unavailable
5. Test button in Settings verifies TTS is working

### API Endpoints
- `GET /api/tts/voices` - List available voices
- `POST /api/tts/synthesize` - Synthesize text to audio
- `GET /api/tts/status` - Check TTS server status

---

## 3. Speech-to-Text (STT)

### Requirement
STT MUST work with two providers, switchable in Settings → Voice:

| Provider | Description | Requirements |
|----------|-------------|--------------|
| **Faster Whisper** | Local STT server | Starts automatically with opencode-manager |
| **Browser API** | Web Speech Recognition API | Chrome/Edge only |

### Behavior
1. Faster Whisper server starts automatically on port 5552
2. Whisper model downloads automatically on first use (default: `base`)
3. User can switch between Whisper and Browser API in Settings
4. Selected provider is persisted in database
5. Test button in Settings verifies STT is working

### API Endpoints
- `GET /api/stt/status` - Check Whisper server status and loaded model
- `POST /api/stt/transcribe` - Transcribe audio file
- `GET /api/stt/models` - List available Whisper models

### Whisper Server
- Script: `scripts/whisper-server.py`
- Port: 5552 (configurable via `WHISPER_PORT`)
- Models: tiny, base, small, medium, large-v2, large-v3
- Storage: `workspace/cache/whisper-models/`

---

## 4. Telegram Integration

### Requirement
When `TELEGRAM_BOT_TOKEN` environment variable is provided, Telegram bot integration MUST start automatically.

### Architecture
```
┌─────────────┐     ┌──────────────────────────────────────┐
│  Telegram   │────▶│         opencode-manager             │
│   User      │◀────│  ┌──────────┐    ┌──────────────┐   │
└─────────────┘     │  │ Telegram │───▶│   OpenCode   │   │
                    │  │ Service  │◀───│   SDK Client │   │
                    │  └──────────┘    └──────────────┘   │
                    └──────────────────────────────────────┘
```

### Behavior
1. Check for `TELEGRAM_BOT_TOKEN` on startup
2. If present, start Telegram bot using grammy library
3. Bot receives messages and forwards to OpenCode session
4. Responses are sent back to Telegram chat (chunked for 4096 char limit)
5. Status visible in health endpoint: `/api/health`
6. Optional allowlist via `TELEGRAM_ALLOWLIST` env var

### Configuration
```bash
# Required - Bot token from @BotFather
TELEGRAM_BOT_TOKEN=<your-bot-token-from-botfather>

# Optional - Comma-separated chat IDs for access control
TELEGRAM_ALLOWLIST=<chat-id-1>,<chat-id-2>
```

### API Endpoints
- `GET /api/telegram/status` - Bot status, session count, allowlist count
- `POST /api/telegram/start` - Start bot manually
- `POST /api/telegram/stop` - Stop bot
- `GET /api/telegram/sessions` - List active chat sessions
- `GET /api/telegram/allowlist` - List allowed chat IDs
- `POST /api/telegram/allowlist` - Add chat ID to allowlist
- `DELETE /api/telegram/allowlist/:chatId` - Remove from allowlist

### Features
- Per-chat session persistence (stored in SQLite)
- Forward text messages to OpenCode
- Receive and display OpenCode responses
- Typing indicator while processing
- Message queuing to prevent race conditions
- Optional allowlist for access control

---

## 5. Settings UI

### Requirement
Settings page MUST provide configuration for all voice features with working test buttons.

### Voice Settings Section
| Setting | Options | Default |
|---------|---------|---------|
| STT Provider | Faster Whisper, Browser API | Faster Whisper |
| STT Model | tiny, base, small, medium, large | base |
| STT Language | auto, en, es, fr, de, ... | auto |
| TTS Provider | Coqui/Chatterbox, Browser API | Coqui |
| TTS Voice | (depends on provider) | default |

### Test Buttons
- **Test STT**: Records audio → transcribes → shows result
- **Test TTS**: Synthesizes sample text → plays audio

### Persistence
All settings stored in SQLite database and survive restarts.

---

## 6. Health Checks

### Requirement
Health endpoints MUST accurately report status of all services.

### Endpoints
```bash
# Overall health
GET /api/health
{
  "status": "healthy",
  "opencode": { "connected": true, "port": 5551 },
  "whisper": { "running": true, "port": 5552 },
  "tts": { "available": true }
}

# STT-specific status
GET /api/stt/status
{
  "server": { "running": true, "port": 5552 },
  "model": { "name": "base", "loaded": true }
}

# TTS-specific status  
GET /api/tts/status
{
  "available": true,
  "provider": "coqui",
  "model": "chatterbox"
}
```

---

## Testing Requirements

All features MUST be tested before release:

```bash
# Unit tests (103+ tests, 80% coverage)
pnpm test

# Voice E2E tests
bun run scripts/test-voice.ts --url http://localhost:5001

# Browser E2E tests (full Talk Mode pipeline)
bun run scripts/test-browser.ts --url http://localhost:5001

# Manual Settings UI verification
# 1. Open Settings → Voice
# 2. Click Test STT → verify transcription works
# 3. Click Test TTS → verify audio plays
```

---

## Acceptance Criteria Checklist

Before any release, verify:

- [ ] `opencode-manager start` starts tunnel and writes to endpoints.json
- [ ] `opencode-manager install-service` creates service that starts tunnel
- [ ] endpoints.json contains valid tunnel URL after startup
- [ ] STT works with Faster Whisper (test in Settings)
- [ ] STT works with Browser API (test in Settings)
- [ ] TTS works with Coqui/Chatterbox (test in Settings)
- [ ] TTS works with Browser API (test in Settings)
- [ ] Telegram bot works when TELEGRAM_BOT_TOKEN is set
- [ ] All E2E tests pass
