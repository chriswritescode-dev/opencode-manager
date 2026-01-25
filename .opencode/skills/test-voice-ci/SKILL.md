---
name: test-voice-ci
description: Test voice/Talk Mode in CI environments without audio hardware. Use when setting up CI pipelines, debugging voice tests, or testing STT/TTS functionality.
metadata:
  author: opencode-manager
  version: "1.0"
compatibility: Requires Chrome/Chromium, ffmpeg, and either macOS say command or Linux espeak
---

Test voice/Talk Mode in CI environments without audio hardware.

## The Problem

CI runners don't have physical microphones, audio devices, or ALSA loopback (`snd-aloop`).

Voice testing needs to simulate:
```
Microphone -> getUserMedia() -> MediaRecorder -> STT API -> Whisper -> Transcription
```

## Solution: Chrome Fake Audio Capture

Chrome can inject a WAV file as microphone input:

```typescript
browser = await puppeteer.launch({
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${wavPath}`,
  ]
})
```

## Audio Requirements

WAV file must be 16kHz mono PCM.

### macOS

```bash
say -o test.aiff "What is two plus two"
ffmpeg -y -i test.aiff -ar 16000 -ac 1 test.wav
```

### Linux CI

```bash
espeak "What is two plus two" --stdout | ffmpeg -y -i - -ar 16000 -ac 1 test.wav

pico2wave -w test.wav "What is two plus two"
ffmpeg -y -i test.wav -ar 16000 -ac 1 test_16k.wav
```

## Test Scripts

| Script | Purpose |
|--------|---------|
| `scripts/test-voice.ts` | API-level tests (STT/TTS endpoints) |
| `scripts/test-browser.ts` | Full browser E2E with fake audio |

### API Tests

```bash
bun run scripts/test-voice.ts
bun run scripts/test-voice.ts --url https://your-url.com --user admin --pass secret
bun run scripts/test-voice.ts --skip-talkmode
```

### Browser E2E

```bash
bun run scripts/test-browser.ts --url http://localhost:5001
bun run scripts/test-browser.ts --url http://localhost:5001 --no-headless
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

1. Audio Capture - MediaRecorder from getUserMedia
2. Format Handling - Audio encoding (webm/opus)
3. STT Integration - Backend to Whisper
4. Whisper Transcription - Model loading and accuracy
5. End-to-End Flow - Full Talk Mode pipeline

## What This Does NOT Test

- Real microphone hardware
- Browser permissions UI
- VAD with ambient noise
- Real network latency

## Debugging

### Check Whisper Server

```bash
curl http://localhost:5552/health
curl http://localhost:5001/api/stt/status
```

### Test STT Directly

```bash
say -o test.aiff "hello world"
ffmpeg -y -i test.aiff -ar 16000 -ac 1 test.wav

curl -X POST http://localhost:5001/api/stt/transcribe \
  -H "Content-Type: application/json" \
  -d "{\"audio\": \"$(base64 -i test.wav)\", \"format\": \"wav\"}"
```

### Check Audio Chunks

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
|  test.wav -----> Chrome (fake audio capture)     |
|                       |                          |
|              getUserMedia() -> MediaRecorder     |
|                       |                          |
|              POST /api/stt/transcribe            |
|                       |                          |
|              Whisper Server (Python)             |
|                       |                          |
|              { "text": "What is 2 plus 2" }      |
+--------------------------------------------------+
```

## Alternatives Considered (Rejected)

| Approach | Reason |
|----------|--------|
| snd-aloop kernel module | Not on GitHub Actions |
| PulseAudio virtual sink | Complex, flaky |
| Mock at JavaScript | Bypasses real pipeline |

## Fallback: injectTranscript

For testing OpenCode integration without audio:

```typescript
await page.evaluate(() => {
  window.dispatchEvent(new CustomEvent('injectTranscript', { 
    detail: { text: 'What is 2 plus 2' } 
  }))
})
```
