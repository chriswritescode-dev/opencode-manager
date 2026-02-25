# Memory Plugin

`@opencode-manager/memory` is an **optional** OpenCode plugin that stores and recalls project knowledge across sessions using vector embeddings and semantic search.

[![npm](https://img.shields.io/npm/v/@opencode-manager/memory)](https://www.npmjs.com/package/@opencode-manager/memory)

!!! note "Not Required"
    This plugin is entirely optional. OpenCode Manager works fully without it — install it only if you want persistent project knowledge and semantic search capabilities.

!!! tip "Works with Standalone OpenCode"
    This plugin can also be used with standalone OpenCode installations outside of OpenCode Manager. Simply install the package and add it to your `opencode.json` plugins array.

---

## Installation

```bash
pnpm add @opencode-manager/memory
```

The local embedding model (`all-MiniLM-L6-v2`) is downloaded automatically via the `postinstall` script. For API-based embeddings (OpenAI or Voyage), skip the local model and set your provider and API key in the configuration instead.

Then register the plugin in your `opencode.json`:

```json
{
  "plugin": ["@opencode-manager/memory"]
}
```

---

## Configuration

On first run, the plugin copies a bundled `config.json` to the global data directory:

- `~/.local/share/opencode/memory/config.json`
- Falls back to `$XDG_DATA_HOME/opencode/memory/config.json`

The file is only created if it does not already exist. The config is validated on load — if it fails validation, defaults are used automatically.

### Full Default Config

```json
{
  "embedding": {
    "provider": "local",
    "model": "all-MiniLM-L6-v2",
    "dimensions": 384,
    "baseUrl": "",
    "apiKey": ""
  },
  "dataDir": "~/.local/share/opencode/memory",
  "dedupThreshold": 0.25,
  "logging": {
    "enabled": false,
    "file": "~/.local/share/opencode/memory/logs/memory.log"
  },
  "compaction": {
    "customPrompt": true,
    "inlinePlanning": true,
    "maxContextTokens": 4000,
    "snapshotToKV": true
  }
}
```

### API-Based Embedding Example

```json
{
  "embedding": {
    "provider": "openai",
    "model": "text-embedding-3-small",
    "apiKey": "sk-..."
  }
}
```

### Embedding Providers

| Provider | Models | API Key Required |
|----------|--------|-----------------|
| `local` | `all-MiniLM-L6-v2` (384d) | No |
| `openai` | `text-embedding-3-small` (1536d), `text-embedding-3-large` (3072d), `text-embedding-ada-002` (1536d) | Yes |
| `voyage` | `voyage-code-3` (1024d), `voyage-2` (1536d) | Yes |

Set `baseUrl` to point at any OpenAI-compatible self-hosted service (vLLM, Ollama, LocalAI, LiteLLM, text-embeddings-inference). The URL is automatically normalized — providing `http://localhost:11434` appends `/v1/embeddings`.

### All Options

| Key | Description | Default |
|-----|-------------|---------|
| `embedding.provider` | `local`, `openai`, or `voyage` | `local` |
| `embedding.model` | Model name | `all-MiniLM-L6-v2` |
| `embedding.dimensions` | Vector dimensions (auto-detected for known models) | — |
| `embedding.apiKey` | API key for OpenAI/Voyage | — |
| `embedding.baseUrl` | Custom endpoint for self-hosted services | — |
| `embedding.serverGracePeriod` | Time (ms) before idle embedding server shuts down | `30000` |
| `dataDir` | SQLite database and embedding server directory | `~/.local/share/opencode/memory` |
| `dedupThreshold` | Similarity threshold for deduplication (0.05–0.40) | `0.25` |
| `logging.enabled` | Write logs to file | `false` |
| `logging.file` | Log file path (10MB limit, auto-rotated) | `…/logs/memory.log` |
| `compaction.customPrompt` | Use optimized compaction prompt for session continuity | `true` |
| `compaction.inlinePlanning` | Include planning state in compaction context | `true` |
| `compaction.maxContextTokens` | Max tokens for injected memory context | `4000` |
| `compaction.snapshotToKV` | Save pre-compaction snapshot for recovery | `true` |

---

## Architecture

The plugin is composed of several subsystems that work together:

```
┌──────────────────────────────────────────────────┐
│                  Memory Plugin                    │
├─────────┬──────────┬───────────┬─────────────────┤
│  Tools  │  Agents  │   Hooks   │   Compaction    │
├─────────┴──────────┴───────────┴─────────────────┤
│               Memory Service                      │
├──────────────┬────────────────┬───────────────────┤
│  Embedding   │   Vec Search   │   Cache          │
│  Service     │   (sqlite-vec) │   (In-Memory)    │
├──────────────┴────────────────┴───────────────────┤
│              SQLite Database (WAL)                 │
│        memories | session_state | metadata         │
└──────────────────────────────────────────────────┘
```

### Storage Layer

The plugin uses a single SQLite database in WAL mode with three tables:

| Table | Purpose |
|-------|---------|
| `memories` | Stores all memory records with scope, content, access tracking |
| `session_state` | Key-value store for planning state and compaction snapshots with TTL |
| `plugin_metadata` | Tracks the active embedding model and dimensions for drift detection |

SQLite pragmas are tuned for concurrent access:

- `journal_mode=WAL` — concurrent reads during writes
- `busy_timeout=5000` — wait up to 5s on lock contention
- `synchronous=NORMAL` — balanced durability and performance

### Vector Search

Vector similarity search is powered by `sqlite-vec`, a SQLite extension. The vec service:

- Initializes lazily after the database is ready
- Falls back to a no-op service if the extension is unavailable (search still works via exact match, just without semantic ranking)
- Supports insert, delete, search, and similarity-threshold queries
- Scoped by project ID for multi-project isolation

### Embedding Subsystem

The embedding system has three provider types and a shared server architecture:

#### Local Provider

Uses `@huggingface/transformers` to run `all-MiniLM-L6-v2` locally. The model is loaded lazily on first use with a warmup hint at plugin initialization.

#### Shared Embedding Server

When using the `local` provider, the plugin runs a shared Unix socket server (`embedding.sock`) that:

1. Loads the model once into memory
2. Serves embedding requests to multiple plugin instances via Unix domain socket
3. Uses reference counting — clients send `connect`/`disconnect` messages
4. Auto-shuts down after a configurable grace period (default 30s) when the last client disconnects
5. Uses PID files and startup locks to prevent duplicate server instances
6. Falls back to in-process embedding if the server fails to start

This architecture means the model is loaded once regardless of how many OpenCode sessions are running.

#### API Provider

Supports OpenAI and Voyage embedding APIs:

- Batch processing in chunks of 100 texts
- Automatic URL normalization for self-hosted endpoints
- Bearer token authentication

#### Embedding Cache

All embeddings are cached in memory using SHA-256 content hashes. Cache entries expire after 24 hours. This prevents redundant API calls or model inference for identical content.

### Embedding Sync

On startup, the plugin checks for memories that lack embeddings (e.g., from a model change or failed previous embedding) and backfills them automatically:

- Processes in batches of 50
- Retries failed embeddings up to 3 times
- Stops early if an entire batch fails (prevents infinite loops)
- Caps at 100 iterations to bound startup time

### Auto-Validation

After the vec service initializes, the plugin compares the configured embedding model/dimensions against what's stored in `plugin_metadata`. If there's a mismatch (model drift), it automatically triggers a reindex — no manual `memory-health reindex` needed.

---

## Memory Model

### Scopes

Every memory belongs to exactly one scope:

| Scope | Purpose | Examples |
|-------|---------|---------|
| `convention` | Rules and patterns to follow | "Use named imports only", "Tests use describe/it blocks" |
| `decision` | Architectural choices with rationale | "Chose SQLite over PostgreSQL for simplicity" |
| `context` | Reference information | "Entry point is src/index.ts", "Prices stored as integers" |

### Fields

Each memory record contains:

| Field | Description |
|-------|-------------|
| `id` | Auto-incrementing integer primary key |
| `projectId` | The OpenCode project this memory belongs to |
| `scope` | `convention`, `decision`, or `context` |
| `content` | The memory text |
| `filePath` | Optional file path reference |
| `accessCount` | How many times this memory has been read |
| `lastAccessedAt` | Timestamp of last access |
| `createdAt` | Creation timestamp |
| `updatedAt` | Last modification timestamp |

### Deduplication

Before storing a new memory, the plugin:

1. Checks for an exact content match in the same project
2. Computes vector similarity against all existing project memories
3. Skips the write if similarity exceeds `dedupThreshold` (default 0.25)
4. Uses a transaction with double-check locking to prevent race conditions

When deduplication triggers, the existing memory's ID is returned instead of creating a duplicate.

---

## Tools

The plugin registers eight tools that the AI agent can call:

### memory-read

Search and retrieve project memories.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | No | Semantic search query |
| `scope` | enum | No | Filter by `convention`, `decision`, or `context` |
| `limit` | number | No | Max results (default: 10) |

When `query` is provided, results are ranked by vector similarity. Without `query`, memories are listed in chronological order. Access counts are tracked for every read.

### memory-write

Store a new project memory with automatic deduplication.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `content` | string | Yes | The memory content to store |
| `scope` | enum | Yes | `convention`, `decision`, or `context` |

Returns the memory ID and whether deduplication matched an existing memory.

### memory-edit

Update the content or scope of an existing memory. Re-embeds the content if changed.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | number | Yes | Memory ID to update |
| `content` | string | Yes | New content |
| `scope` | enum | No | New scope (keeps existing if omitted) |

### memory-delete

Soft-delete a memory by ID. The memory must exist or an error is returned.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | number | Yes | Memory ID to delete |

### memory-health

Check plugin health or trigger a reindex of all embeddings.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | enum | No | `check` (default) or `reindex` |

**Check** returns:

- Overall status: `ok`, `degraded`, or `error`
- Embedding provider status and operational state
- Shared embedding server status (running, client count, uptime)
- Database health and total memory count
- Configured vs. indexed model comparison
- Whether a reindex is needed

**Reindex** regenerates all embeddings with the configured model:

- Verifies the provider is operational before starting
- Processes memories in batches of 50
- Updates the `plugin_metadata` table on success
- Reports total, success, and failure counts

!!! warning "Model Changes Require Reindex"
    If you change `embedding.model` or `embedding.dimensions`, existing embeddings will have mismatched dimensions. Auto-validation handles this on startup, but you can also trigger it manually with `memory-health reindex`.

### memory-planning-update

Update the session planning state. Uses merge semantics — only updates fields you provide.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sessionID` | string | Yes | The session ID |
| `objective` | string | No | The main task/goal |
| `current` | string | No | Current phase or activity |
| `next` | string | No | What comes next |
| `phases` | array | No | Phase list: `[{title, status, notes?}]` |
| `findings` | array | No | Key discoveries (appended, deduplicated) |
| `errors` | array | No | Errors to avoid (appended, deduplicated) |

Findings and errors use append semantics with deduplication — new entries are added to existing ones rather than replacing them.

### memory-planning-get

Retrieve the current planning state for a session.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sessionID` | string | Yes | The session ID |

Returns a formatted view of the planning state including objective, current phase, phases with status icons (`[x]` completed, `[~]` in progress, `[ ]` pending), findings, and errors.

### memory-plan-execute

Create a new Code session and send an implementation plan as the first prompt. Designed to be called by the Architect agent after the user approves a plan.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `plan` | string | Yes | The full implementation plan to send to the Code agent |
| `title` | string | Yes | Short title for the session (shown in session list, max 60 chars) |

Creates a new session via the OpenCode API, then sends the plan as the first message to the Code agent. Returns the session ID and title. Only the Architect agent has access to this tool — it is excluded from Code and Memory agents.

---

## Planning State

Planning state is separate from memories. It tracks temporary session progress — objectives, phase completion, findings, and blockers.

| Property | Memories | Planning State |
|----------|----------|----------------|
| Persistence | Indefinite | 7-day TTL |
| Scope | Cross-session, semantic search | Single session |
| Purpose | Durable project knowledge | Task progress tracking |
| Cleanup | Manual (delete/archive) | Automatic (expired entries removed every 30 minutes) |
| Compaction snapshot TTL | N/A | 24 hours |

The plugin injects active planning state into compaction context so task progress survives context window resets. After compaction, the Memory agent extracts any durable knowledge from the compaction summary and stores it as memories.

---

## Agents

The plugin registers three agents that are configured into OpenCode:

### Code Agent (primary)

- **Display name:** `Code`
- **Mode:** `primary` (replaces the default agent)
- **Role:** Primary coding agent with memory awareness

The Code agent's system prompt instructs it to:

- Check memory before modifying unfamiliar code areas or making architectural decisions
- Store durable knowledge with rationale (not just "we use X" but "we use X because Y")
- Use the @Memory subagent for complex memory operations (multi-query research, contradiction resolution, bulk curation)
- Check for duplicates with `memory-read` before writing new memories
- Update stale memories with `memory-edit` rather than creating duplicates

The Code agent does not have access to `memory-plan-execute` — only the Architect agent can create implementation sessions.

### Memory Agent (subagent)

- **Display name:** `Memory`
- **Mode:** `subagent`
- **Role:** Institutional memory manager

The Memory agent handles:

- Strategic retrieval across scopes with prioritized results
- Storage with proper scope categorization and rationale
- Contradiction detection between overlapping memories
- Curation: merging duplicates, archiving outdated entries
- Planning state management after compaction events
- Post-compaction knowledge extraction (invoked automatically via SubtaskPart)

The Memory agent receives planning state directly in its subtask prompt — it does NOT call `memory-planning-get`. This eliminates an extra LLM round-trip and makes extraction deterministic.

The Memory agent does not have access to `memory-plan-execute`.

### Architect Agent (primary)

- **Display name:** `Architect`
- **Mode:** `primary` (user-switchable agent, not a subagent)
- **Temperature:** 0.0 (deterministic)
- **Permission:** Read-only — cannot edit any files (`edit: { '*': 'deny' }`)
- **Role:** Memory-aware planning agent

The Architect agent follows a Research → Design → Plan → Execute workflow:

1. **Research** — Reads relevant files, searches the codebase, checks memory for conventions and decisions
2. **Design** — Considers approaches, weighs tradeoffs, asks clarifying questions
3. **Plan** — Presents a structured plan with objectives, phases, decisions, conventions, and key context
4. **Execute** — When the user approves, calls `memory-plan-execute` to create a new Code session with the full plan

The Architect is the only agent with access to the `memory-plan-execute` tool. Plans must be fully self-contained since the Code agent receiving them has no access to the Architect's conversation.

### Built-in Agent Enhancements

The plugin also modifies built-in OpenCode agents:

| Agent | Enhancement |
|-------|-------------|
| `plan` | Gets access to `memory-read`, `memory-planning-update`, and `memory-planning-get` tools |
| `build` | Hidden (replaced by the Code agent) |

The default agent is set to `Code`.

!!! note "Removed Features"
    The following features were removed in a recent refactor:
    - Keyword activation (regex-based detection of "remember this", "recall", etc.)
    - LLM parameter adjustment based on detected modes (temperature, thinking budget, maxSteps)
    - `resumeAfterCompaction` config option

---

## Hooks

The plugin registers several hooks into OpenCode's lifecycle:

### chat.message

- Tracks session initialization (first message per session)

### event

Listens for `session.compacted` events and triggers automatic knowledge extraction:
1. Fetches the last 4 messages from the session to get the compaction summary
2. Retrieves planning state directly from session state service
3. Sends a synchronous prompt() call with a SubtaskPart to run the Memory agent
4. Memory agent receives planning state directly in the subtask prompt (no memory-planning-get call needed)
5. Extraction runs within the main session's prompt loop, keeping session busy

### experimental.session.compacting

The core compaction hook that fires when a session is about to be compacted. It injects context to preserve knowledge across context window resets:

1. **Planning state** — If `inlinePlanning` is enabled, fetches and formats the current session's planning state (objective, phases, findings, errors)

2. **Prior compaction snapshot** — If `snapshotToKV` is enabled, retrieves the previous compaction's snapshot for continuity (timestamp, branch, prior planning state)

3. **Project memories** — Fetches up to 10 conventions and 10 decisions for the project and formats them under `### Conventions` and `### Decisions` headings

4. **Token budgeting** — All sections are trimmed to fit within `maxContextTokens` (default 4000). Sections are prioritized: planning state > prior snapshot > memories. Lower-priority sections are truncated first.

5. **Custom prompt** — If `customPrompt` is enabled, replaces the default compaction prompt with one optimized for continuation context that preserves active tasks, file paths, decisions, and todo state

6. **Snapshot storage** — Saves a pre-compaction snapshot (planning state, branch, timestamp) to session state for the next compaction cycle

7. **Diagnostics** — Appends a summary line showing how many planning phases, conventions, decisions, and tokens were injected

---

## Data Lifecycle

### Startup Sequence

1. Load and validate config from global data directory
2. Create embedding provider (local/API)
3. Warmup embedding provider (non-blocking)
4. Initialize SQLite database with WAL mode
5. Create memory service with no-op vec service
6. Start session state cleanup interval (every 30 min)
7. Delete expired session state entries
8. Initialize vec service asynchronously:
    - If available: sync missing embeddings, auto-validate model drift
    - If unavailable: continue with no-op (semantic search degraded)

### Cleanup

On process exit, `SIGINT`, or `SIGTERM`:

1. Dispose vec service
2. Destroy in-memory cache
3. Dispose embedding provider (disconnect from shared server or release model)
4. Stop session state cleanup interval
5. Close SQLite database

The cleanup function is idempotent — calling it multiple times is safe.

### Data Locations

| File | Location | Purpose |
|------|----------|---------|
| `memory.db` | `{dataDir}/` | SQLite database with all memories and session state |
| `config.json` | `{dataDir}/` | Plugin configuration |
| `embedding.sock` | `{dataDir}/` | Unix socket for shared embedding server |
| `embedding.pid` | `{dataDir}/` | PID file for the embedding server process |
| `embedding.startup.lock` | `{dataDir}/` | Directory-based lock to prevent duplicate server starts |
| `memory.log` | `{dataDir}/logs/` | Debug log (when logging is enabled) |
| `models/` | `{dataDir}/` | Hugging Face model cache for local embeddings |

---

## Troubleshooting

### Plugin shows "degraded" status

The embedding provider is not operational. For local embeddings, the model may not have downloaded. For API providers, check your API key and network connectivity. Run `memory-health` with `action: check` for details.

### Search returns no results

- Verify memories exist with `memory-read` (no query, no scope)
- Check if a reindex is needed: `memory-health check` — look for "Reindex required"
- If using a new model, run `memory-health reindex`

### Embedding server won't start

- Check if another process holds the startup lock: look for `embedding.startup.lock` directory in the data dir
- If stale, delete it manually: `rm -rf ~/.local/share/opencode/memory/embedding.startup.lock`
- Check if the socket file exists but the process is dead: `rm ~/.local/share/opencode/memory/embedding.sock`
- Verify Bun is installed and available on PATH

### Planning state not persisting

Planning state has a 7-day TTL. If the session is older than 7 days, the state has been automatically cleaned up. Compaction snapshots have a shorter 24-hour TTL.

### Memory not injected during compaction

Check that `compaction.customPrompt` and `compaction.inlinePlanning` are both `true` in your config. Verify that memories exist for the project by running `memory-read` without filters.
