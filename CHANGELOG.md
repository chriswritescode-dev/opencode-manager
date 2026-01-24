# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.7.4] - 2026-01-24

### Features
- Add OpenCode version selection dialog with version fetching from GitHub API
- Add endpoint to fetch available OpenCode versions
- Add endpoint to install and switch OpenCode versions
- Improve agent configuration management with version control UI

### Bug Fixes
- Agent configuration changes now trigger OpenCode server restart instead of live config patch
- Fix Dockerfile to use latest pnpm version instead of pinned 9.15.0

### Other
## [0.7.2] - 2026-01-23

### Bug Fixes
- Fix git porcelain output parsing and deduplicate staged/unstaged file entries
- Reduce toast notification duration to 2500ms and suppress MessageAbortedError toasts

### Other
- [353b9d4](https://github.com/anomalyco/opencode-manager/commit/353b9d4) - Fix git porcelain output parsing and deduplicate staged/unstaged file entries
- [82ccacb](https://github.com/anomalyco/opencode-manager/commit/82ccacb) - Reduce toast notification duration to 2500ms and suppress MessageAbortedError toasts

## [0.7.1] - 2026-01-22

### Features
- Improve message editing UI with inline edit button and mobile responsiveness
- Add optimistic UI updates for prompt sending

### Bug Fixes
- Fix duplicate logic in message editing
- Fix model store sync with config changes for context usage updates (#75)
- Fix async prompt endpoint to prevent timeout on subagent tasks

### Other
- [b0f67c6](https://github.com/anomalyco/opencode-manager/commit/b0f67c6) - Improve message editing UI with inline edit button and mobile responsiveness
- [023e51d](https://github.com/anomalyco/opencode-manager/commit/023e51d) - Add optimistic UI updates for prompt sending and fix duplicate logic in message editing
- [05af9d9](https://github.com/anomalyco/opencode-manager/commit/05af9d9) - fix: sync model store with config changes for context usage updates (#75)
- [efd3b94](https://github.com/anomalyco/opencode-manager/commit/efd3b94) - fix: use async prompt endpoint to prevent timeout on subagent tasks

## [0.7.0] - 2025-01-20

### Other
- Bump version to 0.7.0
