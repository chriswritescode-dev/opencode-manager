# Feature: Native Telegram Integration

Issue: #97 https://github.com/chriswritescode-dev/opencode-manager/issues/97
Branch: feature/issue-97-telegram-integration
Started: 2026-01-29

## Goal

Integrate Telegram bot directly into opencode-manager so it starts automatically when `TELEGRAM_BOT_TOKEN` is configured, eliminating the need for external owpenbot.

## Tasks

- [x] Task 1: Create feature branch
- [x] Task 2: Add grammy dependency
- [x] Task 3: Add database tables for Telegram
- [x] Task 4: Create Telegram service
- [ ] Task 5: Add Telegram config to settings schema (skipped - using env vars)
- [x] Task 6: Create Telegram API routes
- [x] Task 7: Auto-start Telegram on backend startup
- [x] Task 8: Add Telegram status to health endpoint
- [x] Task 9: Write unit tests for Telegram service
- [ ] Task 10: Write integration tests (E2E test script) - future work
- [x] Task 11: Update docs/requirements.md
- [x] Task 12: Run all tests and verify
- [x] Task 13: Create PR - https://github.com/chriswritescode-dev/opencode-manager/pull/98

## Architecture

```
┌─────────────┐     ┌──────────────────────────────────────┐
│  Telegram   │────▶│         opencode-manager             │
│   User      │◀────│  ┌──────────┐    ┌──────────────┐   │
└─────────────┘     │  │ Telegram │───▶│   OpenCode   │   │
                    │  │ Service  │◀───│   SDK Client │   │
                    │  └──────────┘    └──────────────┘   │
                    └──────────────────────────────────────┘
```

## Database Schema

```sql
CREATE TABLE telegram_sessions (
  id INTEGER PRIMARY KEY,
  chat_id TEXT UNIQUE NOT NULL,
  opencode_session_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE telegram_allowlist (
  id INTEGER PRIMARY KEY,
  chat_id TEXT UNIQUE NOT NULL,
  added_at INTEGER NOT NULL
);
```

## API Endpoints

- GET /api/telegram/status - Bot status, chat count
- POST /api/telegram/start - Start bot manually
- POST /api/telegram/stop - Stop bot
- GET /api/telegram/sessions - List active sessions
- POST /api/telegram/allowlist - Add to allowlist
- DELETE /api/telegram/allowlist/:chatId - Remove from allowlist

## Environment Variables

- `TELEGRAM_BOT_TOKEN` - Bot token from @BotFather (triggers auto-start)
- `TELEGRAM_ALLOWLIST` - Optional comma-separated chat IDs

## Key Patterns from owpenbot Research

1. **Session queue** - Prevent race conditions per chat
2. **Text chunking** - 4096 char limit for Telegram
3. **Typing indicator** - Show activity while processing
4. **Allowlist** - Optional access control
5. **grammy long-polling** - No webhooks needed

## Completed

- [x] Task 1: Created branch `feature/issue-97-telegram-integration`
- [x] Task 2: Added grammy dependency to backend
- [x] Task 3: Added telegram_sessions and telegram_allowlist tables in migrations.ts
- [x] Task 4: Created backend/src/services/telegram.ts with:
  - Bot lifecycle (start/stop)
  - Message handling with typing indicator
  - Session persistence per chat
  - Allowlist access control
  - Message queuing to prevent race conditions
  - Text chunking for 4096 char limit
- [x] Task 6: Created backend/src/routes/telegram.ts with all API endpoints
- [x] Task 7: Added auto-start in index.ts when TELEGRAM_BOT_TOKEN is set
- [x] Task 8: Added telegram status to /api/health response
- [x] Task 9: Created unit tests:
  - backend/test/services/telegram.test.ts (26 tests)
  - backend/test/routes/telegram.test.ts (18 tests)
  - Total: 44 new tests, 147 tests overall
- [x] Task 11: Updated docs/requirements.md with native Telegram integration
- [x] Task 12: All 147 tests passing

## Test Summary

| File | Tests |
|------|-------|
| test/services/telegram.test.ts | 26 |
| test/routes/telegram.test.ts | 18 |
| test/services/scheduler.test.ts | 35 |
| test/routes/tasks.test.ts | 27 |
| test/routes/tts.test.ts | 11 |
| test/db/queries.test.ts | 10 |
| test/utils/helpers.test.ts | 13 |
| test/services/terminal.test.ts | 6 |
| test/services/repo-auth-env.test.ts | 1 |
| **Total** | **147** |
