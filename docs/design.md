# OpenCode Manager Voice Architecture

Live voice chat for AI-assisted coding using OpenCode, Whisper STT, Chatterbox TTS, and streaming VAD.

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                                  BROWSER                                         │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │                         TalkModeContext                                   │   │
│  │  ┌────────────────┐    ┌─────────────────┐    ┌────────────────────┐    │   │
│  │  │  useStreaming  │───▶│  MediaRecorder  │───▶│  Blob (webm/opus)  │    │   │
│  │  │     VAD        │    │  (100ms chunks) │    │   2.5s batches     │    │   │
│  │  └────────────────┘    └─────────────────┘    └─────────┬──────────┘    │   │
│  │         │                                               │               │   │
│  │         │ silenceTimeoutMs=1500                         │ base64        │   │
│  │         ▼                                               ▼               │   │
│  │  ┌────────────────┐                          ┌─────────────────────┐   │   │
│  │  │ Silence Detect │◀─── no new words ───────│   STT API Client    │   │   │
│  │  │  (1.5s timer)  │                          │  POST /api/stt/     │   │   │
│  │  └───────┬────────┘                          │    transcribe       │   │   │
│  │          │                                   └─────────────────────┘   │   │
│  │          │ fullTranscript                                              │   │
│  │          ▼                                                             │   │
│  │  ┌────────────────────────────────────────────────────────────────┐   │   │
│  │  │                    sendToOpenCode()                             │   │   │
│  │  │  POST /api/opencode/session/{id}/message                        │   │   │
│  │  │  body: { parts: [{ type: 'text', text: transcript }] }          │   │   │
│  │  └────────────────────────────────┬───────────────────────────────┘   │   │
│  │                                   │                                    │   │
│  │          ┌────────────────────────┼────────────────────────┐          │   │
│  │          │      Poll every 500ms  │  GET /session/{id}/message        │   │
│  │          │                        ▼                        │          │   │
│  │          │              ┌─────────────────┐                │          │   │
│  │          │              │ Wait for        │                │          │   │
│  │          │              │ assistant msg   │                │          │   │
│  │          │              │ time.completed  │                │          │   │
│  │          │              └────────┬────────┘                │          │   │
│  │          └───────────────────────┼─────────────────────────┘          │   │
│  │                                  │                                     │   │
│  │                                  ▼                                     │   │
│  │                         ┌─────────────────┐                           │   │
│  │                         │   useTTS hook   │                           │   │
│  │                         │  speak(text)    │───▶ Audio Element         │   │
│  │                         └─────────────────┘                           │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      │ HTTP
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           BACKEND (Bun + Hono)                                   │
│                              Port 5003                                           │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │                              Routes                                       │   │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌─────────────────┐    │   │
│  │  │ /api/stt/* │  │ /api/tts/* │  │ /api/      │  │ /api/opencode/* │    │   │
│  │  │            │  │            │  │ settings   │  │                 │    │   │
│  │  └─────┬──────┘  └─────┬──────┘  └────────────┘  └────────┬────────┘    │   │
│  │        │               │                                   │             │   │
│  │        ▼               ▼                                   ▼             │   │
│  │  ┌───────────────────────────────────────────────────────────────────┐  │   │
│  │  │                     Service Layer                                  │  │   │
│  │  │  ┌──────────────────┐  ┌──────────────────┐  ┌─────────────────┐  │  │   │
│  │  │  │ WhisperServer    │  │ ChatterboxServer │  │ OpenCodeServer  │  │  │   │
│  │  │  │   Manager        │  │    Manager       │  │    Manager      │  │  │   │
│  │  │  │                  │  │                  │  │                 │  │  │   │
│  │  │  │ spawn(python3)   │  │ spawn(python3)   │  │ spawn(opencode) │  │  │   │
│  │  │  │ healthCheck()    │  │ healthCheck()    │  │ proxy requests  │  │  │   │
│  │  │  │ transcribe()     │  │ synthesize()     │  │                 │  │  │   │
│  │  │  └────────┬─────────┘  └────────┬─────────┘  └────────┬────────┘  │  │   │
│  │  └───────────┼─────────────────────┼─────────────────────┼───────────┘  │   │
│  └──────────────┼─────────────────────┼─────────────────────┼───────────────┘   │
│                 │                     │                     │                    │
│                 ▼                     ▼                     ▼                    │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────────────┐   │
│  │  Whisper Server  │  │ Chatterbox Server│  │      OpenCode Server         │   │
│  │  (FastAPI/Python)│  │ (FastAPI/Python) │  │     (Go binary via npx)      │   │
│  │                  │  │                  │  │                              │   │
│  │  Port 5552       │  │  Port 5553       │  │  Port 5551                   │   │
│  │                  │  │                  │  │                              │   │
│  │  faster-whisper  │  │  chatterbox-tts  │  │  ┌────────────────────────┐ │   │
│  │  (ctranslate2)   │  │  (PyTorch)       │  │  │ Anthropic/OpenAI/etc   │ │   │
│  │                  │  │                  │  │  │ via LLM provider APIs  │ │   │
│  │  Models:         │  │  Voice cloning   │  │  └────────────────────────┘ │   │
│  │  - tiny (75MB)   │  │  Custom voices   │  │                              │   │
│  │  - base (145MB)  │  │  from audio      │  │  Tools: bash, read, write,   │   │
│  │  - small (488MB) │  │  samples         │  │  glob, grep, etc.            │   │
│  │  - medium (1.5GB)│  │                  │  │                              │   │
│  │  - large-v3 (3GB)│  │                  │  │                              │   │
│  └──────────────────┘  └──────────────────┘  └──────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────────┘
```

## Data Flow: Voice-to-Response

```
┌─────────────┐     ┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│ Microphone  │────▶│ MediaRecord │────▶│  STT API     │────▶│  OpenCode    │
│  Input      │     │ webm/opus   │     │  Whisper     │     │  Session     │
│             │     │  2.5s chunk │     │  transcribe  │     │  message     │
└─────────────┘     └─────────────┘     └──────────────┘     └──────┬───────┘
                                                                     │
     ┌───────────────────────────────────────────────────────────────┘
     │
     ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  OpenCode    │────▶│  LLM API     │────▶│  Tool Exec   │────▶│  Response    │
│  Process     │     │  Claude/GPT  │     │  (if needed) │     │  Text        │
│  Request     │     │              │     │              │     │              │
└──────────────┘     └──────────────┘     └──────────────┘     └──────┬───────┘
                                                                      │
     ┌────────────────────────────────────────────────────────────────┘
     │
     ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  TTS API     │────▶│  Chatterbox  │────▶│  Audio       │
│  synthesize  │     │  generate    │     │  Playback    │
│              │     │  WAV output  │     │  <audio>     │
└──────────────┘     └──────────────┘     └──────────────┘
```

## Component Details

### 1. Streaming VAD (Voice Activity Detection)

**File**: `frontend/src/hooks/useStreamingVAD.ts`

Replaced ONNX-based VAD (@ricky0123/vad-react) with streaming chunked approach due to model loading issues in browser.

```typescript
interface UseStreamingVADOptions {
  chunkIntervalMs?: number    // Default: 2500ms - batch audio for STT
  silenceTimeoutMs?: number   // Default: 1500ms - detect end of speech
  onTranscriptUpdate?: (transcript: string, isFinal: boolean) => void
  onSpeechEnd?: (fullTranscript: string) => void
}
```

**Algorithm**:
1. `MediaRecorder` captures audio in 100ms chunks (webm/opus codec)
2. Every 2500ms, accumulated chunks sent to Whisper STT
3. STT returns transcribed text, appended to running transcript
4. If no new words for 1500ms → speech ended → send to OpenCode
5. Reset transcript, continue listening

**Why not client-side VAD?**
- ONNX models failed to load in browser (CORS, WASM issues)
- Silero VAD .onnx file incompatible with onnxruntime-web
- Server-side VAD via Whisper's built-in `vad_filter=True` more reliable

### 2. Whisper STT Server

**Files**: 
- `scripts/whisper-server.py` - FastAPI server
- `backend/src/services/whisper.ts` - TypeScript manager

```
┌─────────────────────────────────────────────────────────────┐
│                 Whisper Server (Port 5552)                  │
├─────────────────────────────────────────────────────────────┤
│  POST /transcribe-base64                                    │
│  {                                                          │
│    "audio": "<base64>",                                     │
│    "model": "base",        // tiny|base|small|medium|large  │
│    "language": "en",       // optional, auto-detect         │
│    "format": "webm"        // webm|wav|mp3|ogg              │
│  }                                                          │
│                                                             │
│  Response:                                                  │
│  {                                                          │
│    "text": "transcribed text",                              │
│    "language": "en",                                        │
│    "language_probability": 0.98,                            │
│    "duration": 2.5                                          │
│  }                                                          │
├─────────────────────────────────────────────────────────────┤
│  GET /health                                                │
│  GET /models                                                │
└─────────────────────────────────────────────────────────────┘
```

**faster-whisper Configuration**:
```python
model = WhisperModel(
    model_name,
    device="cuda" if torch.cuda.is_available() else "cpu",
    compute_type="float16" if device == "cuda" else "int8",
    download_root=MODELS_DIR
)

segments, info = model.transcribe(
    audio_path,
    language=language,
    task="transcribe",
    vad_filter=True,          # Built-in VAD preprocessing
    vad_parameters=dict(
        min_silence_duration_ms=500,
        speech_pad_ms=400
    )
)
```

### 3. Chatterbox TTS Server

**Files**:
- `scripts/chatterbox-server.py` - FastAPI server
- `backend/src/services/chatterbox.ts` - TypeScript manager

```
┌─────────────────────────────────────────────────────────────┐
│               Chatterbox Server (Port 5553)                 │
├─────────────────────────────────────────────────────────────┤
│  POST /synthesize                                           │
│  {                                                          │
│    "text": "Hello world",                                   │
│    "voice": "default",     // or custom voice ID            │
│    "exaggeration": 0.5,    // 0.0-1.0 expressiveness        │
│    "cfg_weight": 0.5       // classifier-free guidance      │
│  }                                                          │
│                                                             │
│  Response: audio/wav binary stream                          │
├─────────────────────────────────────────────────────────────┤
│  POST /voices/upload       // Upload custom voice sample    │
│  GET  /voices              // List available voices         │
│  DELETE /voices/{id}       // Remove custom voice           │
├─────────────────────────────────────────────────────────────┤
│  POST /v1/audio/speech     // OpenAI-compatible endpoint    │
└─────────────────────────────────────────────────────────────┘
```

**Voice Cloning**:
```python
# Default voice (no reference)
wav = model.generate(text, exaggeration=0.5, cfg_weight=0.5)

# Custom voice (with reference audio)
wav = model.generate(
    text,
    audio_prompt_path="/path/to/voice_sample.wav",  # 5-10s sample
    exaggeration=0.5,
    cfg_weight=0.5
)
```

### 4. TalkMode State Machine

**File**: `frontend/src/contexts/TalkModeContext.tsx`

```
                    ┌─────────┐
                    │   OFF   │
                    └────┬────┘
                         │ start()
                         ▼
                 ┌───────────────┐
                 │ INITIALIZING  │
                 └───────┬───────┘
                         │ streamingVAD.start()
                         ▼
    ┌────────────────────────────────────────────┐
    │                                            │
    │              ┌───────────┐                 │
    │    ┌────────▶│ LISTENING │◀───────┐       │
    │    │         └─────┬─────┘        │       │
    │    │               │              │       │
    │    │   silence     │ transcript   │       │
    │    │   timeout     │              │       │
    │    │               ▼              │       │
    │    │        ┌───────────┐         │       │
    │    │        │ THINKING  │         │       │
    │    │        └─────┬─────┘         │       │
    │    │              │               │       │
    │    │              │ response      │       │
    │    │              ▼               │       │
    │    │        ┌───────────┐         │       │
    │    └────────│ SPEAKING  │─────────┘       │
    │             └───────────┘                 │
    │               TTS done                    │
    │                                           │
    └───────────────────────────────────────────┘
                         │ stop()
                         ▼
                    ┌─────────┐
                    │   OFF   │
                    └─────────┘
```

### 5. Docker Container Layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Docker Container                                      │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │  /opt/whisper-venv/     Python venv for Whisper                        │ │
│  │    - faster-whisper                                                     │ │
│  │    - fastapi, uvicorn                                                   │ │
│  ├────────────────────────────────────────────────────────────────────────┤ │
│  │  /opt/chatterbox-venv/  Python venv for Chatterbox                     │ │
│  │    - torch, torchaudio (CPU)                                           │ │
│  │    - chatterbox-tts                                                     │ │
│  │    - fastapi, uvicorn                                                   │ │
│  ├────────────────────────────────────────────────────────────────────────┤ │
│  │  /app/                                                                  │ │
│  │    ├── backend/src/     Bun + Hono backend                             │ │
│  │    ├── frontend/dist/   Vite built React app                           │ │
│  │    ├── scripts/                                                        │ │
│  │    │     ├── whisper-server.py                                         │ │
│  │    │     └── chatterbox-server.py                                      │ │
│  │    └── data/            SQLite DB, cache                               │ │
│  ├────────────────────────────────────────────────────────────────────────┤ │
│  │  /workspace/            Mounted repo directory                         │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  Ports:                                                                      │
│    5003  - Backend API + Frontend                                           │
│    5551  - OpenCode server (internal)                                       │
│    5552  - Whisper STT (internal)                                           │
│    5553  - Chatterbox TTS (internal)                                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 6. Process Startup Sequence

```
docker-entrypoint.sh
        │
        ├──▶ Start Whisper server (background)
        │         │
        │         └──▶ Load model (base by default)
        │               ~30s first time (download)
        │               ~5s cached
        │
        ├──▶ Start Chatterbox server (background)
        │         │
        │         └──▶ Load model
        │               ~60s first time (download ~1GB)
        │               ~10s cached
        │
        └──▶ Start main backend (bun backend/src/index.ts)
                  │
                  ├──▶ Initialize SQLite DB
                  ├──▶ Start OpenCode server (managed subprocess)
                  ├──▶ Wait for Whisper health
                  ├──▶ Wait for Chatterbox health
                  └──▶ Serve API + static frontend
```

## API Endpoints

### STT Routes (`/api/stt/*`)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/stt/transcribe` | POST | Transcribe base64 audio |
| `/api/stt/models` | GET | List available Whisper models |
| `/api/stt/status` | GET | Server status + config |

### TTS Routes (`/api/tts/*`)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/tts/synthesize` | POST | Generate speech from text |
| `/api/tts/voices` | GET | List available voices |
| `/api/tts/voices/upload` | POST | Upload custom voice sample |
| `/api/tts/voices/{id}` | DELETE | Remove custom voice |
| `/api/tts/status` | GET | Server status |

### OpenCode Routes (`/api/opencode/*`)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/opencode/session` | POST | Create new session |
| `/api/opencode/session/{id}` | GET | Get session info |
| `/api/opencode/session/{id}/message` | POST | Send message |
| `/api/opencode/session/{id}/message` | GET | Get all messages |
| `/api/opencode/providers` | GET | List LLM providers |

## Configuration

### Settings Schema

```typescript
interface TalkModeSettings {
  enabled: boolean
  silenceThresholdMs: number  // Time to wait after last word (default: 1500)
  minSpeechMs: number         // Minimum speech duration (default: 400)
  autoInterrupt: boolean      // Interrupt TTS on new speech
}

interface STTSettings {
  enabled: boolean
  model: string               // tiny|base|small|medium|large-v3
  language: string            // 'auto' or ISO code (en, de, etc.)
  autoSubmit: boolean         // Auto-send on silence
}

interface TTSSettings {
  enabled: boolean
  provider: string            // 'chatterbox' | 'openai' | 'browser'
  voice: string               // Voice ID
  speed: number               // Playback speed multiplier
}
```

### Environment Variables

```bash
# Whisper STT
WHISPER_PORT=5552
WHISPER_HOST=127.0.0.1
WHISPER_DEFAULT_MODEL=base
WHISPER_DEVICE=auto           # auto|cpu|cuda
WHISPER_COMPUTE_TYPE=auto     # auto|float16|int8
WHISPER_VENV=/opt/whisper-venv

# Chatterbox TTS
CHATTERBOX_PORT=5553
CHATTERBOX_HOST=127.0.0.1
CHATTERBOX_DEVICE=auto        # auto|cpu|cuda|mps
CHATTERBOX_VENV=/opt/chatterbox-venv

# OpenCode
OPENCODE_SERVER_PORT=5551
ANTHROPIC_API_KEY=sk-...
OPENAI_API_KEY=sk-...

# Backend
PORT=5003
DATABASE_PATH=/app/data/opencode.db
WORKSPACE_PATH=/workspace
```

## Performance Characteristics

| Component | Latency | Memory | Notes |
|-----------|---------|--------|-------|
| MediaRecorder → STT | 2.5s (batch) | - | Configurable via `chunkIntervalMs` |
| Whisper (base) | ~0.5-1s/chunk | ~1GB | GPU: ~0.1s |
| OpenCode response | 2-30s | - | Depends on LLM + tools |
| Chatterbox TTS | ~2-5s/sentence | ~2GB | GPU: ~0.5s |
| Total round-trip | ~5-40s | ~3-4GB | CPU-only container |

## Testing

### E2E Test: Real Audio Injection

```bash
# Uses Chrome's fake audio capture
bun run scripts/test-talkmode-real-audio.ts \
  --url https://your-deployment.com \
  --user admin \
  --pass secret
```

**Test Flow**:
1. Generate audio using macOS `say` command
2. Convert to WAV with ffmpeg (48kHz, mono, s16)
3. Launch Puppeteer with `--use-file-for-fake-audio-capture`
4. Audio injected to MediaRecorder as if from microphone
5. Verify STT transcription matches input
6. Verify OpenCode response is correct

### Test API (Browser)

Exposed on `window.__TALK_MODE_TEST__`:

```typescript
{
  injectTranscript(text: string): boolean  // Bypass audio capture
  getState(): {
    state: TalkModeState
    isActive: boolean
    sessionID: string | null
    userTranscript: string | null
    agentResponse: string | null
    liveTranscript: string
  }
  forceListening(): boolean
}
```

## Known Limitations

1. **Safari**: MediaRecorder codec support varies. May need to detect and use different MIME type.

2. **Latency**: 2.5s chunking adds inherent delay. Trade-off between latency and transcription accuracy.

3. **VAD False Positives**: Background noise can trigger transcription. Whisper's `vad_filter` helps but not perfect.

4. **Memory**: Running both Whisper and Chatterbox requires ~4GB RAM. GPU recommended for production.

5. **Concurrent Users**: Single Python process per service. Not horizontally scalable without additional infrastructure.
