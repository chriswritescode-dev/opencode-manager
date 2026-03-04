# @opencode-manager/memory

Memory management plugin for OpenCode that enables semantic search and persistent storage of project knowledge.

## Features

- **Semantic Memory Search** - Store and retrieve project memories using vector embeddings
- **Multiple Memory Scopes** - Categorize memories as convention, decision, or context
- **Automatic Deduplication** - Prevents duplicates via exact match and semantic similarity detection
- **Compaction Context Injection** - Injects planning state, conventions, and decisions into session compaction for seamless continuity
- **Bundled Agents** - Ships with Code, Architect, and Memory agents preconfigured for memory-aware workflows
- **CLI Tools** - Export, import, list, stats, and cleanup commands via `ocm-mem` binary
- **Dimension Mismatch Detection** - Detects embedding model changes and guides recovery via reindex
- **Session Planning** - Tracks objectives, phases, findings, and errors across sessions with automatic TTL cleanup

## Tools

| Tool | Description |
|------|-------------|
| `memory-read` | Search and retrieve project memories with semantic search |
| `memory-write` | Store a new project memory |
| `memory-edit` | Update an existing project memory |
| `memory-delete` | Delete a project memory by ID |
| `memory-health` | Health check or full reindex of the memory store |
| `memory-planning-update` | Update session planning state (phases, objectives, progress) |
| `memory-planning-get` | Get the current planning state for a session |
| `memory-plan-execute` | Create a new Code session, save planning state, and send an approved plan as the first prompt |

Planning state differs from memories: it stores temporary session data (objectives, phase progress, findings, errors) with a 7-day TTL, while memories are persisted indefinitely and retrieved via semantic search.

## Agents

The plugin bundles four agents that integrate with the memory system:

| Agent | ID | Mode | Description |
|-------|----|------|-------------|
| **Code** | `ocm-code` | primary | Primary coding agent with memory awareness. Checks memory before unfamiliar code, stores architectural decisions and conventions as it works. Delegates planning operations to @Memory subagent. |
| **Architect** | `ocm-architect` | primary | Read-only planning agent. Researches the codebase, delegates to @Memory for broad knowledge retrieval, designs implementation plans, then hands off to Code via `memory-plan-execute`. |
| **Memory** | `ocm-memory` | subagent | Expert agent for managing project memory and planning state. Handles post-compaction memory extraction, contradiction resolution, planning state updates, and cross-session plan searches. |
| **Code Review** | `ocm-code-review` | subagent | Read-only code reviewer with access to project memory for convention-aware reviews. Invoked via Task tool to review diffs, commits, branches, or PRs against stored conventions and decisions. |

The Code Review agent is a read-only subagent (`temperature: 0.0`) that can read memory but cannot write, edit, or delete memories or execute plans. It is invoked by other agents via the Task tool to review code changes against stored project conventions and decisions.

The Architect agent operates in read-only mode (`temperature: 0.0`, all edits denied) with additional message-level read-only enforcement via the `experimental.chat.messages.transform` hook. After the user approves a plan, it calls `memory-plan-execute` which saves planning state and creates a new Code session with the full plan as context. Code and Architect agents delegate `memory-planning-update` and `memory-planning-search` to the Memory subagent.

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

List all projects with memory and session state counts.

```bash
ocm-mem list
```

#### stats

Show memory statistics for a project (scope breakdown, session state counts).

```bash
ocm-mem stats
ocm-mem stats --project my-project
```

#### cleanup

Delete memories or session states by criteria.

```bash
ocm-mem cleanup --older-than 90
ocm-mem cleanup --ids 1,2,3 --force
ocm-mem cleanup --scope context --dry-run
ocm-mem cleanup --sessions --older-than 30
ocm-mem cleanup --all --project my-project
```

| Flag | Description |
|------|-------------|
| `--older-than <days>` | Delete memories older than N days |
| `--ids <id,id,...>` | Delete specific memory IDs |
| `--scope <scope>` | Filter by scope: `convention`, `decision`, or `context` |
| `--sessions` | Clean up session states instead of memories |
| `--all` | Delete all memories for the project |
| `--dry-run` | Preview what would be deleted without deleting |
| `--force` | Skip confirmation prompt |

## Installation

Install the package from npm:

```bash
npm install @opencode-manager/memory
# or
pnpm add @opencode-manager/memory
```

During installation, the local embedding model (`all-MiniLM-L6-v2`) is downloaded automatically via the `postinstall` script. For API-based embeddings (OpenAI or Voyage), skip the local model and set your provider and API key in the configuration instead.

Then configure opencode to load the plugin. In your `opencode.json`:

```json
{
  "plugin": ["@opencode-manager/memory"]
}
```

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
    "dimensions": 384
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
- `logging.file` - Log file path (default: `"~/.local/share/opencode/memory/logs/memory.log"`)

When enabled, logs are written to the specified file with timestamps. The log file has a 10MB size limit with automatic rotation.

#### Compaction
- `compaction.customPrompt` - Use a custom compaction prompt optimized for session continuity (default: `true`)
- `compaction.inlinePlanning` - Inject planning state (phases, objectives, progress) into compaction context (default: `true`)
- `compaction.maxContextTokens` - Token budget for injected memory context with priority-based trimming (default: `4000`)
- `compaction.snapshotToKV` - Store compaction snapshots in the session KV store for recovery (default: `true`)

#### Execution
- `executionModel` - Model override for plan execution sessions, format: `provider/model` (e.g. `anthropic/claude-sonnet-4-20250514`). When set, `memory-plan-execute` uses this model for the new Code session. When empty or omitted, OpenCode's default model is used (typically the `model` field from `opencode.json`).

## Development

```bash
pnpm build      # Compile TypeScript to dist/
pnpm test       # Run tests
pnpm typecheck  # Type check without emitting
```
