# Memory Plugin

`@opencode-manager/memory` is an **optional** OpenCode plugin that stores and recalls project knowledge across sessions using vector embeddings and semantic search.

[![npm](https://img.shields.io/npm/v/@opencode-manager/memory)](https://www.npmjs.com/package/@opencode-manager/memory)

!!! note "Not Required"
    This plugin is entirely optional. OpenCode Manager works fully without it — install it only if you want persistent project knowledge and semantic search capabilities.

!!! tip "Works with Standalone OpenCode"
    This plugin can also be used with standalone OpenCode installations outside of OpenCode Manager. Simply install the package and add it to your `opencode.json` plugins array.

!!! info "Standalone Repository"
    The memory plugin has moved to its own repository. For complete documentation including configuration, tools, agents, CLI reference, loops, and Docker sandbox, visit the **[opencode-memory repository](https://github.com/chriswritescode-dev/opencode-memory)**.

---

## Installation

```bash
pnpm add @opencode-manager/memory
```

Register the plugin in your `opencode.json`:

```json
{
  "plugin": ["@opencode-manager/memory"]
}
```

The local embedding model downloads automatically on install. For API-based embeddings (OpenAI or Voyage), see the [configuration reference](https://github.com/chriswritescode-dev/opencode-memory#configuration).

---

## Features

- **Semantic Memory Search** — Store and retrieve project memories using vector embeddings
- **Multiple Memory Scopes** — Categorize memories as convention, decision, or context
- **Automatic Deduplication** — Prevents duplicates via exact match and semantic similarity
- **Compaction Context Injection** — Injects conventions and decisions into session compaction
- **Automatic Memory Injection** — Injects relevant memories into user messages via semantic search
- **Project KV Store** — Ephemeral key-value storage with TTL management
- **Bundled Agents** — Code, Architect, Auditor, and Librarian agents preconfigured for memory-aware workflows
- **CLI Tools** — Export, import, list, stats, cleanup, upgrade, status, and cancel via `ocm-mem`
- **Iterative Development Loops** — Autonomous coding/auditing loop with worktree isolation and session rotation
- **Docker Sandbox** — Run loops inside isolated Docker containers
- **TUI Sidebar** — Monitor loops and memory status directly in the OpenCode terminal interface

---

## Configuration

The plugin configuration lives at `~/.config/opencode/memory-config.jsonc`. It is created automatically on first run.

For the full configuration reference including embedding providers, loop settings, sandbox options, and more, see the [standalone repository README](https://github.com/chriswritescode-dev/opencode-memory#configuration).

---

## OpenCode Manager Integration

When the memory plugin is installed, OpenCode Manager's web UI provides:

- **Memory Browser** — View, search, create, edit, and delete project memories
- **Loop Status** — Monitor active development loops and their progress
- **Plugin Configuration** — Enable/disable the plugin and adjust settings
- **KV Store Viewer** — Browse ephemeral key-value entries

---

## Links

- **GitHub**: [chriswritescode-dev/opencode-memory](https://github.com/chriswritescode-dev/opencode-memory)
- **npm**: [@opencode-manager/memory](https://www.npmjs.com/package/@opencode-manager/memory)
