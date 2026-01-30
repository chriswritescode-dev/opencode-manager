# Scheduled Tasks

Schedule recurring tasks directly from the opencode-manager interface. Replaces manual cron jobs with better visibility into task execution.

## Features

- **Cron Expression Support** - Full cron syntax for flexible scheduling
- **Preset Schedules** - Quick options: every minute, hourly, daily at 9am, weekly on Monday
- **Task Lifecycle** - Create, update, delete, pause, resume tasks
- **Run Now** - Manually trigger any task immediately
- **Status Tracking** - Last run time, next scheduled run, execution duration

## Command Types

### skill

Run an OpenCode skill with optional arguments:

```json
{
  "command_type": "skill",
  "command_config": {
    "skillName": "recruiter-response",
    "args": {}
  }
}
```

Example use cases:
- Daily recruiter email responses
- Weekly code review automation
- Scheduled documentation updates

### opencode-run

Send a message to OpenCode in a specific working directory:

```json
{
  "command_type": "opencode-run",
  "command_config": {
    "message": "Run tests and fix any failures",
    "workdir": "/path/to/project"
  }
}
```

Example use cases:
- Nightly test runs with auto-fix
- Scheduled dependency updates
- Periodic code quality checks

### script

Run an arbitrary shell command:

```json
{
  "command_type": "script",
  "command_config": {
    "command": "/path/to/script.sh --arg1 value"
  }
}
```

Example use cases:
- Database backups
- Log rotation
- Custom automation scripts

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/tasks` | List all scheduled tasks |
| GET | `/api/tasks/:id` | Get a specific task |
| POST | `/api/tasks` | Create a new task |
| PUT | `/api/tasks/:id` | Update a task |
| DELETE | `/api/tasks/:id` | Delete a task |
| POST | `/api/tasks/:id/toggle` | Pause/Resume a task |
| POST | `/api/tasks/:id/run` | Run a task immediately |

## Database Schema

Tasks are stored in SQLite with the following schema:

```sql
CREATE TABLE scheduled_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  schedule_type TEXT NOT NULL,        -- 'cron'
  schedule_value TEXT NOT NULL,       -- e.g., '0 9 * * *'
  command_type TEXT NOT NULL,         -- 'skill', 'opencode-run', 'script'
  command_config TEXT NOT NULL,       -- JSON configuration
  status TEXT NOT NULL DEFAULT 'active', -- 'active', 'paused'
  last_run_at INTEGER,
  next_run_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

## Cron Expression Examples

| Expression | Description |
|------------|-------------|
| `* * * * *` | Every minute |
| `0 * * * *` | Every hour |
| `0 9 * * *` | Daily at 9:00 AM |
| `0 9 * * 1` | Every Monday at 9:00 AM |
| `0 0 1 * *` | First day of every month |
| `*/15 * * * *` | Every 15 minutes |
| `0 9,17 * * *` | At 9:00 AM and 5:00 PM |

## Usage

1. Navigate to the **Tasks** page from the main dashboard
2. Click **New Task** to create a scheduled task
3. Enter a name and select a schedule (preset or custom cron)
4. Choose a command type and configure it
5. Save the task - it will start running on schedule

### Managing Tasks

- **Pause/Resume**: Click the toggle button to pause or resume a task
- **Run Now**: Click the play button to execute a task immediately
- **Edit**: Click the edit button to modify task settings
- **Delete**: Click the delete button to remove a task

## Implementation Details

The scheduler uses [node-cron](https://github.com/node-cron/node-cron) for cron job management:

- Tasks are loaded from the database on server startup
- Active tasks are registered with node-cron
- On task execution, the command is spawned as a child process
- Execution results (duration, success/failure) are logged
- The `last_run_at` timestamp is updated after each run

## Test Coverage

The scheduler feature has comprehensive test coverage:

- **35 unit tests** for SchedulerService (CRUD, cron validation, command execution)
- **27 API route tests** for `/api/tasks` endpoints (HTTP status, validation)

Run tests with:

```bash
cd backend && pnpm test
```
