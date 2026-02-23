# Local Development Setup

Guide for setting up a local development environment.

## Prerequisites

- [pnpm](https://pnpm.io/installation) - Package manager (required for workspaces)
- [Bun](https://bun.sh) - Backend runtime
- [OpenCode TUI](https://opencode.ai) - `npm install -g @opencode/tui`

## Installation

```bash
# Clone the repository
git clone https://github.com/chriswritescode-dev/opencode-manager.git
cd opencode-manager

# Install dependencies
pnpm install
```

The `pnpm dev` command automatically runs `scripts/setup-dev.sh` first, which:
- Checks prerequisites (pnpm, bun, git, OpenCode TUI)
- Creates required workspace directories
- Copies `.env.example` to `.env` if missing

Then start development servers:

```bash
pnpm dev
```

This starts:

- **Backend** on http://localhost:5003
- **Frontend** on http://localhost:5173 (with HMR)

## Project Structure

```
opencode-manager/
├── backend/              # Bun + Hono API server
│   ├── src/
│   │   ├── routes/       # API route handlers
│   │   ├── services/     # Business logic
│   │   ├── db/           # Database migrations and queries
│   │   │   └── migrations/  # Numbered migration files
│   │   ├── types/        # TypeScript types
│   │   ├── utils/        # Utility functions
│   │   └── index.ts      # Entry point
│   └── test/             # Backend tests
├── frontend/             # React + Vite SPA
│   ├── src/
│   │   ├── components/   # UI components
│   │   ├── pages/        # Page components
│   │   ├── hooks/        # Custom React hooks
│   │   ├── api/          # API client
│   │   ├── lib/          # Utilities
│   │   ├── stores/       # Zustand stores
│   │   └── contexts/     # React contexts
│   └── public/           # Static assets
├── shared/               # @opencode-manager/shared types and utilities
├── packages/memory/      # Memory plugin package
├── workspace/            # Runtime workspace for OpenCode
├── docs/                 # Documentation
├── scripts/              # Build and utility scripts
├── Dockerfile            # Docker image definition
└── docker-compose.yml    # Docker Compose configuration
```

## Available Scripts

### Root Level

```bash
pnpm dev          # Start both backend and frontend (runs setup-dev.sh first)
pnpm dev:backend  # Start backend only
pnpm dev:frontend # Start frontend only
pnpm build        # Build both packages
pnpm lint         # Lint both packages
pnpm test         # Run all tests
```

### Backend

```bash
cd backend
bun --watch src/index.ts  # Start with hot reload
pnpm test                 # Run tests (uses Vitest)
vitest <file>             # Run single test file
vitest --ui               # Test UI
vitest --coverage         # Coverage report
eslint . --ext .ts        # Lint
tsc --noEmit              # TypeScript check
```

### Frontend

```bash
cd frontend
pnpm dev          # Start Vite dev server
pnpm build        # Production build
pnpm lint         # ESLint
pnpm typecheck    # TypeScript check
```

## Database

Using Bun's built-in SQLite (`bun:sqlite`) with numbered migrations.

### Location

- **Development**: `./data/opencode.db`
- **Docker**: `/app/data/opencode.db`

### Schema Changes

1. Add new migration file in `backend/src/db/migrations/` (e.g., `007-new-feature.ts`)
2. Export the migration in `backend/src/db/migrations/index.ts`
3. Migrations run automatically on startup

### Inspection

```bash
sqlite3 ./data/opencode.db

# Useful commands
.tables                  # List tables
.schema user             # Show table schema
SELECT * FROM user;      # View data
```

## Testing

### Running Tests

```bash
# All tests
cd backend && pnpm test

# Single file
cd backend && pnpm test src/services/repo.test.ts

# With UI
cd backend && pnpm test:ui

# With coverage
cd backend && pnpm test -- --coverage
```

### Writing Tests

```typescript
import { describe, it, expect } from 'vitest'
import { repoService } from '../src/services/repo'

describe('repoService', () => {
  it('listAll returns repositories', async () => {
    const repos = await repoService.listAll()
    expect(Array.isArray(repos)).toBe(true)
  })
})
```

### Coverage Requirements

Minimum 80% coverage is enforced.

## Debugging

### Backend

Logs output to terminal when running `pnpm dev`. For verbose debug logging:

```bash
# Add to .env
DEBUG=true
LOG_LEVEL=debug
```

### Frontend

1. Open browser DevTools (F12)
2. Check Console for errors
3. Check Network tab for API calls
4. Use React DevTools extension

## Building

### Development Build

```bash
pnpm build
```

### Production Build

```bash
NODE_ENV=production pnpm build
```

### Docker Build

```bash
docker build -t opencode-manager .
```

## Common Issues

### Port Already in Use

```bash
# Find process using port
lsof -i :5003

# Kill process
kill -9 <PID>
```

### Module Not Found

```bash
# Clear node_modules and reinstall
rm -rf node_modules
rm -rf */node_modules
pnpm install
```

### TypeScript Errors

```bash
# Check types
pnpm typecheck

# Clear TypeScript cache
rm -rf */tsconfig.tsbuildinfo
```

### Database Issues

```bash
# Reset database
rm -f data/opencode.db
pnpm dev  # Database is recreated
```
