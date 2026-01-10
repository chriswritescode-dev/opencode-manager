# Voice Testing Environment

This document describes how voice/Talk Mode E2E tests work in CI environments that lack physical audio hardware.

## The Problem

CI runners (GitHub Actions, etc.) don't have:
- Physical microphones
- Audio output devices
- The `snd-aloop` kernel module (Linux ALSA loopback device)

Voice testing requires simulating audio input to test the full pipeline:
```
Microphone -> getUserMedia() -> MediaRecorder -> STT API -> Whisper -> Transcription
```

## Solution: Chrome Fake Audio Capture

Chromium/Chrome supports injecting a WAV file as the microphone input:

```typescript
browser = await puppeteer.launch({
  args: [
    '--use-fake-ui-for-media-stream',      // Auto-accept media permissions
    '--use-fake-device-for-media-stream',  // Use fake devices instead of real
    `--use-file-for-fake-audio-capture=${wavPath}`,  // Inject audio file as mic
  ]
})
```

When the web app calls `navigator.mediaDevices.getUserMedia({ audio: true })`, Chrome provides audio from the WAV file instead of a real microphone.

### Requirements

- WAV file must be 16kHz mono PCM (Whisper's expected format)
- On macOS: `say` command generates speech, `ffmpeg` converts to WAV
- On Linux CI: Pre-generate WAV files or use `espeak` + `ffmpeg`

### Audio Generation

```bash
# macOS (development)
say -o test.aiff "What is two plus two"
ffmpeg -y -i test.aiff -ar 16000 -ac 1 test.wav

# Linux CI (using espeak)
espeak "What is two plus two" --stdout | ffmpeg -y -i - -ar 16000 -ac 1 test.wav

# Or use pre-generated test audio files checked into the repo
```

## Test Architecture

```
                    CI Environment
+--------------------------------------------------+
|                                                  |
|  test.wav -----> Chrome (fake audio capture)     |
|                       |                          |
|                       v                          |
|              getUserMedia() -> MediaRecorder     |
|                       |                          |
|                       v                          |
|              POST /api/stt/transcribe            |
|                       |                          |
|                       v                          |
|              Whisper Server (Python)             |
|                       |                          |
|                       v                          |
|              { "text": "What is 2 plus 2" }      |
|                                                  |
+--------------------------------------------------+
```

## What This Tests

1. **Audio Capture**: MediaRecorder correctly captures audio from getUserMedia
2. **Format Handling**: Audio is properly encoded (webm/opus or chunks)
3. **STT Integration**: Backend correctly forwards audio to Whisper
4. **Whisper Transcription**: Model loads and transcribes accurately
5. **End-to-End Flow**: Full Talk Mode pipeline works

## What This Does NOT Test

- Real microphone hardware integration
- Browser microphone permissions UI
- VAD accuracy with live ambient noise
- Network latency in real conditions

## Alternatives Considered

### 1. snd-aloop Kernel Module
**Rejected**: Not available on GitHub Actions runners. Would require custom Docker images with privileged mode.

### 2. PulseAudio Virtual Sink
**Rejected**: Requires PulseAudio daemon running, complex setup, flaky in CI.

### 3. Mock at JavaScript Level
**Rejected**: Bypasses the actual audio pipeline - doesn't test real functionality.

### 4. injectTranscript() Test API
**Used as Fallback**: Tests the OpenCode integration but skips audio pipeline.

## CI Workflow Configuration

```yaml
voice-e2e:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    
    # Install Whisper dependencies
    - name: Setup Python
      uses: actions/setup-python@v5
      with:
        python-version: '3.11'
    
    - name: Install audio tools
      run: |
        sudo apt-get update
        sudo apt-get install -y ffmpeg espeak
    
    # Generate test audio (or use pre-generated)
    - name: Generate test audio
      run: |
        espeak "Hello this is a test" --stdout | \
          ffmpeg -y -i - -ar 16000 -ac 1 test/fixtures/test-audio.wav
    
    # Start services and run tests
    - name: Run voice E2E tests
      run: |
        pnpm dev &
        sleep 10
        bun run scripts/test-talkmode-browser.ts
```

## Test Scripts

| Script | Purpose |
|--------|---------|
| `scripts/test-voice-e2e.ts` | API-level voice tests (STT/TTS endpoints) |
| `scripts/test-talkmode-browser.ts` | Full browser E2E with fake audio capture |
| `scripts/test-talkmode-e2e.ts` | Talk Mode flow without browser |

## Debugging Tips

### Test Locally with Visible Browser
```bash
bun run scripts/test-talkmode-browser.ts --no-headless
```

### Check Whisper Server
```bash
curl http://localhost:5552/health
curl http://localhost:5001/api/stt/status
```

### Test STT Directly
```bash
# Generate audio
say -o test.aiff "hello world"
ffmpeg -y -i test.aiff -ar 16000 -ac 1 test.wav

# Send to API
curl -X POST http://localhost:5001/api/stt/transcribe \
  -H "Content-Type: application/json" \
  -d "{\"audio\": \"$(base64 -i test.wav)\", \"format\": \"wav\"}"
```

### Check Chrome Received Audio
Add logging in TalkModeContext to see if MediaRecorder is producing chunks:
```typescript
mediaRecorder.ondataavailable = (event) => {
  console.log('[TalkMode] Audio chunk size:', event.data.size)
}
```
