# Session-Based Architecture Design Document

**Version:** 1.0.0  
**Date:** 2025-03-07  
**Status:** Draft  
**Author:** OpenCode Manager Team

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Problem Statement](#problem-statement)
3. [Architecture Overview](#architecture-overview)
4. [Core Concepts](#core-concepts)
5. [Directory Structure](#directory-structure)
6. [Session Pod Architecture](#session-pod-architecture)
7. [Devcontainer Template System](#devcontainer-template-system)
8. [Worktree Management](#worktree-management)
9. [Code-Server Integration](#code-server-integration)
10. [API Design](#api-design)
11. [Database Schema](#database-schema)
12. [Security Considerations](#security-considerations)
13. [Implementation Phases](#implementation-phases)
14. [Open Questions](#open-questions)

---

## Executive Summary

This document describes the **Session-Based Architecture** for OpenCode Manager, a complete redesign that enables:

- **Multi-repository sessions**: Each session can work with multiple git repositories simultaneously
- **Isolated environments**: Every session runs in its own Docker pod with dedicated DinD instance
- **Reusable devcontainer templates**: Version-controlled, shareable environment definitions
- **Integrated code-server**: Full VS Code experience in the browser for editing everything
- **Git worktrees**: Efficient multi-branch development without repo duplication
- **Self-modifying containers**: Sessions can request environment changes dynamically

### Key Benefits

- ✅ **True isolation**: No interference between sessions, each with own Docker environment
- ✅ **Full control**: Edit code, configs, devcontainers all in browser via code-server
- ✅ **Reproducible**: Devcontainer templates ensure consistent environments
- ✅ **Efficient**: Worktrees share dependencies via worktree-link
- ✅ **Scalable**: Sessions can be distributed, load-balanced, resource-limited

---

## Problem Statement

### Current Limitations

The existing OpenCode Manager architecture has several limitations:

1. **Single global OpenCode server**: All users share one instance, no isolation
2. **No multi-repo support**: Can only work with one repository at a time
3. **Static environment**: Cannot dynamically add tools or change configuration
4. **Limited IDE integration**: No built-in code editor for quick fixes
5. **Worktree limitations**: Manual worktree management, no dependency linking

### Requirements

The new architecture must support:

1. **Multiple isolated sessions** running concurrently
2. **Multiple repositories per session** with shared context
3. **Dynamic environment modification** (add packages, change configs)
4. **Browser-based IDE** for editing code and configurations
5. **Efficient git worktree management** with dependency sharing
6. **Reusable environment templates** that can be version-controlled
7. **Docker-in-Docker** for each session to build/run containers
8. **Reverse proxy** for remote access to sessions

---

## Architecture Overview

### High-Level Diagram

```
┌──────────────────────────────────────────────────────────────┐
│               OpenCode Manager (Host Process)                 │
│  - Web UI (React + Vite)                                     │
│  - REST API (Bun + Hono)                                     │
│  - Session Orchestration                                     │
│  - Devcontainer Management                                   │
│  - Worktree Management                                       │
│  - Reverse Proxy (Traefik)                                   │
└────────────────────────┬─────────────────────────────────────┘
                         │
                         │ Docker Socket
                         ▼
┌──────────────────────────────────────────────────────────────┐
│                    Docker Daemon (Host)                       │
│                  Network: opencode-net                        │
└────────────────────────┬─────────────────────────────────────┘
                         │
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
    Session Pod 1   Session Pod 2   Session Pod N
    ┌──────────┐    ┌──────────┐    ┌──────────┐
    │ code-svr │    │ code-svr │    │ code-svr │
    │ OpenCode │    │ OpenCode │    │ OpenCode │
    │   DinD   │    │   DinD   │    │   DinD   │
    └────┬─────┘    └────┬─────┘    └────┬─────┘
         │               │               │
         └───────────────┴───────────────┘
                         │
                         ▼
              ┌─────────────────────┐
              │  Host Filesystem    │
              │  /workspace/        │
              │   ├── repos/        │
              │   ├── sessions/     │
              │   └── devcontainers/│
              └─────────────────────┘
```

### Key Components

1. **Manager**: Host process orchestrating sessions
2. **Session Pods**: Three-container units (code-server, OpenCode, DinD)
3. **Repositories**: Git repos with worktrees for each session
4. **Devcontainer Templates**: Version-controlled environment definitions
5. **Session Directories**: Per-session state and configuration
6. **Reverse Proxy**: Traefik for public access and SSL

---

## Core Concepts

### 1. Sessions

A **session** is an isolated workspace containing:
- One or more git repository worktrees
- A devcontainer environment (OpenCode + code-server)
- A dedicated Docker-in-Docker instance
- Persistent state (OpenCode history, code-server config)

**Session Lifecycle:**
- `creating` → Building containers, creating worktrees
- `running` → Active and healthy
- `stale` → Devcontainer config changed, needs restart
- `stopped` → Containers stopped, state preserved
- `error` → Failed to start or crashed

### 2. Devcontainer Templates

**Templates** are reusable, version-controlled environment definitions:
- Stored in `/workspace/devcontainers/` (git repository)
- Define Nix packages, environment variables, Docker config
- Can be forked and modified per-session
- Shared across multiple sessions or repos

**Template Types:**
- **Built-in**: Pre-configured (nodejs, python, rust, etc.)
- **Custom**: User-created or forked
- **Session-specific**: Auto-forked when modified

### 3. Repository Worktrees

**Worktrees** enable multiple checkouts of the same repo:
- Base repo in `/workspace/repos/{repo-name}/`
- Worktrees as subdirectories: `/workspace/repos/{repo-name}/{session-name}/`
- Linked dependencies via `worktree-link` CLI tool
- Isolated state per session, shared `node_modules`, caches, etc.

### 4. Three-Container Pod

Each session runs **three containers**:

1. **code-server**: VS Code in browser
   - Edit code, configs, devcontainer templates
   - Access to Git, Docker, terminal
   - Port: 8080

2. **OpenCode**: AI coding agent
   - OpenCode Server instance
   - Accesses repos, runs commands
   - Port: 5551

3. **DinD** (Docker-in-Docker): Isolated Docker daemon
   - Build images, run containers
   - Shared with code-server and OpenCode
   - Port: 2376 (TLS)

---

## Directory Structure

```
/workspace/
├── repos/                              # All git repositories
│   ├── repo1/                          # Base repository
│   │   ├── .git/
│   │   ├── .devcontainer/              # (Optional) Default devcontainer
│   │   ├── .worktreelinks              # Worktree-link config
│   │   ├── src/
│   │   ├── .shared/                    # Session-specific shared resources
│   │   │   ├── session1/
│   │   │   │   ├── node_modules/
│   │   │   │   ├── .env
│   │   │   │   └── .cache/
│   │   │   └── session2/
│   │   │       └── node_modules/
│   │   └── session1/                   # Worktree for session1
│   │       ├── .git → ../.git/worktrees/session1
│   │       ├── node_modules → ../.shared/session1/node_modules
│   │       └── src/
│   │
│   └── repo2/
│       ├── .git/
│       └── session1/                   # Worktree for session1
│
├── devcontainers/                      # Git-versioned templates
│   ├── .git/                           # Git repo for templates
│   ├── README.md
│   ├── nodejs-fullstack/
│   │   ├── devcontainer.json
│   │   ├── Dockerfile.nix
│   │   └── README.md
│   ├── python-ml/
│   │   ├── devcontainer.json
│   │   └── Dockerfile.nix
│   └── custom-session1/                # Forked template
│       └── devcontainer.json
│
├── sessions/                           # Per-session directories
│   ├── session1/
│   │   ├── repo1 → ../../repos/repo1/session1/
│   │   ├── repo2 → ../../repos/repo2/session1/
│   │   ├── .shared/                    # Aggregated shared resources
│   │   │   ├── repo1 → ../../repos/repo1/.shared/session1/
│   │   │   └── repo2 → ../../repos/repo2/.shared/session1/
│   │   ├── devcontainer → ../../devcontainers/nodejs-fullstack/
│   │   ├── state/                      # OpenCode persistent state
│   │   │   ├── history/
│   │   │   └── sessions/
│   │   ├── docker/                     # DinD data volume
│   │   ├── code-server/                # code-server config
│   │   │   ├── config.yaml
│   │   │   ├── extensions/
│   │   │   └── User/
│   │   │       └── settings.json
│   │   └── docker-compose.yml          # Generated pod definition
│   │
│   └── session2/
│       └── ...
│
└── config/
    ├── default-devcontainers/          # Built-in templates (read-only)
    │   ├── minimal/
    │   ├── nodejs/
    │   ├── python/
    │   └── rust/
    ├── traefik/                        # Reverse proxy config
    │   ├── traefik.yml
    │   ├── dynamic/
    │   │   └── sessions.yml            # Auto-generated routes
    │   └── acme.json
    ├── known_hosts                     # SSH known hosts
    └── ssh_config                      # SSH configuration
```

---

## Session Pod Architecture

### Docker Compose Template

Each session is defined by a `docker-compose.yml` file:

```yaml
version: '3.8'

services:
  dind:
    image: docker:24-dind
    container_name: ${SESSION_NAME}-dind
    hostname: dind
    privileged: true
    environment:
      - DOCKER_TLS_CERTDIR=/certs
    volumes:
      - ${SESSION_PATH}/docker:/var/lib/docker
      - dind-certs:/certs
    networks:
      opencode-net:
        aliases:
          - ${SESSION_NAME}-dind
    healthcheck:
      test: ["CMD", "docker", "info"]
      interval: 10s
      timeout: 5s
      retries: 5

  opencode:
    build:
      context: /workspace/devcontainers/${DEVCONTAINER_TEMPLATE}
      dockerfile: Dockerfile.nix
      args:
        NIX_PACKAGES: ${NIX_PACKAGES}
        DEVCONTAINER_HASH: ${DEVCONTAINER_HASH}
    container_name: ${SESSION_NAME}-opencode
    hostname: ${SESSION_NAME}-opencode
    depends_on:
      dind:
        condition: service_healthy
    environment:
      - DOCKER_HOST=tcp://dind:2376
      - DOCKER_TLS_VERIFY=1
      - DOCKER_CERT_PATH=/certs/client
      - OPENCODE_PORT=5551
      - WORKSPACE_PATH=/workspace
    volumes:
      - ${SESSION_PATH}:/workspace
      - dind-certs:/certs:ro
      - /workspace/config/ssh_config:/home/vscode/.ssh/config:ro
      - /workspace/config/known_hosts:/home/vscode/.ssh/known_hosts:ro
    networks:
      opencode-net:
        aliases:
          - ${SESSION_NAME}-opencode.oc
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:5551/doc"]
      interval: 30s
      timeout: 3s
      retries: 3

  code-server:
    image: codercom/code-server:latest
    container_name: ${SESSION_NAME}-code
    hostname: ${SESSION_NAME}-code
    depends_on:
      dind:
        condition: service_healthy
    environment:
      - PASSWORD=${CODE_SERVER_PASSWORD}
      - DOCKER_HOST=tcp://dind:2376
      - DOCKER_TLS_VERIFY=1
      - DOCKER_CERT_PATH=/certs/client
    volumes:
      - ${SESSION_PATH}:/workspace
      - ${SESSION_PATH}/code-server:/home/coder/.local/share/code-server
      - dind-certs:/certs:ro
      - /workspace/config/ssh_config:/home/coder/.ssh/config:ro
      - /workspace/config/known_hosts:/home/coder/.ssh/known_hosts:ro
      - /workspace/devcontainers:/workspace-root/devcontainers
      - /workspace/repos:/workspace-root/repos:ro
    command: >
      --bind-addr 0.0.0.0:8080
      --auth password
      --disable-telemetry
      /workspace
    networks:
      opencode-net:
        aliases:
          - ${SESSION_NAME}-code.oc
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.${SESSION_NAME}-code.rule=Host(`${SESSION_NAME}-code.${PUBLIC_DOMAIN}`)"
      - "traefik.http.services.${SESSION_NAME}-code.loadbalancer.server.port=8080"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/healthz"]
      interval: 30s
      timeout: 3s
      retries: 3

volumes:
  dind-certs:
    name: ${SESSION_NAME}-dind-certs

networks:
  opencode-net:
    external: true
```

### Container Communication

```
┌─────────────────────────────────────────┐
│         Session Pod (session1)          │
│                                         │
│  ┌─────────────────┐                   │
│  │   code-server   │                   │
│  │   Port: 8080    │                   │
│  └────────┬────────┘                   │
│           │                            │
│           ├─ http://session1-opencode.oc:5551
│           └─ tcp://dind:2376           │
│                                         │
│  ┌─────────────────┐                   │
│  │    OpenCode     │                   │
│  │   Port: 5551    │                   │
│  └────────┬────────┘                   │
│           │                            │
│           └─ tcp://dind:2376           │
│                                         │
│  ┌─────────────────┐                   │
│  │      DinD       │                   │
│  │   Port: 2376    │                   │
│  └─────────────────┘                   │
│                                         │
└─────────────────────────────────────────┘
```

All containers share:
- Docker network `opencode-net`
- DinD TLS certificates volume
- Git credentials (read-only)
- Session directory mount

---

## Devcontainer Template System

### Template Structure

```
/workspace/devcontainers/nodejs-fullstack/
├── devcontainer.json          # Main configuration
├── Dockerfile.nix             # Nix-based Docker image
├── .worktreelinks.template    # Optional: recommended worktree config
└── README.md                  # Documentation
```

### devcontainer.json Schema

```json
{
  "name": "Node.js Full-Stack",
  "version": "1.0.0",
  "description": "Node.js + PostgreSQL + Redis for full-stack development",
  
  "build": {
    "dockerfile": "Dockerfile.nix",
    "context": ".",
    "args": {
      "NIX_PACKAGES": "nodejs_22 postgresql redis git gh ripgrep fd"
    }
  },
  
  "containerEnv": {
    "NODE_ENV": "development",
    "DATABASE_URL": "postgres://localhost/dev"
  },
  
  "mounts": [],
  
  "postCreateCommand": "opencode serve --port 5551 --hostname 0.0.0.0",
  
  "remoteUser": "vscode",
  
  "customizations": {
    "vscode": {
      "extensions": [
        "dbaeumer.vscode-eslint",
        "esbenp.prettier-vscode",
        "ms-azuretools.vscode-docker"
      ],
      "settings": {
        "terminal.integrated.shell.linux": "/bin/bash"
      }
    }
  },
  
  "metadata": {
    "tags": ["nodejs", "postgresql", "redis", "fullstack"],
    "author": "admin",
    "createdAt": "2025-03-07",
    "forkedFrom": null
  }
}
```

### Nix-based Dockerfile

```dockerfile
FROM nixos/nix:2.18.1 AS builder

ARG NIX_PACKAGES="git nodejs_22"
ARG DEVCONTAINER_HASH=""

# Install Nix packages
RUN nix-channel --update && \
    nix-env -iA \
      nixpkgs.git \
      nixpkgs.gh \
      nixpkgs.curl \
      nixpkgs.jq \
      nixpkgs.gnused \
      nixpkgs.gnugrep \
      nixpkgs.coreutils \
      ${NIX_PACKAGES}

FROM debian:bookworm-slim

# Copy Nix store
COPY --from=builder /nix /nix
ENV PATH="/nix/var/nix/profiles/default/bin:${PATH}"

# Create vscode user
RUN useradd -m -s /bin/bash vscode && \
    mkdir -p /workspace && \
    chown -R vscode:vscode /workspace

# Install OpenCode
RUN curl -fsSL https://opencode.ai/install | bash -s -- --no-modify-path && \
    mv /root/.opencode /opt/opencode && \
    ln -s /opt/opencode/bin/opencode /usr/local/bin/opencode

# Install Docker client (for DinD communication)
RUN apt-get update && \
    apt-get install -y ca-certificates curl && \
    install -m 0755 -d /etc/apt/keyrings && \
    curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian bookworm stable" > /etc/apt/sources.list.d/docker.list && \
    apt-get update && \
    apt-get install -y docker-ce-cli && \
    rm -rf /var/lib/apt/lists/*

USER vscode
WORKDIR /workspace

LABEL devcontainer.hash="${DEVCONTAINER_HASH}"

CMD ["opencode", "serve", "--port", "5551", "--hostname", "0.0.0.0"]
```

### Template Management

**Git Repository:**
- `/workspace/devcontainers/.git/` tracks all template changes
- Auto-commit on changes via UI or code-server
- Can push/pull to remote for team sharing

**Forking Strategy:**
When a session needs custom packages:
1. **Single-user template**: Modify in place
2. **Shared template**: Fork to `custom-{session-name}`
3. **Built-in template**: Always fork (read-only)

**Merge Strategy:**
If session uses multiple repos with different devcontainers:
- Union of all Nix packages
- Merge environment variables (last-write-wins with warning)
- Combine VS Code extensions
- Concatenate post-create commands

---

## Worktree Management

### Worktree Creation Flow

```typescript
async createWorktreeForSession(
  repo: Repository,
  sessionName: string,
  branch: string
): Promise<string> {
  const repoPath = `/workspace/repos/${repo.name}`
  const worktreePath = `${repoPath}/${sessionName}`
  const sharedPath = `${repoPath}/.shared/${sessionName}`
  
  // 1. Create shared directory for this session
  await fs.mkdir(sharedPath, { recursive: true })
  
  // 2. Create git worktree
  await execCommand([
    'git', '-C', repoPath,
    'worktree', 'add', sessionName, branch
  ])
  
  // 3. Run worktree-link to symlink dependencies
  await execCommand([
    'worktree-link',
    '--source', repoPath,
    '--target', worktreePath,
    '--config', `${repoPath}/.worktreelinks`
  ])
  
  return worktreePath
}
```

### .worktreelinks Configuration

Template for shared resources:

```
# Shared dependencies
../.shared/SESSION_NAME/node_modules
../.shared/SESSION_NAME/.npm
../.shared/SESSION_NAME/.pnpm-store
../.shared/SESSION_NAME/.yarn
../.shared/SESSION_NAME/.bun

# Environment configs
../.shared/SESSION_NAME/.env
../.shared/SESSION_NAME/.env.local

# Build caches
../.shared/SESSION_NAME/.cache
../.shared/SESSION_NAME/dist
../.shared/SESSION_NAME/build

# Python
../.shared/SESSION_NAME/venv
../.shared/SESSION_NAME/.venv
../.shared/SESSION_NAME/__pycache__

# IDE settings
.vscode/
.idea/
```

**Note:** `SESSION_NAME` is replaced dynamically by the manager

### Cleanup on Session Destroy

```typescript
async destroySession(sessionId: string, keepWorktrees: boolean = false) {
  const session = await db.getSession(sessionId)
  
  // Stop containers
  await dockerOrchestrator.stopPod(session.name)
  
  // Remove worktrees (unless keeping)
  if (!keepWorktrees) {
    for (const mapping of session.repoMappings) {
      const repoPath = `/workspace/repos/${mapping.repoName}`
      
      // Remove worktree from git tracking
      await execCommand([
        'git', '-C', repoPath,
        'worktree', 'remove', '--force', session.name
      ])
      
      // Clean up shared resources
      await fs.rm(`${repoPath}/.shared/${session.name}`, { 
        recursive: true, 
        force: true 
      })
    }
  }
  
  // Remove session directory
  await fs.rm(session.sessionPath, { recursive: true, force: true })
  
  // Delete from database
  await db.deleteSession(sessionId)
}
```

---

## Code-Server Integration

### Workspace Layout

When user opens `https://session1-code.dev.example.com`:

```
/workspace/                    # Mounted session directory
├── repo1/                     # Worktree (editable)
│   └── src/
├── repo2/                     # Worktree (editable)
│   └── src/
├── .shared/                   # Shared resources (editable)
│   ├── repo1/
│   └── repo2/
├── devcontainer/              # Template symlink (editable)
│   └── devcontainer.json
├── state/                     # OpenCode state (viewable)
└── /workspace-root/           # Additional context
    ├── devcontainers/         # All templates (editable)
    │   ├── nodejs-fullstack/
    │   └── python-ml/
    └── repos/                 # All repos (read-only reference)
        ├── repo1/
        └── repo2/
```

### Pre-installed Extensions

Based on devcontainer template:

```json
{
  "customizations": {
    "vscode": {
      "extensions": [
        "ms-azuretools.vscode-docker",
        "eamodio.gitlens",
        "esbenp.prettier-vscode",
        "dbaeumer.vscode-eslint",
        "github.copilot"
      ]
    }
  }
}
```

### Authentication

**Auto-generated password per session:**
```typescript
const codeServerPassword = crypto.randomBytes(32).toString('base64')

// Store in session metadata
session.codeServerPassword = codeServerPassword

// User retrieves from Manager UI
GET /api/sessions/:id/code-server-password
Response: { password: "..." }
```

**Alternative: SSO Integration:**
- Manager generates JWT token
- Code-server validates via Manager API
- Seamless single sign-on

### Auto-commit on Save

File watcher monitors devcontainer changes:

```typescript
// Watch /workspace/devcontainers/
const watcher = fs.watch('/workspace/devcontainers', { recursive: true })

for await (const event of watcher) {
  if (event.filename.endsWith('devcontainer.json')) {
    const template = path.dirname(event.filename)
    
    // Debounce and auto-commit
    await debounce(async () => {
      await execCommand([
        'git', '-C', '/workspace/devcontainers',
        'add', template
      ])
      
      await execCommand([
        'git', '-C', '/workspace/devcontainers',
        'commit', '-m', `Update ${template} (via code-server)`
      ])
      
      // Mark affected sessions as stale
      await markSessionsStale(template)
    }, 2000)
  }
}
```

---

## API Design

### Session Management

```typescript
// Create new session
POST /api/sessions
{
  name: "fullstack-auth",
  repos: [
    { repoId: 1, branch: "feature-auth" },
    { repoId: 2, branch: "feature-auth" }
  ],
  devcontainerTemplate: "nodejs-fullstack",
  enablePublicAccess?: boolean,
  metadata?: { tags: ["feature", "auth"] }
}
Response: Session

// List sessions
GET /api/sessions?status=running&repoId=1
Response: Session[]

// Get session details
GET /api/sessions/:id
Response: Session & { 
  containers: ContainerStatus[],
  urls: { codeServer: string, opencode: string }
}

// Restart session
POST /api/sessions/:id/restart
Response: { status: "restarting", estimatedTime: "2-3 minutes" }

// Stop session (preserve state)
POST /api/sessions/:id/stop
Response: { status: "stopped" }

// Start stopped session
POST /api/sessions/:id/start
Response: { status: "starting" }

// Destroy session
DELETE /api/sessions/:id?keepWorktrees=false
Response: { deleted: true, worktreesKept: boolean }

// Get code-server password
GET /api/sessions/:id/code-server-password
Response: { password: string }

// Stream logs
GET /api/sessions/:id/logs?container=opencode&follow=true
Response: text/event-stream
```

### Devcontainer Template Management

```typescript
// List templates
GET /api/devcontainers
Response: DevcontainerTemplate[]

// Get template details
GET /api/devcontainers/:name
Response: DevcontainerTemplate & {
  config: DevcontainerConfig,
  usedBy: { sessions: string[], repos: string[] }
}

// Create template
POST /api/devcontainers
{
  name: "my-template",
  config: DevcontainerConfig,
  basedOn?: "nodejs-fullstack"
}
Response: DevcontainerTemplate

// Update template
PUT /api/devcontainers/:name
{ config: DevcontainerConfig }
Response: {
  updated: true,
  affectedSessions: string[],
  requiresRestart: boolean
}

// Fork template
POST /api/devcontainers/:name/fork
{
  newName: "custom-session1",
  changes?: Partial<DevcontainerConfig>
}
Response: DevcontainerTemplate

// Delete template
DELETE /api/devcontainers/:name
Response: { deleted: true }
```

### Repository Management

```typescript
// List repos
GET /api/repos
Response: Repository[]

// Create repo
POST /api/repos
{
  name: "my-service",
  repoUrl?: "git@github.com:org/repo.git",
  localPath?: "/absolute/path",
  defaultBranch?: "main",
  recommendedDevcontainer?: "nodejs-fullstack"
}
Response: Repository

// Update repo
PUT /api/repos/:id
{ recommendedDevcontainer: "python-ml" }
Response: Repository

// Delete repo
DELETE /api/repos/:id
Response: { deleted: true }

// Get repo worktrees
GET /api/repos/:id/worktrees
Response: Worktree[]
```

### OpenCode Integration

```typescript
// Request devcontainer update (called by OpenCode)
POST /api/sessions/current/request-devcontainer-update
Headers: X-Session-Name: session1
{
  changes: {
    addNixPackages: ["postgresql"],
    addEnv: { "DATABASE_URL": "..." }
  },
  reason: "Need PostgreSQL for feature X",
  autoRestart?: boolean
}
Response: {
  action: "forked" | "modified",
  newTemplate?: string,
  affectedSessions: string[],
  requiresRestart: boolean
}
```

---

## Database Schema

```sql
-- Sessions
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  
  opencode_container_id TEXT,
  dind_container_id TEXT,
  code_server_container_id TEXT,
  
  internal_hostname TEXT NOT NULL,
  opencode_url TEXT NOT NULL,
  code_server_url TEXT NOT NULL,
  public_opencode_url TEXT,
  
  session_path TEXT NOT NULL,
  opencode_state_path TEXT NOT NULL,
  dind_data_path TEXT NOT NULL,
  code_server_config_path TEXT NOT NULL,
  
  devcontainer_template TEXT NOT NULL,
  devcontainer_config_hash TEXT NOT NULL,
  code_server_password TEXT NOT NULL,
  
  created_at INTEGER NOT NULL,
  last_active_at INTEGER NOT NULL,
  metadata TEXT,
  
  FOREIGN KEY (devcontainer_template) REFERENCES devcontainer_templates(name)
);

-- Session-Repo mappings
CREATE TABLE session_repos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  repo_id INTEGER NOT NULL,
  repo_name TEXT NOT NULL,
  worktree_path TEXT NOT NULL,
  symlink_path TEXT NOT NULL,
  container_path TEXT NOT NULL,
  branch TEXT,
  
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE RESTRICT,
  UNIQUE(session_id, repo_id, branch)
);

-- Devcontainer templates
CREATE TABLE devcontainer_templates (
  name TEXT PRIMARY KEY,
  config TEXT NOT NULL,
  dockerfile TEXT,
  forked_from TEXT,
  is_built_in BOOLEAN DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  metadata TEXT,
  
  FOREIGN KEY (forked_from) REFERENCES devcontainer_templates(name)
);

-- Repositories (enhanced)
ALTER TABLE repos ADD COLUMN recommended_devcontainer TEXT;
ALTER TABLE repos ADD COLUMN devcontainer_history TEXT;

-- Template usage tracking
CREATE TABLE template_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_name TEXT NOT NULL,
  session_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  
  FOREIGN KEY (template_name) REFERENCES devcontainer_templates(name),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- Devcontainer update requests
CREATE TABLE devcontainer_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  template_name TEXT,
  requested_by TEXT NOT NULL,
  changes TEXT NOT NULL,
  reason TEXT,
  action TEXT,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (template_name) REFERENCES devcontainer_templates(name)
);
```

---

## Security Considerations

### Container Isolation

- **Network isolation**: Each pod on `opencode-net`, isolated from host
- **Filesystem isolation**: Sessions can only access their own directories
- **Resource limits**: CPU, memory, disk quotas per session
- **Privileged mode**: Only DinD runs privileged, contained within pod

### Authentication

- **Code-server**: Password per session or SSO via Manager
- **OpenCode API**: Internal network only, no external exposure
- **Manager API**: Existing auth system (JWT, OAuth, Passkeys)
- **Traefik**: Optional authentication middleware for public access

### Git Credentials

- **SSH keys**: Mounted read-only from `/workspace/config/`
- **Known hosts**: Shared, managed by Manager
- **Per-session credentials**: Possible future enhancement

### Docker Socket Access

- **DinD**: Each session has own Docker daemon
- **No host access**: Containers cannot interact with host Docker
- **TLS certificates**: Shared only within pod

---

## Implementation Phases

### Phase 1: Foundation (Week 1)
**Goal**: Basic session lifecycle with database and directory structure

- [ ] Create database schema (sessions, session_repos, devcontainer_templates)
- [ ] Implement SessionManager service skeleton
- [ ] Implement DockerOrchestrator service
- [ ] Create Docker network (`opencode-net`)
- [ ] Session directory structure creation
- [ ] Basic session CRUD operations

**Deliverable**: Can create/destroy session directories and DB records

---

### Phase 2: Devcontainer Templates (Week 1-2)
**Goal**: Template management system with git integration

- [ ] Initialize `/workspace/devcontainers/` as git repo
- [ ] Create built-in templates (nodejs, python, rust, minimal)
- [ ] DevcontainerManager service
- [ ] Template CRUD API endpoints
- [ ] Config validation and schema checking
- [ ] Hash-based caching for image builds

**Deliverable**: Can create, edit, fork templates via API

---

### Phase 3: Worktree Management (Week 2)
**Goal**: Multi-repo worktree creation with dependency linking

- [ ] WorktreeManager service
- [ ] Multi-repo worktree creation
- [ ] Symlink creation in session directories
- [ ] Worktree-link CLI integration
- [ ] Auto-generate .worktreelinks for repos
- [ ] Cleanup logic for session destroy

**Deliverable**: Sessions can check out multiple repo worktrees

---

### Phase 4: Container Orchestration (Week 2-3)
**Goal**: Three-container pods with DinD

- [ ] Docker Compose template generation
- [ ] DinD sidecar setup
- [ ] OpenCode container with Nix Dockerfile
- [ ] Code-server container setup
- [ ] TLS certificate sharing
- [ ] Health checks and dependency management
- [ ] Container lifecycle (start, stop, restart)

**Deliverable**: Can start/stop full session pods

---

### Phase 5: Image Building (Week 3)
**Goal**: Build Nix-based images from templates

- [ ] Nix Dockerfile generation from template
- [ ] Image build orchestration
- [ ] Cache images by config hash
- [ ] Build progress tracking
- [ ] Error handling and rollback

**Deliverable**: Sessions use custom-built images

---

### Phase 6: Code-Server Integration (Week 3-4)
**Goal**: Browser IDE with full access

- [ ] Code-server container configuration
- [ ] Workspace mounting strategy
- [ ] Authentication setup (password or SSO)
- [ ] Pre-install extensions from template
- [ ] File watcher for auto-commits
- [ ] Terminal access to Docker and Git

**Deliverable**: Can edit code and configs in browser

---

### Phase 7: Reverse Proxy (Week 4)
**Goal**: Public access with SSL

- [ ] Traefik setup and configuration
- [ ] Dynamic routing file generation
- [ ] SSL/TLS with Let's Encrypt
- [ ] Per-session public URLs
- [ ] Enable/disable public access API
- [ ] Optional authentication middleware

**Deliverable**: Sessions accessible via public URLs

---

### Phase 8: Self-Modifying Devcontainers (Week 4-5)
**Goal**: OpenCode can request environment changes

- [ ] API endpoint for update requests
- [ ] Fork vs modify decision logic
- [ ] Template merging for multi-repo sessions
- [ ] Session staleness detection
- [ ] Notification system (WebSocket)
- [ ] Audit trail for changes

**Deliverable**: OpenCode can dynamically request tools

---

### Phase 9: Manager UI (Week 5-6)
**Goal**: Full-featured web interface

- [ ] Session list/grid view with status
- [ ] Session creation wizard (multi-repo selection)
- [ ] Session detail page with embedded code-server
- [ ] Template list and editor
- [ ] Repository management UI
- [ ] Logs viewer (OpenCode + DinD)
- [ ] Real-time status updates (WebSocket)

**Deliverable**: Complete UI for all features

---

### Phase 10: Polish & Testing (Week 6-7)
**Goal**: Production-ready system

- [ ] Unit tests (target: 80% coverage)
- [ ] Integration tests (full lifecycle)
- [ ] Load tests (10+ concurrent sessions)
- [ ] Error handling and recovery
- [ ] Documentation (user guides, API docs)
- [ ] Performance optimization
- [ ] Resource limit enforcement

**Deliverable**: Production-ready release

---

## Open Questions

### 1. Code-Server Authentication
**Question**: How should code-server authenticate users?

**Options:**
- **A**: Auto-generated password per session (simple, secure)
- **B**: Unified SSO with Manager (seamless, complex)
- **C**: No auth (dev only, not secure)

**Recommendation**: Option A for initial release, Option B for future enhancement

---

### 2. Devcontainer Edit Flow
**Question**: What happens when user edits devcontainer in code-server?

**Options:**
- **A**: Auto-commit + auto-restart (fast, risky)
- **B**: Auto-commit + manual restart (safe, user control)
- **C**: Manual commit + manual restart (full control, more steps)

**Recommendation**: Option B - auto-commit but require explicit restart

---

### 3. Template Merging for Multi-Repo
**Question**: How to handle multiple repos with different devcontainers?

**Options:**
- **A**: Merge all (union of packages, merged env vars)
- **B**: Choose primary repo (user selects which devcontainer)
- **C**: Separate containers per repo (complex, high overhead)

**Recommendation**: Option A - intelligent merge with conflict warnings

---

### 4. Worktree Cleanup Policy
**Question**: When destroying a session, what to do with worktrees?

**Options:**
- **A**: Always delete (default: `keepWorktrees=false`)
- **B**: Always keep (default: `keepWorktrees=true`)
- **C**: Ask user each time via API parameter

**Recommendation**: Option A - delete by default, with explicit keep flag

---

### 5. Resource Limits
**Question**: Should sessions have resource limits?

**Options:**
- **A**: Fixed limits (simpler, predictable)
- **B**: Configurable per session (flexible)
- **C**: Auto-scale (complex, requires orchestration)

**Recommendation**: Option B - sensible defaults (2 CPU, 4GB RAM, 50GB disk) with overrides

---

### 6. Template Storage: Git vs Database
**Question**: Where to store devcontainer templates?

**Options:**
- **A**: Git-only (version control, collaboration)
- **B**: Database-only (faster queries, simpler)
- **C**: Hybrid (git as source, cache in DB)

**Recommendation**: Option A - git-first for version control benefits

---

### 7. Public Domain Configuration
**Question**: What domain for public session URLs?

**Options:**
- **A**: Fixed domain (e.g., `*.dev.example.com`)
- **B**: Configurable in Manager settings
- **C**: Per-session custom domains

**Recommendation**: Option B - configurable with sensible default

---

### 8. Inter-Session Communication
**Question**: Should sessions be able to communicate?

**Options:**
- **A**: Shared volume (`/workspace/cross-session/`)
- **B**: Manager API for message passing
- **C**: Redis/message queue for pub/sub
- **D**: No inter-session communication (isolated)

**Recommendation**: Start with Option D, add Option B if needed

---

## Glossary

- **Session**: Isolated workspace with repos, devcontainer, and state
- **Pod**: Three-container unit (code-server, OpenCode, DinD)
- **Devcontainer**: Environment definition (Nix packages, Docker config)
- **Template**: Reusable, version-controlled devcontainer definition
- **Worktree**: Git feature for multiple checkouts of same repo
- **DinD**: Docker-in-Docker, isolated Docker daemon per session
- **Code-Server**: VS Code running in browser (by Coder)
- **OpenCode**: AI coding agent (Claude-powered)
- **Traefik**: Reverse proxy for routing and SSL
- **Nix**: Declarative package manager for reproducible environments

---

## References

- [Git Worktrees Documentation](https://git-scm.com/docs/git-worktree)
- [Code-Server GitHub](https://github.com/coder/code-server)
- [Devcontainer Specification](https://containers.dev/)
- [Nix Package Manager](https://nixos.org/)
- [Traefik Documentation](https://doc.traefik.io/traefik/)
- [Docker-in-Docker](https://hub.docker.com/_/docker)

---

**Document Status**: Draft  
**Next Review**: 2025-03-14  
**Approval Required**: Architecture team, Product owner
