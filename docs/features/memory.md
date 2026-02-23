# Memory Plugin (Optional)

`@opencode-manager/memory` is an **optional** OpenCode plugin that stores and recalls project knowledge across sessions using vector embeddings and semantic search.

!!! note "Not Required"
    This plugin is entirely optional. OpenCode Manager works fully without it — install it only if you want persistent project knowledge and semantic search capabilities.

!!! tip "Works with Standalone OpenCode"
    This plugin can also be used with standalone OpenCode installations outside of OpenCode Manager. Simply install the package and add it to your `opencode.json` plugins array.

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

## Configuration

On first run, the plugin writes a default config to:

- `~/.local/share/opencode/memory/config.json`
- Falls back to `$XDG_DATA_HOME/opencode/memory/config.json`

The file is only created if it does not already exist.

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

For API-based embeddings:

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

### Options

| Key | Description | Default |
|-----|-------------|---------|
| `embedding.provider` | `local`, `openai`, or `voyage` | `local` |
| `embedding.model` | Model name | `all-MiniLM-L6-v2` |
| `embedding.dimensions` | Vector dimensions (auto-detected for known models) | — |
| `embedding.apiKey` | API key for OpenAI/Voyage | — |
| `embedding.baseUrl` | Custom endpoint for self-hosted services | — |
| `dataDir` | SQLite database directory | `~/.local/share/opencode/memory` |
| `dedupThreshold` | Similarity threshold for deduplication (0.05–0.40) | `0.25` |
| `logging.enabled` | Write logs to file | `false` |
| `logging.file` | Log file path (10MB limit, auto-rotated) | `…/logs/memory.log` |
| `compaction.customPrompt` | Use optimized compaction prompt | `true` |
| `compaction.inlinePlanning` | Include planning state in compaction context | `true` |
| `compaction.maxContextTokens` | Max tokens for injected memory context | `4000` |
| `compaction.snapshotToKV` | Save pre-compaction snapshot for recovery | `true` |

## Memory Model

### Scopes

| Scope | Description |
|-------|-------------|
| `convention` | Coding style rules, naming patterns, workflow preferences |
| `decision` | Architectural choices and their rationale |
| `context` | Project structure, key file locations, domain knowledge, known issues |

### Statuses

| Status | Description |
|--------|-------------|
| `active` | Available for injection and search |
| `archived` | Preserved but excluded from injection |
| `deleted` | Soft-deleted, not returned |

## Tools

The plugin registers seven tools that the AI agent can call directly:

| Tool | Description |
|------|-------------|
| `memory-read` | Search memories by semantic query or list by scope |
| `memory-write` | Store a new memory with a scope |
| `memory-edit` | Update the content or scope of an existing memory |
| `memory-delete` | Soft-delete a memory by ID |
| `memory-health` | Check plugin health or reindex all embeddings |
| `memory-planning-update` | Update session planning state (phases, objectives, progress) |
| `memory-planning-get` | Get the current planning state for a session |

### memory-read

```
query  (optional) - Semantic search query
scope  (optional) - Filter by convention | decision | context
limit  (optional) - Max results (default: 10)
```

When `query` is provided, results are ranked by vector similarity. Without `query`, memories are listed in order.

### memory-write

```
content  - The memory content to store
scope    - convention | decision | context
```

Deduplication runs automatically — if a semantically similar memory already exists, the write is skipped and the existing ID is returned.

### memory-edit

```
id       - Memory ID to update
content  - New content
scope    (optional) - New scope
```

### memory-delete

```
id  - Memory ID to delete
```

### memory-health

```
action  - check (default) | reindex
```

Use `check` to view embedding provider status, database health, memory count, and whether a reindex is needed. Use `reindex` to regenerate all embeddings after changing the model or dimensions.

!!! warning "Model Changes Require Reindex"
    If you change `embedding.model` or `embedding.dimensions`, existing embeddings will have mismatched dimensions and search will fail. Run `memory-health` with `action: reindex` after any model change.

### memory-planning-update

```
sessionID  - The session ID to update
objective  (optional) - The main task/goal
current    (optional) - Current phase or activity
next       (optional) - What comes next
phases     (optional) - Phase list with title, status, and optional notes
findings   (optional) - Key discoveries (appended to existing)
errors     (optional) - Errors to avoid (appended to existing)
```

Merges new fields with existing state. Findings and errors are deduplicated and appended rather than replaced.

### memory-planning-get

```
sessionID  - The session ID to retrieve planning state for
```

Returns the current planning state including objective, phases, findings, and errors.

## Planning State

Planning state is separate from memories. It stores temporary session data — objectives, phase progress, findings, and errors — with a **7-day TTL**. After expiry, planning state is automatically cleaned up.

Use planning state to track multi-step tasks within a session. The plugin injects active planning state into compaction context so progress survives context window resets.

Memories, by contrast, are persisted indefinitely and retrieved via semantic search across all sessions.

## Automatic Extraction

After a session is compacted, the plugin automatically invokes the `ocm - Memory` agent to review the compaction summary and extract durable knowledge using `memory-write`. It checks for duplicates before writing by calling `memory-read` first.

Only persistent knowledge is stored — ephemeral task progress and session-specific notes are skipped.

## Compaction Awareness

When a session compaction is triggered, the plugin injects context into the compaction prompt:

- **Project memories** — up to 10 conventions and 10 decisions are included under a `## Project Memory` section so the AI's summary preserves them
- **Planning state** — active objective, current phase, next steps, and findings are prepended if present
- **Custom compaction prompt** — replaces the default prompt with one optimized for continuation context

A pre-compaction snapshot is also saved to key-value storage for recovery if needed.

## Deduplication

Before storing a new memory, the plugin:

1. Checks for exact content matches
2. Computes vector similarity against existing memories
3. Skips the write if similarity exceeds `dedupThreshold`
