# Building "Vibe Coding" Cloud: Self-Hosting OpenCode Manager with Voice, Terminal, and Secure Cloudflare Tunnels

![Vibe Coding Header](https://images.unsplash.com/photo-1555099962-4199c345e5dd?q=80&w=2940&auto=format&fit=crop)

"Vibe Coding" isn't just about AI code generation—it's about an environment where you can talk to your code, execute it instantly, and manage your infrastructure from anywhere. It's the shift from "typing syntax" to "commanding intent."

We built the ultimate self-hosted vibe coding stack using **OpenCode Manager**. This isn't just a wrapper; it's a full-stack enhancement that turns the powerful [OpenCode](https://opencode.ai) CLI into a web-native, voice-controlled, multi-LLM development platform.

Here is the deep dive into how we engineered a solution that lets you vibe code from an iPad on a walk or a laptop in a cafe, powered by a secure cloud VM.

---

## The Core: What Makes This Special?

Most AI coding assistants are just chat interfaces or IDE plugins. Our solution is different because it focuses on **infrastructure, control, and interaction**:

1.  **OpenCode Manager (The Enhanced Core):** We didn't just host OpenCode; we wrapped it in a robust Node.js backend that adds:
    *   **Universal LLM Support:** Bring your own key. Whether it's OpenAI, Anthropic, Gemini, or a local model, our `AuthService` manages secure credential storage (`auth.json` with strict permissions), letting you swap brains on the fly.
    *   **Full Web Terminal:** Not a simulated console. We integrated `node-pty` to spawn real shell sessions on the server, piped directly to your browser via WebSockets. You can run `docker build`, `git push`, or `cargo run` from your phone.
    *   **Voice-First Interface:** Integrated Text-to-Speech (TTS) and Voice-to-Text so you can literally talk to your agent while walking.

2.  **Cloudflare Tunneling (The Secure Gateway):**
    *   Zero open ports. No VPNs. No public IPs exposed.
    *   We use Cloudflare Zero Trust to tunnel traffic from our private Docker container directly to a public HTTPS domain. This gives us enterprise-grade security and global caching for free.

3.  **Dockerized Consistency:**
    *   The entire stack (Frontend, Backend, Database) is packaged into a single multi-stage Docker image. This ensures that the complex dependency chain (Node.js, Python, system libraries for PTY) works perfectly on any VM.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLOUD VM (Azure/AWS)                           │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                         Docker Environment                            │  │
│  │                                                                       │  │
│  │  ┌─────────────────────────────────────────────────────────────────┐  │  │
│  │  │                    OpenCode Manager Container                   │  │  │
│  │  │                                                                 │  │  │
│  │  │  ┌─────────────────┐      ┌─────────────────────────────────┐  │  │  │
│  │  │  │    Frontend     │      │           Backend               │  │  │  │
│  │  │  │   (React/Vite)  │      │         (Bun/Hono)              │  │  │  │
│  │  │  │                 │      │                                 │  │  │  │
│  │  │  │  ┌───────────┐  │      │  ┌───────────┐  ┌───────────┐  │  │  │  │
│  │  │  │  │  Chat UI  │  │ HTTP │  │  Routes   │  │ Services  │  │  │  │  │
│  │  │  │  ├───────────┤  │◄────►│  ├───────────┤  ├───────────┤  │  │  │  │
│  │  │  │  │ Terminal  │  │      │  │ /api/*    │  │ AuthSvc   │  │  │  │  │
│  │  │  │  ├───────────┤  │  WS  │  │ /ws/*     │  │ RepoSvc   │  │  │  │  │
│  │  │  │  │  Voice    │  │◄────►│  │           │  │ FileSvc   │  │  │  │  │
│  │  │  │  │ Controls  │  │      │  └───────────┘  └───────────┘  │  │  │  │
│  │  │  │  └───────────┘  │      │         │              │       │  │  │  │
│  │  │  └─────────────────┘      │         ▼              ▼       │  │  │  │
│  │  │                           │  ┌───────────┐  ┌───────────┐  │  │  │  │
│  │  │                           │  │  SQLite   │  │ auth.json │  │  │  │  │
│  │  │                           │  │    DB     │  │  (0o600)  │  │  │  │  │
│  │  │                           │  └───────────┘  └───────────┘  │  │  │  │
│  │  │                           │         │                      │  │  │  │
│  │  │                           │         ▼                      │  │  │  │
│  │  │                           │  ┌─────────────────────────┐   │  │  │  │
│  │  │                           │  │     OpenCode Server     │   │  │  │  │
│  │  │                           │  │      (Port 5551)        │   │  │  │  │
│  │  │                           │  │                         │   │  │  │  │
│  │  │                           │  │  ┌───────┐ ┌─────────┐  │   │  │  │  │
│  │  │                           │  │  │node-  │ │   LLM   │  │   │  │  │  │
│  │  │                           │  │  │pty    │ │  Proxy  │  │   │  │  │  │
│  │  │                           │  │  └───────┘ └─────────┘  │   │  │  │  │
│  │  │                           │  └─────────────────────────┘   │  │  │  │
│  │  │                           └─────────────────────────────────┘  │  │  │
│  │  └─────────────────────────────────────────────────────────────────┘  │  │
│  │                                    │                                  │  │
│  │                                    │ HTTP (internal)                  │  │
│  │                                    ▼                                  │  │
│  │  ┌─────────────────────────────────────────────────────────────────┐  │  │
│  │  │                  Cloudflare Tunnel Container                    │  │  │
│  │  │                      (cloudflared)                              │  │  │
│  │  └─────────────────────────────────────────────────────────────────┘  │  │
│  │                                    │                                  │  │
│  └────────────────────────────────────│──────────────────────────────────┘  │
│                                       │ Encrypted Tunnel                    │
└───────────────────────────────────────│─────────────────────────────────────┘
                                        │
                                        ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│                           Cloudflare Edge Network                             │
│  ┌─────────────────────────────────────────────────────────────────────────┐  │
│  │  Zero Trust Access ──► TLS Termination ──► Global CDN ──► DDoS Shield  │  │
│  └─────────────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        │ HTTPS (vibe.your-domain.com)
                                        ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│                                   Clients                                     │
│     ┌─────────┐        ┌─────────┐        ┌─────────┐        ┌─────────┐     │
│     │  iPad   │        │ Laptop  │        │ Desktop │        │ Mobile  │     │
│     │  Walk   │        │  Cafe   │        │  Home   │        │ Browser │     │
│     └─────────┘        └─────────┘        └─────────┘        └─────────┘     │
└───────────────────────────────────────────────────────────────────────────────┘
```

---

## Request Flow Diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         Voice Command Flow                                   │
└──────────────────────────────────────────────────────────────────────────────┘

  User                Browser              Backend            OpenCode         LLM API
   │                    │                    │                   │               │
   │  "Clone repo and   │                    │                   │               │
   │   run tests"       │                    │                   │               │
   │ ──────────────────►│                    │                   │               │
   │    (Voice Input)   │                    │                   │               │
   │                    │                    │                   │               │
   │                    │  Voice-to-Text     │                   │               │
   │                    │  (Web Speech API)  │                   │               │
   │                    │                    │                   │               │
   │                    │  POST /api/chat    │                   │               │
   │                    │───────────────────►│                   │               │
   │                    │                    │                   │               │
   │                    │                    │  Proxy Request    │               │
   │                    │                    │──────────────────►│               │
   │                    │                    │                   │               │
   │                    │                    │                   │  API Call     │
   │                    │                    │                   │──────────────►│
   │                    │                    │                   │               │
   │                    │                    │                   │◄──────────────│
   │                    │                    │                   │   Response    │
   │                    │                    │                   │               │
   │                    │                    │  Tool Execution   │               │
   │                    │                    │  (git clone, npm) │               │
   │                    │                    │◄──────────────────│               │
   │                    │                    │                   │               │
   │                    │  WebSocket Stream  │                   │               │
   │                    │◄───────────────────│                   │               │
   │                    │  (Terminal Output) │                   │               │
   │                    │                    │                   │               │
   │                    │  SSE: Chat Response│                   │               │
   │                    │◄───────────────────│                   │               │
   │                    │                    │                   │               │
   │                    │  Text-to-Speech    │                   │               │
   │  ◄─────────────────│  (Voice Output)    │                   │               │
   │   Spoken Response  │                    │                   │               │
   │                    │                    │                   │               │


┌──────────────────────────────────────────────────────────────────────────────┐
│                       Terminal Session Flow                                  │
└──────────────────────────────────────────────────────────────────────────────┘

  Browser                  Backend                    node-pty              Shell
     │                        │                          │                    │
     │  WS: Connect           │                          │                    │
     │  /ws/terminal          │                          │                    │
     │───────────────────────►│                          │                    │
     │                        │                          │                    │
     │                        │  spawn('bash')           │                    │
     │                        │─────────────────────────►│                    │
     │                        │                          │                    │
     │                        │                          │  Fork PTY          │
     │                        │                          │───────────────────►│
     │                        │                          │                    │
     │  WS: Send Command      │                          │                    │
     │  "ls -la"              │                          │                    │
     │───────────────────────►│                          │                    │
     │                        │                          │                    │
     │                        │  write(data)             │                    │
     │                        │─────────────────────────►│                    │
     │                        │                          │                    │
     │                        │                          │  stdin             │
     │                        │                          │───────────────────►│
     │                        │                          │                    │
     │                        │                          │◄───────────────────│
     │                        │                          │     stdout         │
     │                        │                          │                    │
     │                        │  on('data')              │                    │
     │                        │◄─────────────────────────│                    │
     │                        │                          │                    │
     │  WS: Receive Output    │                          │                    │
     │◄───────────────────────│                          │                    │
     │  (rendered in xterm.js)│                          │                    │
     │                        │                          │                    │


┌──────────────────────────────────────────────────────────────────────────────┐
│                       LLM Provider Authentication                            │
└──────────────────────────────────────────────────────────────────────────────┘

  User              Frontend              Backend              auth.json
    │                  │                     │                     │
    │  Set API Key     │                     │                     │
    │─────────────────►│                     │                     │
    │                  │                     │                     │
    │                  │  POST /api/providers│                     │
    │                  │  /:id/credentials   │                     │
    │                  │────────────────────►│                     │
    │                  │                     │                     │
    │                  │                     │  Encrypt & Store    │
    │                  │                     │  (chmod 0o600)      │
    │                  │                     │────────────────────►│
    │                  │                     │                     │
    │                  │  200 OK             │                     │
    │                  │  (key never echoed) │                     │
    │                  │◄────────────────────│                     │
    │                  │                     │                     │
    │  ◄───────────────│                     │                     │
    │  "Key Saved"     │                     │                     │
    │                  │                     │                     │
```

---

## Engineering Deep Dive: Fixes & Architecture

Building a seamless web experience for a CLI tool required solving several complex engineering challenges.

### 1. The "Ghost Terminal" Bug (Docker & PTY)
**The Problem:** The web terminal worked locally but crashed instantly when deployed to Azure.
**The Investigation:** The logs showed "File not found" when trying to spawn a shell.
**The Discovery:** `node-pty` relies on a native C++ compiled binary (`pty-worker.cjs`) to interact with the OS pseudo-terminals. Our Docker multi-stage build was aggressively pruning files, and due to `.dockerignore` rules or build caching, this critical worker file was being left behind in the final image.
**The Fix:** We rewrote the Dockerfile to explicitly copy the `backend` assets in the final `runner` stage and implemented a `fix-terminal-worker.sh` script to verify file presence at runtime. We also forced a cache-busting rebuild on the production VM to ensure the binary matched the OS architecture.

### 2. Intelligent Version Detection
**The Problem:** The system kept reporting the OpenCode version as `0.0.0`, triggering "Update Required" warnings.
**The Cause:** The `opencode --version` command output included logs like `Listening on 0.0.0.0`. Our initial regex `(\d+\.\d+\.\d+)` was too eager and matched the IP address before the actual version number.
**The Fix:** We implemented a robust parsing strategy in `opencode-single-server.ts`:
*   **Line-by-Line Parsing:** We process output one line at a time.
*   **Strict Regex:** We updated the pattern to `/(?:^|\s|v)(\d+\.\d+\.\d+)(?:\s|$)/` to enforce boundaries.
*   **Heuristic Guard:** We added a check to ensure the match isn't followed by a dot (excluding IP addresses).

### 3. Secure Credential Management
**The Problem:** We needed a way to store API keys for different providers (OpenAI, Anthropic) securely without hardcoding them in env vars.
**The Solution:** We built a dedicated `AuthService` and API routes (`/api/providers/:id/credentials`).
*   Credentials are stored in a secured JSON file (`auth.json`) with `0o600` permissions.
*   The frontend acts as a management interface, allowing users to securely set, check status, and delete keys without ever exposing the actual key values back to the client.

---

## How to Build Your Own Cloud Vibe Station

### Prerequisites
*   A Cloud VM (Azure B2s or AWS t3.medium recommended).
*   A Domain Name (managed by Cloudflare).

### The Deployment Recipe

**1. Prepare the VM**
You can use our automated script to provision a new Azure VM or setup an existing one.

If you already have a server (Ubuntu recommended):
```bash
export TARGET_HOST="your-server-ip"
bun run scripts/deploy.ts
```

If you want to create a new VM on Azure automatically:
```bash
# Requires Azure CLI installed and logged in
bun run scripts/deploy.ts
```
This script will:
1.  Create an Azure Resource Group and VM (if `TARGET_HOST` is unset).
2.  Install Docker, Git, and dependencies on the remote host.
3.  Deploy the entire stack with Cloudflare Tunnels and Caddy authentication.

**2. Authentication**
Create a `docker-compose.yml` file that orchestrates the Manager and the Secure Tunnel.

```yaml
services:
  opencode-manager:
    image: ghcr.io/dzianisv/opencode-manager:latest
    restart: always
    environment:
      - PORT=5003
      - OPENCODE_SERVER_PORT=5551
    volumes:
      - ./workspace:/workspace
      - ./data:/app/data

  tunnel:
    image: cloudflare/cloudflared:latest
    command: tunnel --no-autoupdate run --token ${TUNNEL_TOKEN}
    restart: always
```

**2. Configure the Tunnel**
In your Cloudflare Dashboard (Zero Trust > Access > Tunnels):
1.  Create a tunnel.
2.  Route a public hostname (e.g., `vibe.your-domain.com`) to `http://opencode-manager:5003`.
3.  Copy the token into your `.env` file on the server.

**3. Launch**
```bash
docker compose up -d
```

### The Experience
Once deployed, you simply navigate to your URL. You're greeted by a chat interface. You can:
*   **Say:** "Clone the repo from GitHub and run the tests."
*   **Watch:** The terminal opens, `git clone` runs, and tests execute.
*   **Read:** The agent reads back the results using TTS.

This is the power of self-hosting: absolute control, privacy, and the ability to fix and extend the platform yourself—just like we did with the terminal and version detection logic.

**Ready to vibe?** Fork the repo and start building.
