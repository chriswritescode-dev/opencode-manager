# Voice Testing in CI Skill

Guide for testing voice/Talk Mode in CI environments without audio hardware.

## The Problem

CI runners don't have:
- Physical microphones
- Audio output devices
- ALSA loopback kernel module (`snd-aloop`)

Voice testing needs to simulate:
```
Microphone -> getUserMedia() -> MediaRecorder -> STT API -> Whisper -> Transcription
```

## Solution: Chrome Fake Audio Capture

Chrome/Chromium can inject a WAV file as microphone input:

```typescript
browser = await puppeteer.launch({
  args: [
    '--use-fake-ui-for-media-stream',      // Auto-accept media permissions
    '--use-fake-device-for-media-stream',  // Use fake devices
    `--use-file-for-fake-audio-capture=${wavPath}`,  // Inject audio file
  ]
})
```

When `navigator.mediaDevices.getUserMedia({ audio: true })` is called, Chrome provides audio from the WAV file.

## Audio Requirements

WAV file must be 16kHz mono PCM (Whisper's expected format).

### Generate on macOS

```bash
say -o test.aiff "What is two plus two"
ffmpeg -y -i test.aiff -ar 16000 -ac 1 test.wav
```

### Generate on Linux CI

```bash
# Using espeak
espeak "What is two plus two" --stdout | ffmpeg -y -i - -ar 16000 -ac 1 test.wav

# Using pico2wave (better quality)
pico2wave -w test.wav "What is two plus two"
ffmpeg -y -i test.wav -ar 16000 -ac 1 test_16k.wav
```

## Test Scripts

| Script | Purpose |
|--------|---------|
| `scripts/test-voice.ts` | API-level tests (STT/TTS endpoints, talk mode flow) |
| `scripts/test-browser.ts` | Full browser E2E with fake audio capture |

### Run API Tests

```bash
# Local
bun run scripts/test-voice.ts

# Remote with auth
bun run scripts/test-voice.ts --url https://your-url.com --user admin --pass secret

# Skip slow talk mode test
bun run scripts/test-voice.ts --skip-talkmode
```

### Run Browser E2E

```bash
# Headless
bun run scripts/test-browser.ts --url http://localhost:5001

# Visible browser for debugging
bun run scripts/test-browser.ts --url http://localhost:5001 --no-headless

# Use Web Audio API injection (alternative)
bun run scripts/test-browser.ts --web-audio
```

## GitHub Actions Workflow

```yaml
voice-e2e:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    
    - name: Setup Python
      uses: actions/setup-python@v5
      with:
        python-version: '3.11'
    
    - name: Install audio tools
      run: |
        sudo apt-get update
        sudo apt-get install -y ffmpeg espeak
    
    - name: Generate test audio
      run: |
        espeak "Hello this is a test" --stdout | \
          ffmpeg -y -i - -ar 16000 -ac 1 test/fixtures/test-audio.wav
    
    - name: Run voice E2E tests
      run: |
        pnpm dev &
        sleep 10
        bun run scripts/test-browser.ts
```

## What This Tests

1. **Audio Capture**: MediaRecorder captures audio from getUserMedia
2. **Format Handling**: Audio encoding (webm/opus)
3. **STT Integration**: Backend forwards audio to Whisper
4. **Whisper Transcription**: Model loads and transcribes
5. **End-to-End Flow**: Full Talk Mode pipeline

## What This Does NOT Test

- Real microphone hardware
- Browser permissions UI
- VAD with live ambient noise
- Real network latency

## Debugging

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

### Verify Audio Chunks in Browser

Add logging to TalkModeContext:

```typescript
mediaRecorder.ondataavailable = (event) => {
  console.log('[TalkMode] Audio chunk size:', event.data.size)
}
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

## Alternatives Considered (Rejected)

| Approach | Reason Rejected |
|----------|-----------------|
| snd-aloop kernel module | Not available on GitHub Actions |
| PulseAudio virtual sink | Complex setup, flaky in CI |
| Mock at JavaScript level | Bypasses real audio pipeline |

## Fallback: injectTranscript API

For testing OpenCode integration without audio pipeline:

```typescript
// Skip audio, inject transcription directly
await page.evaluate(() => {
  window.dispatchEvent(new CustomEvent('injectTranscript', { 
    detail: { text: 'What is 2 plus 2' } 
  }))
})
```

Tests OpenCode integration but skips audio capture/STT.
