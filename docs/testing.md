# Testing Guide

## Client Mode Auto-Registration Test

This test verifies that when using `pnpm start:client` to connect to an existing opencode server, the connected server's working directory is automatically registered as a repo and visible in the WebUI.

### Pre-Conditions
- Reset database to fresh state
- No existing processes on managed ports

### Important Notes
- **DO NOT kill Google Chrome** - The cleanup script may detect Chrome Helper processes on managed ports. These are from Chrome DevTools connections and should not be terminated. The user may be actively using Chrome for other work.

### Test Steps

#### Step 1: Clean State Setup
```bash
# Kill any existing processes
bun scripts/cleanup.ts --all

# Backup and remove existing database
mv workspace/opencode-manager.db workspace/opencode-manager.db.bak 2>/dev/null || true
```

#### Step 2: Start OpenCode Server
```bash
cd /Users/engineer/workspace/opencode-manager
opencode serve --port 5551 --hostname 127.0.0.1 &
# Wait for startup, verify with:
curl -s http://127.0.0.1:5551/session | jq '.[0].directory'
```

#### Step 3: Start Client Mode with Tunnel
```bash
# Use echo to auto-select the server on port 5551
echo "N" | pnpm start:client
# Wait ~20 seconds for full startup including tunnel
```

#### Step 4: API Verification
```bash
# Verify repo is auto-registered
curl -s http://localhost:5001/api/repos | jq .
# Expected: Array with one repo where fullPath = "/Users/engineer/workspace/opencode-manager"
```

#### Step 5: Browser Verification (Chrome DevTools)
1. Navigate to frontend: `http://localhost:5173`
2. Take snapshot to see page structure
3. Verify workspace visible in the UI
4. Click to open workspace
5. Take screenshot for visual confirmation

#### Step 6: Tunnel Verification (Chrome DevTools)
1. Get tunnel URL from the startup output (e.g., `https://xxx.trycloudflare.com`)
2. Navigate to tunnel URL
3. Take snapshot and verify same workspace is visible
4. Take screenshot for visual confirmation

#### Step 7: Cleanup
```bash
bun scripts/cleanup.ts --all
# Restore original database
mv workspace/opencode-manager.db.bak workspace/opencode-manager.db 2>/dev/null || true
```

### Success Criteria
1. Fresh database starts empty
2. OpenCode server reports correct directory in `/session`
3. Backend logs show auto-registration of directory
4. `/api/repos` returns the workspace with correct `fullPath`
5. Frontend (localhost:5173) shows the workspace in UI
6. Tunnel URL shows the same workspace
7. Can click/open the workspace in the UI

---

## Voice Mode End-to-End Test

This test verifies the complete voice-to-code pipeline: audio capture → STT transcription → OpenCode processing → file creation.

### Pre-Conditions
- Backend running on port 5001
- Whisper STT server running on port 5552
- OpenCode server running on port 5551
- macOS with `say` command and `ffmpeg` installed

### Test Steps

#### Step 1: Verify Services
```bash
# Check backend health
curl -s http://localhost:5001/api/health | jq '.status'
# Expected: "healthy"

# Check STT server
curl -s http://localhost:5001/api/stt/status | jq '.server.running'
# Expected: true
```

#### Step 2: Generate Test Audio
```bash
# Generate speech audio (use -v Samantha for reliable output on macOS)
say -v Samantha "Write a simple hello world Python application" -o /tmp/voice_cmd.aiff

# Verify audio duration (should be ~2-3 seconds)
afinfo /tmp/voice_cmd.aiff 2>&1 | grep duration
# Expected: estimated duration: 2.7 sec (approximately)

# Convert to 16kHz mono WAV for Whisper
ffmpeg -y -i /tmp/voice_cmd.aiff -ar 16000 -ac 1 -f wav /tmp/voice_cmd.wav
```

**Note:** The default macOS voice may generate empty audio files. Always use `-v Samantha` or another explicit voice for reliable results.

#### Step 3: Test STT Transcription
```bash
AUDIO=$(base64 -i /tmp/voice_cmd.wav)
curl -s -X POST http://localhost:5001/api/stt/transcribe \
  -H "Content-Type: application/json" \
  -d "{\"audio\": \"$AUDIO\", \"format\": \"wav\"}"
```

Expected response:
```json
{
  "text": "Write a simple Hello World Python application.",
  "language": "en",
  "language_probability": 0.99,
  "duration": 2.7
}
```

#### Step 4: Clean Workspace
```bash
cd /Users/engineer/workspace/opencode-manager
rm -f workspace/hello.py workspace/hello_world.py
```

#### Step 5: Create Session and Send Voice Command
```bash
# Create session with workspace directory
SESSION_ID=$(curl -s -X POST \
  "http://localhost:5001/api/opencode/session?directory=/Users/engineer/workspace/opencode-manager/workspace" \
  -H "Content-Type: application/json" \
  -d '{"title":"Voice Hello World Test"}' | jq -r '.id')

echo "Session: $SESSION_ID"

# Send the transcribed voice command
curl -s -X POST \
  "http://localhost:5001/api/opencode/session/$SESSION_ID/message?directory=/Users/engineer/workspace/opencode-manager/workspace" \
  -H "Content-Type: application/json" \
  -d '{"parts":[{"type":"text","text":"Write a simple Hello World Python application. Create the file."}]}'
```

#### Step 6: Verify File Creation
```bash
# Wait for OpenCode to process
sleep 5

# Check file exists
ls -la workspace/hello.py

# Verify content
cat workspace/hello.py
# Expected: print("Hello, World!")

# Run the script
python3 workspace/hello.py
# Expected output: Hello, World!
```

### Success Criteria
1. STT server is running and healthy
2. Audio generates with proper duration (~2-3 seconds)
3. Whisper transcribes accurately: "Write a simple Hello World Python application"
4. OpenCode session receives the message
5. `hello.py` file is created in workspace
6. File contains `print("Hello, World!")`
7. Script executes and outputs "Hello, World!"

### Voice Pipeline Architecture
```
User speaks (or macOS say command)
    ↓
Audio file (AIFF → WAV 16kHz mono)
    ↓
/api/stt/transcribe → Whisper (self-hosted, port 5552)
    ↓
Transcript text
    ↓
/api/opencode/session/{id}/message
    ↓
OpenCode (uses configured provider - OpenAI, Anthropic, etc.)
    ↓
File created via Write tool
    ↓
Response returned to user
```

### Troubleshooting

#### Empty Audio Files
If `say` generates 0-duration audio:
```bash
# Check available voices
say -v '?'

# Use explicit voice
say -v Samantha "Your text" -o output.aiff
```

#### STT Returns Empty Text
- Check Whisper server logs: `curl http://localhost:5552/status`
- Verify WAV format: `file /tmp/voice_cmd.wav` (should be 16-bit PCM, 16kHz, mono)
- Check audio duration: `afinfo /tmp/voice_cmd.wav`

#### OpenCode Doesn't Create File
- Verify provider is configured: `curl http://localhost:5001/api/opencode/config | jq '.provider'`
- Check session status: `curl http://localhost:5001/api/opencode/session/status`
- Ensure prompt explicitly asks to "create the file"
