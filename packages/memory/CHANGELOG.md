# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.16] - 2026-03-07

### Added

- Project KV store for ephemeral project state with TTL management
- `memory-kv-set`, `memory-kv-get`, `memory-kv-list` tools for managing project state
- Automatic cleanup of expired KV entries (30-minute interval)
- Default 24-hour TTL for KV entries

### Fixed

- KV `list()` method now handles malformed JSON data gracefully instead of throwing, consistent with `get()` behavior

## [0.0.12] - 2026-03-05

### Added

- `experimental.chat.messages.transform` hook: automatically injects project conventions and decisions into system prompts for every LLM call, with configurable token budget and caching
- Skill tool awareness in code and architect agent prompts
- `plan_enter` permission on code agent for switching to architect mode
- `memory-edit` documentation in Librarian agent's tool list
- Agent name logging in all tool handlers via new ToolContext.agent field

### Changed

- Upgraded `@opencode-ai/plugin` from ^1.2.9 to ^1.2.16
- Renamed deprecated `maxSteps` to `steps` in AgentDefinition and AgentConfig types

### Fixed

- Librarian agent tool documentation now lists all 7 available tools (was missing memory-edit)

## [0.0.9] - 2026-02-27

### Added

- `experimental.chat.messages.transform` hook that injects read-only enforcement reminder into architect agent sessions, preventing file edits and non-readonly tool usage at the message level
- auditor agent (`ocm-auditor`) — read-only subagent for convention-aware code reviews with memory integration, invoked via Task tool
- `/review` command that triggers the auditor agent to review current changes

### Changed

- Restricted `memory-planning-update` and `memory-planning-search` tools to librarian subagent only — code and architect agents now delegate planning operations via @librarian Task tool
- Overhauled code and architect agent system prompts with tone/style guidelines, tool usage policies, task management instructions, and planning state delegation patterns
- `memory-plan-execute` now accepts optional `objective`, `phases`, and `findings` parameters and saves planning state inline before dispatching the plan, eliminating the need for a separate `memory-planning-update` call
- Planning instruction appended to dispatched plans now directs code agent to delegate planning updates to @librarian subagent
- Updated librarian agent description to include planning state and session progress management
- Updated auditor agent description to accurately reflect its capabilities

## [0.0.6] - 2026-02-24

### Added

- Core memory tools: `memory-read`, `memory-write`, `memory-edit`, `memory-delete`, `memory-health`
- Planning state tools: `memory-planning-update` and `memory-planning-get` for tracking session objectives, phases, findings, and errors
- `memory-plan-execute` tool for creating new Code sessions with approved implementation plans
- Three embedding providers: local (`all-MiniLM-L6-v2`), OpenAI (`text-embedding-3-small/large`, `ada-002`), and Voyage (`voyage-code-3`, `voyage-2`)
- Bundled code agent (`ocm-code`) with memory-aware coding workflows
- Bundled architect agent (`ocm-architect`) for read-only planning with automatic plan handoff
- Bundled librarian agent (`ocm-librarian`) for expert knowledge curation and post-compaction extraction
- Compaction context injection with custom prompt, planning state, conventions, and decisions
- Configurable compaction settings: custom prompt, inline planning, token budget, snapshot storage
- CLI export/import for backing up and migrating memories as JSON or Markdown
- Embedding cache with SHA-256 keying and 24-hour TTL
- Embedding sync service with batch processing and retry logic
- Session state KV store with TTL management (7-day planning, 24-hour snapshots)
- Automatic deduplication via exact match and semantic similarity detection
- Dimension mismatch detection on startup with guided recovery via reindex
- Build-time version injection displayed in `memory-health` output
- Automatic model download via `postinstall` script
- Auto-copy of bundled config on first run
- SQLite storage with `sqlite-vec` for vector similarity search
