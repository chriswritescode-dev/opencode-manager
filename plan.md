# Feature: Scheduled Tasks

Issue: #16 https://github.com/dzianisv/opencode-manager/issues/16
Branch: feature/issue-16-scheduled-tasks
Started: 2025-01-29

## Goal

Allow users to schedule recurring tasks (like running a specific skill) directly from the opencode-manager interface. Replaces manual cron jobs with better visibility into task execution history.

## Tasks

- [ ] Task 1: Install node-cron dependency
- [ ] Task 2: Add database schema for scheduled_tasks table
- [ ] Task 3: Create SchedulerService (backend/src/services/scheduler.ts)
- [ ] Task 4: Add task routes (backend/src/routes/tasks.ts)
- [ ] Task 5: Wire up scheduler in backend/src/index.ts
- [ ] Task 6: Create frontend API client methods
- [ ] Task 7: Build TasksPage component
- [ ] Task 8: Add to router/navigation
- [ ] Task 9: Test end-to-end
- [ ] Task 10: Update documentation

## Database Schema

```sql
CREATE TABLE IF NOT EXISTS scheduled_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  schedule_type TEXT NOT NULL, -- 'cron'
  schedule_value TEXT NOT NULL, -- e.g., '0 9 * * *'
  command_type TEXT NOT NULL, -- 'skill', 'script'
  command_config TEXT NOT NULL, -- JSON: { "skillName": "recruiter-response", "args": {} }
  status TEXT NOT NULL DEFAULT 'active', -- 'active', 'paused'
  last_run_at INTEGER,
  next_run_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

## API Endpoints

- GET /api/tasks - List all tasks
- POST /api/tasks - Create a new task
- PUT /api/tasks/:id - Update a task
- DELETE /api/tasks/:id - Delete a task
- POST /api/tasks/:id/toggle - Pause/Resume
- POST /api/tasks/:id/run - Trigger immediately

## Implementation Notes

### SchedulerService
- Singleton class
- On startup: load all active tasks from DB
- Register node-cron jobs for each task
- On trigger: execute command, update last_run_at/next_run_at
- Methods: createTask, updateTask, deleteTask, pauseTask, resumeTask, runTaskNow

### Command Types
- `skill`: Run opencode skill (e.g., `opencode skill recruiter-response`)
- `script`: Run arbitrary script (future)

## Completed

- [x] Task 1: Install node-cron dependency
  - Commit: (pending)
  - Added node-cron and @types/node-cron to backend/package.json

- [x] Task 2: Add database schema for scheduled_tasks table
  - Updated backend/src/db/schema.ts and migrations.ts

- [x] Task 3: Create SchedulerService (backend/src/services/scheduler.ts)
  - Created full scheduler service with cron job management
  - Supports skill, opencode-run, and script command types

- [x] Task 4: Add task routes (backend/src/routes/tasks.ts)
  - CRUD endpoints + toggle + run now

- [x] Task 5: Wire up scheduler in backend/src/index.ts
  - Added initialization on startup and cleanup on shutdown

- [x] Task 6: Create frontend API client methods
  - Created frontend/src/api/tasks.ts with all API methods and helpers

- [x] Task 7: Build TasksPage component
  - Created frontend/src/pages/Tasks.tsx with full CRUD UI

- [x] Task 8: Add to router/navigation
  - Added /tasks route to App.tsx
  - Added Tasks button to Repos.tsx header

- [x] Task 9: Test end-to-end
  - Created comprehensive test suites
  - 103 tests all passing

- [x] Task 10: Update documentation
  - Added Scheduled Tasks section to README.md
  - Created docs/scheduled-tasks.md with full feature documentation

## Test Coverage (Updated 2025-01-30)

### Scheduler Service Tests (35 tests)
File: `backend/test/services/scheduler.test.ts`

- **setDatabase**: Database initialization
- **createTask**: Valid cron, invalid cron, scheduling, config storage, timestamps
- **getAllTasks**: Returns all tasks, empty when no DB
- **getTask**: Retrieve by ID, handle non-existent
- **updateTask**: Name update, cron validation, reschedule on change
- **deleteTask**: Delete existing, handle non-existent, stop cron job
- **toggleTask**: Pause active, resume paused, handle non-existent
- **runTaskNow**: Execute skill, opencode-run, script commands; error handling; duration tracking
- **initialize**: Load active tasks, throw without DB
- **shutdown**: Stop all jobs
- **Command Types**: Skill with args, opencode-run with workdir, script requires command
- **Database Persistence**: Timestamp handling
- **Cron Trigger Simulation**: Callback registration, task execution on trigger

### Task Routes Tests (27 tests)
File: `backend/test/routes/tasks.test.ts`

- **GET /api/tasks**: Empty array, return all tasks
- **GET /api/tasks/:id**: Return task, 404 for non-existent, 400 for invalid ID
- **POST /api/tasks**: Create task, validate required fields, validate command_type enum, reject invalid cron, validate name length, accept all command types
- **PUT /api/tasks/:id**: Update name, 404 for non-existent, reject invalid cron, 400 for invalid ID
- **DELETE /api/tasks/:id**: Delete task, 404 for non-existent, 400 for invalid ID
- **POST /api/tasks/:id/toggle**: Toggle status, 404 for non-existent, 400 for invalid ID
- **POST /api/tasks/:id/run**: Run immediately, handle non-existent, 400 for invalid ID
- **Command Config Validation**: Skill, opencode-run, script configs

### Telegram Integration Tests - REMOVED
File: `backend/test/services/telegram.test.ts` (DELETED)

**Reason for removal**: The telegram tests were deleted because they only tested inline logic defined within the test file itself, not actual application code. Tests like `process.env.X = 'value'; expect(process.env.X).toBe('value')` provide no value. When Telegram integration is actually implemented, proper tests should be written that import and test the real telegram service module.

### Test Summary
- **Total Tests**: 103 (all passing)
- **Test Files**: 7
