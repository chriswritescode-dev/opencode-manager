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

On first run, the plugin copies a bundled `config.jsonc` to the global config directory:

- `~/.config/opencode/memory-config.jsonc`
- Falls back to: `$XDG_CONFIG_HOME/opencode/memory-config.jsonc`

The plugin supports JSONC format, allowing comments with `//` and `/* */`.

The file is only created if it does not already exist. The config is validated on load — if it fails validation, defaults are used automatically. If a config exists at the old location (`~/.local/share/opencode/memory/config.json`), it will be automatically migrated to the new location.

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
  "dedupThreshold": 0.25,
  "logging": {
    "enabled": false,
    "debug": false,
    "file": ""
  },
  "compaction": {
    "customPrompt": true,
    "maxContextTokens": 4000
  },
  "memoryInjection": {
    "enabled": true,
    "debug": false,
    "maxTokens": 2000,
    "cacheTtlMs": 30000
  },
  "messagesTransform": {
    "enabled": true,
    "debug": false
  },
  "executionModel": "",
  "auditorModel": "",
  "loop": {
    "enabled": true,
    "defaultMaxIterations": 15,
    "cleanupWorktree": false,
    "defaultAudit": true,
    "model": "",
    "minAudits": 1,
    "stallTimeoutMs": 60000
  },
  "tui": {
    "sidebar": true,
    "showLoops": true,
    "showVersion": true
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
| `dedupThreshold` | Similarity threshold for deduplication (0.05–0.40) | `0.25` |
| `logging.enabled` | Write logs to file | `false` |
| `logging.debug` | Enable debug-level log output | `false` |
| `logging.file` | Log file path (resolves to `~/.local/share/opencode/memory/logs/memory.log` when empty, 10MB limit, auto-rotated) | — |
| `compaction.customPrompt` | Use optimized compaction prompt for session continuity | `true` |
| `compaction.maxContextTokens` | Max tokens for injected memory context | `4000` |
| `memoryInjection.enabled` | Inject relevant memories into user messages via semantic search | `true` |
| `memoryInjection.debug` | Enable debug logging for memory injection | `false` |
| `memoryInjection.maxResults` | Max vector search results to retrieve | `5` |
| `memoryInjection.distanceThreshold` | Max vector distance for relevance filtering (lower = stricter) | `0.5` |
| `memoryInjection.maxTokens` | Token budget for injected `<project-memory>` block | `2000` |
| `memoryInjection.cacheTtlMs` | Cache TTL (ms) for identical query results | `30000` |
| `messagesTransform.enabled` | Enable the messages transform hook (memory injection + Architect enforcement) | `true` |
| `messagesTransform.debug` | Enable debug logging for messages transform | `false` |
| `executionModel` | Model override for plan execution sessions (`provider/model`). Falls back to OpenCode's default model. | — |
| `loop.enabled` | Enable iterative development loops | `true` |
| `loop.defaultMaxIterations` | Default max iterations (0 = unlimited) | `15` |
| `loop.cleanupWorktree` | Auto-remove worktree on cancel | `false` |
| `loop.defaultAudit` | Run auditor after each coding iteration | `true` |
| `loop.model` | Model override for loop sessions (`provider/model`), falls back to `executionModel` | — |
| `loop.minAudits` | Minimum audit iterations required before completion | `1` |
| `loop.stallTimeoutMs` | Watchdog stall detection timeout (ms) | `60000` |
| `tui.sidebar` | Show the Memory plugin sidebar in the TUI | `true` |
| `tui.showLoops` | Show active loops in the sidebar | `true` |
| `tui.showVersion` | Show version number in sidebar title | `true` |

!!! note "Deprecated Options"
    The `ralph.*` prefix is deprecated but still accepted for backward compatibility. Use `loop.*` instead.
| `auditorModel` | Model override for the auditor agent (`provider/model`). When set, overrides the auditor agent's default model. When not set, the auditor uses the platform default. | — |

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
├──────────────┴────────────────┬───────────────────┤
│   KV Service    │  Loop Service  │  Auto-Cleanup │
│   (TTL state)   │  (loop mgmt)    │  (30min)      │
├─────────────────┴─────────────────┴───────────────┤
│              SQLite Database (WAL)                 │
│   memories | metadata | project_kv (TTL indexed)  │
└──────────────────────────────────────────────────┘
```

### Storage Layer

The plugin uses a single SQLite database in WAL mode with three tables:

| Table | Purpose |
|-------|---------|
| `memories` | Stores all memory records with scope, content, access tracking |
| `plugin_metadata` | Tracks the active embedding model and dimensions for drift detection |
| `project_kv` | Stores ephemeral key-value pairs with TTL expiration (auto-cleaned every 30 minutes) |

SQLite pragmas are tuned for concurrent access:

- `journal_mode=WAL` — concurrent reads during writes
- `busy_timeout=5000` — wait up to 5s on lock contention
- `synchronous=NORMAL` — balanced durability and performance

### KV Store

The KV store provides ephemeral project state management with automatic TTL-based expiration:

- **Key-Value Storage**: Store arbitrary JSON values under string keys, scoped by project ID
- **TTL Management**: Each entry has a configurable expiration time (default 7 days)
- **Auto-Cleanup**: Background cleanup runs every 30 minutes to remove expired entries
- **Graceful Degradation**: `get()` and `list()` methods handle malformed JSON gracefully
- **Use Cases**: Planning progress, code review patterns, session context, temporary state

The KV service is initialized on plugin startup and begins its cleanup interval automatically. Call `kvService.destroy()` during cleanup to stop the interval.

### Loop Service

The loop service manages iterative development loops using the KV store for state persistence:

- **State Management**: Each loop's state is stored in the KV store under `loop:{sessionId}` with fields: `active` (boolean), `sessionId`, `worktreeName`, `worktreeDir`, `worktreeBranch`, `workspaceId`, `iteration`, `maxIterations`, `completionPromise`, `startedAt`, `prompt`, `phase` (coding/auditing), `audit`, `lastAuditResult`, `errorCount`, `auditCount`, `terminationReason`, `completedAt`, `parentSessionId`, `inPlace`
- **Two-Phase Cycle**: Alternates between coding (Code agent works on the task) and auditing (Auditor agent reviews changes). Audit findings feed back into the next coding iteration
- **Completion Criteria**: Requires the `completionPromise` to be detected in `<promise>` tags AND `minAudits` (default 1) audit iterations before marking the loop as completed. Without a `completionPromise`, the loop only terminates via other conditions (max iterations, errors, cancellation, etc.)
- **Error Handling**: Tracks consecutive errors with `MAX_RETRIES` (3). If 3 consecutive iterations fail, the loop terminates with reason `error_max_retries`
- **Worktree Management**: By default creates an isolated git worktree for each loop. Uses `git rev-parse --git-common-dir` to find the main repo root. On completion, auto-commits changes and removes the worktree (preserving the branch). Set `inPlace: true` to skip worktree isolation
- **Termination Reasons**: `completed`, `max_iterations`, `error_max_retries`, `worktree_failed`, `cancelled`, `user_aborted`, `stall_timeout`, `shutdown`

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

The plugin registers twelve tools that the AI agent can call:

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
| `action` | enum | No | `check` (default), `reindex`, or `upgrade` |

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

**Upgrade** installs the latest version of the plugin:

- Checks npm registry for the latest available version
- Installs via `bun add --force --no-cache --exact @opencode-manager/memory@latest`
- Reports the old and new version numbers

!!! warning "Model Changes Require Reindex"
    If you change `embedding.model` or `embedding.dimensions`, existing embeddings will have mismatched dimensions. Auto-validation handles this on startup, but you can also trigger it manually with `memory-health reindex`.

### memory-plan-execute

Create a new Code session and send an implementation plan as the first prompt. Designed to be called by the Architect agent after the user approves a plan.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `plan` | string | Yes | The full implementation plan to send to the Code agent |
| `title` | string | Yes | Short title for the session (shown in session list, max 60 chars) |
| `inPlace` | boolean | No | Execute in the current session as a subtask instead of creating a new session (default: false) |

By default, creates a new session via the OpenCode API and sends the plan as the first message to the Code agent. When `inPlace` is true, switches to the Code agent in the current session instead. Returns the session ID and title. Only the Architect agent has access to this tool — it is excluded from Code and Memory agents.

The model used for execution is determined by `executionModel` in the plugin config (format: `provider/model`, e.g. `anthropic/claude-sonnet-4-20250514`). If not set, OpenCode's default model resolution is used — typically the `model` field from `opencode.json`.

### memory-kv-set

Store a key-value pair for the current project. Values expire after 7 days by default. Use for ephemeral project state like planning progress, code review patterns, or session context.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `key` | string | Yes | The key to store the value under |
| `value` | string | Yes | The value to store (JSON string) |
| `ttlMs` | number | No | Time-to-live in milliseconds (default: 7 days) |

Returns confirmation with the key and expiration timestamp.

### memory-kv-get

Retrieve a value by key for the current project.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `key` | string | Yes | The key to retrieve |

Returns the stored value (formatted as JSON if applicable) or a message indicating the key was not found.

### memory-kv-list

List all active key-value pairs for the current project.

No parameters required.

Returns a list of all stored keys with their values and expiration times. Useful for debugging or inspecting current project state.

### memory-kv-delete

Delete a key-value pair for the current project.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `key` | string | Yes | The key to delete |

### memory-loop-cancel

Cancel an active loop and optionally clean up the worktree.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | No | Worktree name of the loop to cancel (auto-selects if only one active) |

### memory-loop-status

Check the status of loops. With no arguments, lists all active loops for the current project. Pass a worktree name for detailed status.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | No | Worktree name for detailed status |

Returns iteration count, current phase, audit results, model configuration, and termination status.

### memory-loop

Execute an architect plan using an iterative development loop. Designed to be called by the Architect agent after the user approves a plan with the "Loop (worktree)" or "Loop" option.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `plan` | string | Yes | The full implementation plan |
| `title` | string | Yes | Short title for the session |
| `worktree` | boolean | No | Run in isolated git worktree instead of current directory (default: false) |

!!! note "KV Store vs Memory"
    The KV store is designed for **ephemeral** project state that expires automatically (default 7 days). Use `memory-write` for **durable** knowledge that should persist across sessions, such as conventions, decisions, and context.

---

## Workflows

### Architect → Code

The Architect and Code agents work together in a plan-then-execute pattern. The Architect researches and designs; the Code agent implements.

**Steps:**

1. **Switch to the Architect agent** using the agent selector in the chat header
2. **Describe your task** — the Architect researches the codebase, checks memory for conventions and decisions, and designs a plan
3. **Review the plan** — the Architect presents a structured plan with objectives, phases, and decisions for your approval
4. **Approve the plan** — choose an execution mode:
    - **Approve plan** → `memory-plan-execute` creates a new Code session with the plan
    - **Loop (worktree)** → `memory-loop` runs the plan in an isolated worktree with iterative coding/auditing
    - **Loop** → Same as loop but in the current directory (no worktree isolation)
    - **Reject plan** → Cancel
5. **Switch to the new session** — the Code agent executes the plan phase by phase

The Architect operates in read-only mode — it cannot edit files. This separation ensures planning is thorough before any code changes are made.

#### Recommended Model Strategy

Planning requires strong reasoning — use a smart model (e.g., `claude-opus-4-6`) for the Architect session. Code execution is more mechanical — set `executionModel` to a faster, cheaper model (e.g., `claude-haiku-3-5-20241022` or a MiniMax model).

This gives you the best of both worlds: high-quality plans at the reasoning tier, fast execution at a fraction of the cost.

**Configure the execution model** in the memory plugin config (`~/.config/opencode/memory-config.jsonc`):

```json
{
  "executionModel": "anthropic/claude-haiku-3-5-20241022"
}
```

Or set it from the UI: **Settings > Memory Plugin > Execution Model**.

!!! tip "Cost Optimization"
    With this setup, only the planning phase uses the expensive model. The Code session — which typically consumes far more tokens implementing the plan — runs on the cheaper model. The Architect's plan provides enough structure and detail that the Code agent doesn't need the same level of reasoning capability.

### Loop

The loop is an iterative development system that alternates between coding and auditing phases until the task is complete.

#### How It Works

1. A new session is created (in a worktree or in-place)
2. The Code agent receives the task prompt and works on it
3. When the session goes idle, the loop handler checks the phase:
    - **Coding phase** → If auditing is enabled, switches to auditing phase and invokes the Auditor agent as a subtask with a focused review prompt
    - **Auditing phase** → Extracts the auditor's full response as findings, switches back to coding phase, and sends a continuation prompt with the findings
4. **Session rotation** — The current session is destroyed and a fresh one is created. The original task prompt and any audit findings are re-injected as a continuation prompt. This keeps each iteration's context window small and prioritizes speed.
5. The loop repeats until one of these conditions is met:
    - **Completion**: The `completionPromise` phrase is detected in `<promise>` tags AND `minAudits` (default 1) audit iterations have been performed
    - **Max iterations**: Reached `maxIterations` limit (if > 0)
    - **Error limit**: 3 consecutive failures (`MAX_RETRIES`)
    - **Stall timeout**: 5 consecutive stalls detected by the watchdog (`MAX_CONSECUTIVE_STALLS`)
    - **Worktree failure**: The worktree becomes unavailable
    - **Cancelled**: User cancels via `memory-loop-cancel` or `/cancel-loop`
    - **User abort**: Session is aborted

#### Worktree vs In-Place

| Mode | Isolation | Auto-Commit | Cleanup | Permission Scoping |
|------|-----------|-------------|---------|-------------------|
| Worktree (default) | Isolated git worktree | Yes, on completion | Worktree removed, branch preserved | File ops scoped to worktree, git push denied |
| In-place (`inPlace: true`) | None — runs in current directory | No | None | Git push denied only |

#### Session Rotation

Each iteration runs in a **fresh session**. After each phase completes (coding or auditing), the current session is destroyed and a new one is created. This design keeps the context window small across many iterations, reducing token costs and improving speed.

The rotation flow:

1. Create a new session targeting the worktree directory (or current directory for in-place)
2. Update internal session-to-worktree mappings
3. Reset the watchdog stall timer
4. Delete the old session (fire-and-forget)
5. Send a **continuation prompt** to the new session containing:
    - The iteration number and completion signal instructions
    - The original task prompt (verbatim)
    - Audit findings from the previous iteration (if any), with a mandatory instruction to fix all bugs and convention violations

No context is lost — the task and findings are re-injected each iteration. The tradeoff is that the agent loses awareness of its own prior implementation steps, but the code on disk (and any audit findings) provide sufficient continuity.

#### Review Finding Persistence

Audit findings survive session rotation via the **KV store**. This ensures issues are tracked across iterations even as sessions are destroyed and recreated.

**Storage flow** (auditor writes findings):

After each review, the Auditor stores every **bug** and **warning** finding (not suggestions) using `memory-kv-set`:

- **Key:** `review-finding:<file_path>:<line_number>`
- **Value:** JSON object with severity, file, line, description, scenario, status, date, and branch
- The KV store uses upsert semantics — storing the same key updates the existing entry
- Findings expire after 7 days automatically

**Retrieval flow** (auditor reads past findings):

At the start of every review, before analyzing the diff:

1. Retrieve all entries with `memory-kv-list` (prefix `review-finding:`)
2. Match findings against files in the current diff
3. Include unresolved findings under a "Previously Identified Issues" heading
4. Delete resolved findings via `memory-kv-delete`

!!! note
    Finding persistence is enforced via the auditor's system prompt, not application code. The auditor is instructed to use KV tools for storage and retrieval as part of its review workflow.

#### Watchdog and Stall Detection

A watchdog timer monitors each loop for stalls — situations where the session stops producing `session.idle` events within the expected timeframe.

- **`stallTimeoutMs`** (default `60000`): If no activity is detected within this window, the watchdog fires
- On each stall, the watchdog checks the session status and re-triggers the appropriate phase handler
- **`MAX_CONSECUTIVE_STALLS`** (`5`): After 5 consecutive stalls without progress, the loop terminates with reason `stall_timeout`
- The stall counter resets whenever a successful `session.idle` event is processed

#### Tool Blocking

During a loop, certain tools are blocked to keep the agent focused:

- `question` — No interactive questions; work autonomously
- `memory-plan-execute` — Cannot start new plan sessions
- `memory-loop` — Cannot start nested loops

Blocking is enforced via `tool.execute.before` (throws error) with `tool.execute.after` as defense in depth.

#### Model Configuration

| Config Key | Purpose | Fallback |
|------------|---------|----------|
| `loop.model` | Model for loop coding sessions | `executionModel` → platform default |
| `auditorModel` | Model for the auditor agent | Platform default (no fallback chain) |

#### Model Fallback on Error

If the configured model produces a provider, auth, or API error during a loop iteration, the loop automatically falls back to the platform default model for all remaining iterations. This prevents the loop from exhausting retries on a misconfigured or unavailable model.

The fallback is permanent within a loop — once triggered, the `modelFailed` flag is set on the loop state and is never reset. The error count is incremented on each model failure; after 3 consecutive failures (`MAX_RETRIES`), the loop terminates regardless of fallback.

#### Slash Commands

| Command | Description |
|---------|-------------|
| `/loop <prompt>` | Start a loop (delegates to memory-loop) |
| `/cancel-loop` | Cancel the active loop |

---

## Agents

The plugin registers four agents that are configured into OpenCode:

### Code Agent (primary)

- **Display name:** `Code`
- **Mode:** `primary` (replaces the default agent)
- **Role:** Primary coding agent with memory awareness

The Code agent's system prompt instructs it to:

- Check memory before modifying unfamiliar code areas or making architectural decisions
- Store durable knowledge with rationale (not just "we use X" but "we use X because Y")
- Use the @Librarian subagent for complex memory operations (multi-query research, contradiction resolution, bulk curation)
- Check for duplicates with `memory-read` before writing new memories
- Update stale memories with `memory-edit` rather than creating duplicates

### Librarian Agent (subagent)

- **Display name:** `librarian`
- **ID:** `ocm-librarian`
- **Mode:** `subagent`
- **Temperature:** 0.0
- **Role:** Institutional memory manager

The Librarian agent handles:

- Strategic retrieval across scopes with prioritized results
- Storage with proper scope categorization and rationale
- Contradiction detection between overlapping memories
- Curation: merging duplicates, archiving outdated entries
- Post-compaction knowledge extraction (invoked automatically via SubtaskPart)

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
4. **Execute** — When the user approves via the question tool, calls `memory-plan-execute` or `memory-loop` depending on the chosen execution mode.

The Architect is the only agent with access to `memory-plan-execute` and `memory-loop`. Plans must be fully self-contained since the Code agent receiving them has no access to the Architect's conversation.

### Auditor Agent (subagent)

- **Display name:** `auditor`
- **ID:** `ocm-auditor`
- **Mode:** `subagent`
- **Temperature:** 0.0 (deterministic)
- **Role:** Convention-aware code reviewer with memory access

The Auditor agent is a read-only subagent invoked by other agents via the Task tool to review diffs, commits, branches, or PRs. It checks changes against stored project conventions and decisions, then returns a structured review summary with issues (bug/warning/suggestion), observations, and next steps.

The agent can read memory (`memory-read`) but cannot write, edit, or delete memories. It also cannot execute plans — `memory-plan-execute`, `memory-loop`, `memory-health`, `memory-write`, `memory-edit`, and `memory-delete` are excluded.

The Auditor persists review findings to the KV store (key pattern: `review-finding:<file_path>:<line_number>`) and retrieves past findings at the start of every review for continuity. Each finding is a JSON object containing severity, file, line, description, scenario, status, date, and branch. Only bugs and warnings are persisted — suggestions are not stored. Resolved findings are deleted during subsequent reviews. See [Review Finding Persistence](#review-finding-persistence) for the full lifecycle.

The `/review` slash command triggers this agent as a subtask with the template: "Review the current code changes."

### Built-in Agent Enhancements

The plugin also modifies built-in OpenCode agents:

| Agent | Enhancement |
|-------|-------------|
| `plan` | Gets access to `memory-read` tool |
| `build` | Hidden (replaced by the Code agent) |

The default agent is set to `code`.

### Slash Commands

| Command | Description | Agent | Mode |
|---------|-------------|-------|------|
| `/review` | Run a code review on current changes | auditor | subtask |
| `/loop` | Start a loop (delegates to memory-loop) | code | direct |
| `/cancel-loop` | Cancel the active loop | code | direct |

---

## Hooks

The plugin registers several hooks into OpenCode's lifecycle:

### chat.message

- Tracks session initialization (first message per session)

### event

Listens for `session.compacted` events and triggers automatic knowledge extraction:
1. Fetches the last 4 messages from the session to get the compaction summary
2. Sends a synchronous prompt() call with a SubtaskPart to run the Memory agent
3. Extraction runs within the main session's prompt loop, keeping session busy

### experimental.session.compacting

The core compaction hook that fires when a session is about to be compacted. It injects context to preserve knowledge across context window resets:

1. **Project memories** — Fetches up to 10 conventions and 10 decisions for the project and formats them under `### Conventions` and `### Decisions` headings

2. **Token budgeting** — All sections are trimmed to fit within `maxContextTokens` (default 4000). Lower-priority sections are truncated first.

3. **Custom prompt** — If `customPrompt` is enabled, replaces the default compaction prompt with one optimized for continuation context that preserves active tasks, file paths, decisions, and todo state

4. **Diagnostics** — Appends a summary line showing how many conventions, decisions, and tokens were injected

### experimental.chat.messages.transform

Performs two functions on the message array before each LLM inference call:

**Memory Injection** (all agents):

1. Finds the last user message in the message array
2. Extracts all text parts and runs a semantic vector search against stored project memories
3. Filters results by `distanceThreshold` — only memories with distance below the threshold are kept
4. Formats matching memories into a `<project-memory>` block with scope labels (e.g., `[convention]`, `[decision]`)
5. Trims the block to fit within `maxTokens` and appends it as a synthetic text part to the user message
6. Uses SHA-256 content-hash caching (`cacheTtlMs`, default 30s) to avoid redundant vector searches across inference steps

The hook fires on every LLM inference step (including tool-use follow-ups), but since OpenCode re-reads messages from the database each iteration, synthetic parts are ephemeral. The cache ensures the vector search only runs once per unique user message within the TTL window.

Memory injection is controlled independently by `memoryInjection.enabled` (default `true`). Architect read-only enforcement is controlled by `messagesTransform.enabled` (default `true`).

**Architect Read-Only Enforcement** (Architect agent only):

1. Checks if the last user message is addressed to the Architect agent
2. If so, appends a synthetic `<system-reminder>` part enforcing read-only mode
3. This provides message-level enforcement on top of the agent's `edit: { '*': 'deny' }` permission config

### tool.execute.before

Blocks certain tools during active loops to keep the agent focused on the current task. Throws an error with a descriptive message when a blocked tool is called. Blocked tools: `question`, `memory-plan-execute`, `memory-loop`.

### tool.execute.after

Defense-in-depth companion to `tool.execute.before`. If a blocked tool somehow executes during a loop, this hook overrides the output with the denial message.

### permission.ask

Auto-resolves permissions during loops:

- **Deny**: `git push` operations (always denied during loops)
- All other permission requests are passed through to the default handler

### session.idle (event handler)

Drives the iteration loop by listening for `session.idle` events:

1. Checks if the idle session belongs to an active loop
2. Records activity to reset the watchdog stall timer
3. Re-fetches state as a safety check against race conditions
4. Dispatches to the appropriate phase handler:
   - **Coding phase**: If auditing is enabled, switches to auditing phase and runs the Auditor agent as a subtask. Checks for completion promise. Checks max iterations.
   - **Auditing phase**: Processes audit results, increments `auditCount`, switches back to coding phase, sends continuation prompt with findings. Checks for completion promise. Checks max iterations.
5. On completion: auto-commits changes (worktree mode), removes worktree (preserving branch), notifies parent session

### worktree.failed (event handler)

Terminates any loop associated with a failed worktree. Sets the loop status to stopped with reason `worktree_failed`.

---

## Data Lifecycle

### Startup Sequence

1. Load and validate config from global data directory
2. Create embedding provider (local/API)
3. Warmup embedding provider (non-blocking)
4. Initialize SQLite database with WAL mode
5. Create memory service with no-op vec service
6. Initialize KV service and start auto-cleanup interval (30 minutes)
7. Initialize loop service (uses KV store for state persistence)
8. Initialize vec service asynchronously:
    - If available: sync missing embeddings, auto-validate model drift
    - If unavailable: continue with no-op (semantic search degraded)

### Cleanup

On process exit, `SIGINT`, or `SIGTERM`:

1. Stop any active loops
2. Stop KV cleanup interval
3. Dispose vec service
4. Destroy in-memory cache
5. Dispose embedding provider (disconnect from shared server or release model)
6. Close SQLite database

The cleanup function is idempotent — calling it multiple times is safe.

### Data Locations

| File | Location | Purpose |
|------|----------|---------|
| `memory.db` | `{dataDir}/` | SQLite database with all memories |
| `memory-config.jsonc` | `{configDir}/` | Plugin configuration (JSONC format, supports comments) |
| `embedding.sock` | `{dataDir}/` | Unix socket for shared embedding server |
| `embedding.pid` | `{dataDir}/` | PID file for the embedding server process |
| `embedding.startup.lock` | `{dataDir}/` | Directory-based lock to prevent duplicate server starts |
| `memory.log` | `{dataDir}/logs/` | Debug log (when logging is enabled) |
| `models/` | `{dataDir}/` | Hugging Face model cache for local embeddings |

Where `{dataDir}` is `~/.local/share/opencode/memory` (or `$XDG_DATA_HOME/opencode/memory`) and `{configDir}` is `~/.config/opencode` (or `$XDG_CONFIG_HOME/opencode`).

---

## CLI

The plugin includes the `ocm-mem` CLI for managing memories outside of OpenCode sessions. The CLI auto-detects the project ID from git and resolves the database path automatically.

```bash
ocm-mem <command> [options]
```

### Global Options

| Flag | Description |
|------|-------------|
| `--db-path <path>` | Path to memory database |
| `--project, -p <name>` | Project name or SHA (auto-detected from git) |
| `--dir, -d <path>` | Git repo path for project detection |
| `--help, -h` | Show help |

### Commands

| Command | Description |
|---------|-------------|
| `export` | Export memories to file (JSON or Markdown) |
| `import` | Import memories from file |
| `list` | List projects with memory counts |
| `stats` | Show memory statistics for a project |
| `cleanup` | Delete memories by criteria |

### Usage Examples

```bash
# Export all memories as markdown
ocm-mem export --format markdown --output memories.md

# Export filtered by scope
ocm-mem export --project my-project --scope convention

# Import from JSON
ocm-mem import memories.json --project my-project

# Import from Markdown, skip duplicate detection
ocm-mem import memories.md --project my-project --force

# List all projects
ocm-mem list

# Show stats for current project
ocm-mem stats

# Preview cleanup of old memories (dry run)
ocm-mem cleanup --older-than 90 --dry-run

# Delete specific memories
ocm-mem cleanup --ids 1,2,3 --force
```

Run `ocm-mem <command> --help` for full options on each command.

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

### Memory not injected during compaction

Check that `compaction.customPrompt` is `true` in your config. Verify that memories exist for the project by running `memory-read` without filters.
