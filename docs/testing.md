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
