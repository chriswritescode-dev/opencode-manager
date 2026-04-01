# Changelog

All notable changes to this project will be documented in this file.


## [0.0.27]

### Changed

- Renamed "Ralph" to "Loop" across the entire codebase — types (`RalphState` → `LoopState`, `RalphConfig` → `LoopConfig`), services, hooks, filenames, KV keys (`ralph:` → `loop:`), CLI commands, and tests
- Automatic KV key migration from `ralph:` to `loop:` prefixes on plugin startup
- Config backward compatibility: accepts both `loop` and `ralph` keys (prefers `loop`)

### Added

- `stallTimeoutMs` option in default `config.jsonc`
- Automatic session switch when Loop completes — navigates back to parent session without manual intervention
- Memory curation delegation — architect agent can identify problematic memories and delegate fixes to @Librarian subagent during planning

## [0.0.26] - 2026-03-27

### Fixed

- Basic Auth handling in v2 client and CLI `status` command
- `normalizeConfig` bug when processing plugin configuration

## [0.0.25] - 2026-03-25

### Changed

- Refactored Loop session tracking to use KV-backed worktree-keyed session mapping instead of sessionId lookups
- Configurable KV TTL with 7-day default (was 24 hours)

### Added

- `--limit` flag to CLI `status` command

### Fixed

- Loop state type safety and null handling in status commands

## [0.0.23] - 2026-03-24

### Added

- CLI partial-match utility for fuzzy loop name lookup
- Formatting helpers for consistent CLI output (`formatSessionOutput`, `formatAuditResult`)
- Loop session rotation with watchdog-based stall detection and configurable `stallTimeoutMs`
- Loop status dialog and session management improvements

### Changed

- Enhanced CLI `status`, `cancel`, and `list` commands with better UX

## [0.0.22] - 2026-03-22

### Changed

- Removed parent session notification and child session tracking from Loop (sending `promptAsync` to parent sessions on completion could resume previously inactive sessions)
- Simplified Loop event handling by removing child session maps and parent activity recording

## [0.0.20] - 2026-03-20

### Added

- Loop system (`memory-loop`) — iterative development loops with git worktree isolation, automatic session rotation, and optional code auditing between iterations
- `memory-loop-cancel` and `memory-loop-status` tools for managing active loops
- Plan approval interception via `question` tool results — architect agent plans can be approved and dispatched without manual copy-paste
- `memory-plan-execute` `inPlace` parameter for executing plans in the current session directory
- Promise tag stripping utility for cleaning LLM output
- Model fallback utility (`retryWithModelFallback`) for API resilience
- CLI `cancel` and `status` commands for loop management
- Loop service with KV-backed state persistence, stall detection watchdog, and automatic worktree cleanup
- Comprehensive test suites: plan approval, loop lifecycle, tool blocking, promise tag stripping

### Changed

- Migrated plugin config from JSON to JSONC format (`config.json` → `config.jsonc`)
- Upgraded `@opencode-ai/sdk` dependency and introduced v2 client for session/worktree APIs
- Agent prompts updated with shared prompt utilities

## [0.0.18] - 2026-03-08

### Added

- `memory-health` upgrade action with npm version check and 1-hour cache
- CLI `upgrade` command for self-updating the plugin
- `memory-kv-delete` tool for removing KV entries

### Changed

- Renamed agent files to lowercase conventions (`code-review.ts` → `auditor.ts`, `memory.ts` → `librarian.ts`)
- Simplified KV service lifecycle management
- Added memory curation guideline to architect agent prompt

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
