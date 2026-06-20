# OpenCode Manager

Mobile-first web interface for [OpenCode](https://opencode.ai) AI agents. Manage, control, and code from any device - your phone, tablet, or desktop.

<p align="center">
  <img src="images/ocmgr-main.webp" alt="OpenCode Manager" width="600" style="border: none" />
  <img src="images/ocmgr-mobile.webp" alt="Mobile view" height="400" style="border: none; margin-left: 12px" />
</p>

## Quick Start

```bash
git clone https://github.com/chriswritescode-dev/opencode-manager.git
cd opencode-manager
cp .env.example .env
echo "AUTH_SECRET=$(openssl rand -base64 32)" >> .env
docker compose up -d
```

Open [http://localhost:5003](http://localhost:5003) and create your admin account. That's it!

## What is OpenCode Manager?

OpenCode Manager is a mobile-first web interface for [OpenCode](https://opencode.ai) AI agents. It combines repository management, chat/session control, Git and file tools, schedules, AI configuration, MCP server management, push notifications, and full PWA support into a single responsive application.

- **Repository management** — Clone, discover, and manage multiple Git repos with SSH authentication and worktree support
- **Chat & sessions** — Real-time SSE streaming with slash commands, `@file` mentions, Plan/Build modes, and per-agent model selection
- **Schedules** — Recurring repo jobs with reusable prompts, run history, and linked sessions
- **AI configuration** — Model/provider setup, OAuth for Anthropic/GitHub Copilot, custom agents
- **MCP & Skills** — MCP server management and skill support
- **Audio** — Text-to-speech and speech-to-text (browser + OpenAI-compatible)
- **Mobile & notifications** — Installable PWA with push notifications and mobile-first navigation

## How It Works

OpenCode Manager runs as a pnpm workspace:

- The Bun/Hono backend initializes SQLite, Better Auth, settings, schedules, notifications, and an OpenCode client.
- A supervised OpenCode server handles agent sessions while the backend proxies API calls and streams events over SSE.
- The React/Vite frontend uses React Router and TanStack Query to render repositories, sessions, schedules, settings, and mobile navigation.
- The shared package keeps config, schemas, and TypeScript types aligned between backend and frontend.

## Key Features

- **Repositories & Git** — Multi-repo management, local discovery, SSH auth, worktrees, unified diffs, branch/commit management — [Learn more](features/git.md)
- **Chat & Sessions** — Real-time SSE streaming, slash commands, `@file` mentions, Plan/Build modes, Mermaid diagrams — [Learn more](features/chat.md)
- **Files** — Directory browser with tree view, syntax highlighting, create/rename/delete, ZIP download — [Learn more](features/files.md)
- **Schedules** — Recurring repo jobs with reusable prompts, run history, linked sessions — [Learn more](features/schedules.md)
- **Assistant Mode** — Dedicated AI workspace with auto-provisioned skills for schedule management, notifications, settings, and repo listing — [Learn more](features/assistant-mode.md)
- **AI Configuration** — Model/provider setup, OAuth for Anthropic/GitHub Copilot, custom agents — [Learn more](features/ai-config.md)
- **MCP Servers** — Add local or remote MCP servers with OAuth support — [Learn more](features/mcp.md)
- **Skills** — Skill support for extended agent capabilities — [Learn more](features/skills.md)
- **Mobile & PWA** — Responsive UI, installable on any device, iOS-optimized — [Learn more](features/mobile.md)
- **Push Notifications** — Background alerts for agent events — [Learn more](features/notifications.md)
- **Audio** — Text-to-speech and speech-to-text (browser + OpenAI-compatible) — [Learn more](features/tts.md) | [Learn more](features/stt.md)

## Project Layout

- `backend/` — Bun + Hono API server: routes, services, database (SQLite) with migrations, auth with Better Auth, IPC server for SSH handling, OpenCode process management, and schedules.
- `frontend/` — React + Vite SPA: pages, components, hooks, API clients, Zustand stores, contexts, service worker (PWA), and tests.
- `shared/` — Workspace package for Zod schemas, TypeScript types, config defaults, and utilities used by both backend and frontend.
- `ocm-cli/` — `@opencode-manager/ocm-cli` CLI tool for attaching a local OpenCode TUI to Manager-hosted repos.
- `docs/` — MkDocs Material documentation (this site).
- `scripts/`, `Dockerfile`, `docker-compose.yml` — Setup scripts, Docker image build, and Compose deployment support.

## Next Steps

- [Installation Guide](getting-started/installation.md) - Detailed setup instructions
- [Quick Start](getting-started/quickstart.md) - Get up and running fast
- [Development Setup](development/setup.md) - Local environment, scripts, and testing
- [Contributing](development/contributing.md) - How to contribute to OpenCode Manager
- [Features Overview](features/overview.md) - Explore all features
- [Schedules & Recurring Jobs](features/schedules.md) - Automate recurring repo reviews and follow-ups
- [Configuration](configuration/environment.md) - Environment variables and setup
