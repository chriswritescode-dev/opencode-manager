# @opencode-manager/memory

Memory management plugin for OpenCode that enables semantic search and persistent storage of project knowledge.

## Features

- **Semantic Memory Search** - Store and retrieve project memories using vector embeddings
- **Multiple Memory Scopes** - Categorize memories as convention, decision, or context
- **Automatic Deduplication** - Prevents duplicate memories from being stored
- **Session Context** - Tracks session state and injects relevant memories during compaction

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

Planning state differs from memories: it stores temporary session data (objectives, phase progress, findings, errors) with a 7-day TTL, while memories are persisted indefinitely and retrieved via semantic search.

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

## Development

```bash
pnpm build      # Compile TypeScript to dist/
pnpm test       # Run tests
pnpm typecheck  # Type check without emitting
```
