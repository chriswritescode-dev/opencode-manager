<h1 align="center">@opencode-manager/memory</h1>

<p align="center">
  <strong>Semantic memory and planning plugin for <a href="https://opencode.ai">OpenCode</a> AI agents</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@opencode-manager/memory"><img src="https://img.shields.io/npm/v/@opencode-manager/memory" alt="npm" /></a>
  <a href="https://www.npmjs.com/package/@opencode-manager/memory"><img src="https://img.shields.io/npm/dm/@opencode-manager/memory" alt="npm downloads" /></a>
  <a href="https://github.com/chriswritescode-dev/opencode-manager/blob/main/LICENSE"><img src="https://img.shields.io/github/license/chriswritescode-dev/opencode-manager" alt="License" /></a>
</p>

## Quick Start

```bash
pnpm add @opencode-manager/memory
```

Add to your `opencode.json`:

```json
{
  "plugin": ["@opencode-manager/memory@latest"]
}
```

The local embedding model downloads automatically on install. For API-based embeddings (OpenAI or Voyage), see [Configuration](#configuration).

## Features

- **Semantic Memory Search** - Store and retrieve project memories using vector embeddings
- **Multiple Memory Scopes** - Categorize memories as convention, decision, or context
- **Automatic Deduplication** - Prevents duplicates via exact match and semantic similarity detection
- **Compaction Context Injection** - Injects conventions and decisions into session compaction for seamless continuity
- **Automatic Memory Injection** - Injects relevant project memories into user messages via semantic search with distance filtering and caching
- **Project KV Store** - Ephemeral key-value storage with TTL management for project state
- **Bundled Agents** - Ships with Code, Architect, and Librarian agents preconfigured for memory-aware workflows
- **CLI Tools** - Export, import, list, stats, and cleanup commands via `ocm-mem` binary
- **Dimension Mismatch Detection** - Detects embedding model changes and guides recovery via reindex

## Agents

The plugin bundles four agents that integrate with the memory system:

| Agent | ID | Mode | Description |
|-------|----|------|-------------|
| **code** | `ocm-code` | primary | Primary coding agent with memory awareness. Checks memory before unfamiliar code, stores architectural decisions and conventions as it works. Delegates planning operations to @librarian subagent. |
| **architect** | `ocm-architect` | primary | Read-only planning agent. Researches the codebase, delegates to @librarian for broad knowledge retrieval, designs implementation plans, then hands off to code via `memory-plan-execute`. |
| **librarian** | `ocm-librarian` | subagent | Expert agent for managing project memory. Handles post-compaction memory extraction and contradiction resolution. |
| **auditor** | `ocm-auditor` | subagent | Read-only code auditor with access to project memory for convention-aware reviews. Invoked via Task tool to review diffs, commits, branches, or PRs against stored conventions and decisions. |

The auditor agent is a read-only subagent (`temperature: 0.0`) that can read memory but cannot write, edit, or delete memories or execute plans. It is invoked by other agents via the Task tool to review code changes against stored project conventions and decisions.

The architect agent operates in read-only mode (`temperature: 0.0`, all edits denied) with additional message-level read-only enforcement via the `experimental.chat.messages.transform` hook. After the user approves a plan, it calls `memory-plan-execute` which creates a new code session with the full plan as context.

## Tools

### Memory Tools

| Tool | Description |
|------|-------------|
| `memory-read` | Search and retrieve project memories with semantic search |
| `memory-write` | Store a new project memory |
| `memory-edit` | Update an existing project memory |
| `memory-delete` | Delete a project memory by ID |
| `memory-health` | Health check or full reindex of the memory store |
| `memory-plan-execute` | Create a new Code session and send an approved plan as the first prompt |

### Project KV Tools

Ephemeral key-value storage for project state with automatic TTL-based expiration.

| Tool | Description |
|------|-------------|
| `memory-kv-set` | Store a value with optional TTL (default 24 hours) |
| `memory-kv-get` | Retrieve a value by key |
| `memory-kv-list` | List all active KV entries for the project |

## CLI

Manage memories using the `ocm-mem` CLI. The CLI auto-detects the project ID from git and resolves the database path automatically.

```bash
ocm-mem <command> [options]
```

**Global options** (apply to all commands):

| Flag | Description |
|------|-------------|
| `--db-path <path>` | Path to memory database |
| `--project, -p <name>` | Project name or SHA (auto-detected from git) |
| `--dir, -d <path>` | Git repo path for project detection |
| `--help, -h` | Show help |

### Commands

#### export

Export memories to file (JSON or Markdown).

```bash
ocm-mem export --format markdown --output memories.md
ocm-mem export --project my-project --scope convention
ocm-mem export --limit 50 --offset 100
```

| Flag | Description |
|------|-------------|
| `--format, -f` | Output format: `json` or `markdown` (default: `json`) |
| `--output, -o` | Output file path (prints to stdout if omitted) |
| `--scope, -s` | Filter by scope: `convention`, `decision`, or `context` |
| `--limit, -l` | Max number of memories (default: `1000`) |
| `--offset` | Pagination offset (default: `0`) |

#### import

Import memories from file.

```bash
ocm-mem import memories.json --project my-project
ocm-mem import memories.md --project my-project --force
```

| Flag | Description |
|------|-------------|
| `--format, -f` | Input format: `json` or `markdown` (auto-detected from extension) |
| `--force` | Skip duplicate detection and import all |

#### list

List all projects with memory counts.

```bash
ocm-mem list
```

#### stats

Show memory statistics for a project (scope breakdown).

```bash
ocm-mem stats
ocm-mem stats --project my-project
```

#### cleanup

Delete memories by criteria.

```bash
ocm-mem cleanup --older-than 90
ocm-mem cleanup --ids 1,2,3 --force
ocm-mem cleanup --scope context --dry-run
ocm-mem cleanup --all --project my-project
```

| Flag | Description |
|------|-------------|
| `--older-than <days>` | Delete memories older than N days |
| `--ids <id,id,...>` | Delete specific memory IDs |
| `--scope <scope>` | Filter by scope: `convention`, `decision`, or `context` |
| `--all` | Delete all memories for the project |
| `--dry-run` | Preview what would be deleted without deleting |
| `--force` | Skip confirmation prompt |

## Configuration

On first run, the plugin automatically copies the bundled config to your data directory:
- Path: `~/.local/share/opencode/memory/config.json`
- Falls back to: `$XDG_DATA_HOME/opencode/memory/config.json`

You can edit this file to customize settings. The file is created only if it doesn't already exist.

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
  "executionModel": ""
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

### Options

#### Embedding
- `embedding.provider` - Embedding provider: `"local"`, `"openai"`, or `"voyage"`
- `embedding.model` - Model name
  - local: `"all-MiniLM-L6-v2"` (384d)
  - openai: `"text-embedding-3-small"` (1536d), `"text-embedding-3-large"` (3072d), or `"text-embedding-ada-002"` (1536d)
  - voyage: `"voyage-code-3"` (1024d) or `"voyage-2"` (1536d)
- `embedding.dimensions` - Vector dimensions (optional, auto-detected for known models)
- `embedding.apiKey` - API key for openai/voyage providers
- `embedding.baseUrl` - Custom endpoint (optional, defaults to provider's official API)

#### Storage
- `dataDir` - Directory for SQLite database storage (default: `"~/.local/share/opencode/memory"`)
- `dedupThreshold` - Similarity threshold for deduplication (0–1, default: `0.25`, clamped to `0.05–0.40`)

#### Logging
- `logging.enabled` - Enable file logging (default: `false`)
- `logging.debug` - Enable debug-level log output (default: `false`)
- `logging.file` - Log file path. When empty, resolves to `~/.local/share/opencode/memory/logs/memory.log` (default: `""`)

When enabled, logs are written to the specified file with timestamps. The log file has a 10MB size limit with automatic rotation.

#### Compaction
- `compaction.customPrompt` - Use a custom compaction prompt optimized for session continuity (default: `true`)
- `compaction.maxContextTokens` - Token budget for injected memory context with priority-based trimming (default: `4000`)

#### Memory Injection
- `memoryInjection.enabled` - Inject relevant project memories into user messages via semantic search (default: `true`)
- `memoryInjection.debug` - Enable debug logging for memory injection (default: `false`)
- `memoryInjection.maxResults` - Maximum number of vector search results to retrieve (default: `5`)
- `memoryInjection.distanceThreshold` - Maximum vector distance for a memory to be considered relevant; lower values are stricter (default: `0.5`)
- `memoryInjection.maxTokens` - Token budget for the injected `<project-memory>` block (default: `2000`)
- `memoryInjection.cacheTtlMs` - How long (ms) to cache results for identical queries (default: `30000`)

#### Messages Transform
- `messagesTransform.enabled` - Enable the messages transform hook that handles memory injection and Architect read-only enforcement (default: `true`)
- `messagesTransform.debug` - Enable debug logging for messages transform (default: `false`)

#### Execution
- `executionModel` - Model override for plan execution sessions, format: `provider/model` (e.g. `anthropic/claude-haiku-3-5-20241022`). When set, `memory-plan-execute` uses this model for the new Code session. When empty or omitted, OpenCode's default model is used (typically the `model` field from `opencode.json`). **Recommended:** Set this to a fast, cheap model (e.g. Haiku or MiniMax) and use a smart model (e.g. Opus) for the Architect session — planning needs reasoning, execution needs speed.

## architect → code Workflow

Plan with a smart model, execute with a fast model. The architect agent researches and designs; the code agent implements.

Set `executionModel` in your config to a fast model (e.g., Haiku) and use a smart model (e.g., Opus) for the architect session.

See the [full workflow guide](https://chriswritescode-dev.github.io/opencode-manager/features/memory/#architect--code) for setup details.

## Documentation

Full documentation available at [chriswritescode-dev.github.io/opencode-manager/features/memory](https://chriswritescode-dev.github.io/opencode-manager/features/memory/)

## Development

```bash
pnpm build      # Compile TypeScript to dist/
pnpm test       # Run tests
pnpm typecheck  # Type check without emitting
```

## License

MIT
