# Local Development Setup

Guide for setting up a local development environment.

## Prerequisites

- [pnpm](https://pnpm.io/installation) - Package manager (required for workspaces)
- [Bun](https://bun.sh) - Backend runtime
- [OpenCode TUI](https://opencode.ai) - `npm install -g @opencode/tui`
- [Node.js 22+](https://nodejs.org/en/about/previous-releases)

## Installation

```bash
# Clone the repository
git clone https://github.com/chriswritescode-dev/opencode-manager.git
cd opencode-manager

# Install dependencies
pnpm install

# Copy environment configuration
cp .env.example .env

# Start development servers
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
│   │   ├── db/           # Database schema and queries
│   │   └── index.ts      # Entry point
│   └── tests/            # Backend tests
├── frontend/             # React + Vite SPA
│   ├── src/
│   │   ├── components/   # UI components
│   │   ├── pages/        # Page components
│   │   ├── hooks/        # Custom React hooks
│   │   ├── api/          # API client
│   │   └── lib/          # Utilities
│   └── public/           # Static assets
├── shared/               # Shared types and utilities
└── docker/               # Docker configuration
```

## Available Scripts

### Root Level

```bash
pnpm dev          # Start both backend and frontend
pnpm build        # Build both packages
pnpm lint         # Lint both packages
pnpm test         # Run all tests
```

### Backend

```bash
cd backend
bun run dev       # Start with hot reload
bun test          # Run tests
bun test <file>   # Run single test file
bun run lint      # ESLint
bun run typecheck # TypeScript check
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

Using Better SQLite3 with Drizzle ORM.

### Location

- **Development**: `./backend/data/opencode.db`
- **Docker**: `/app/data/opencode.db`

### Schema Changes

1. Edit schema in `backend/src/db/schema.ts`
2. Generate migration: `cd backend && bun run db:generate`
3. Apply migration: `cd backend && bun run db:migrate`

### Inspection

```bash
sqlite3 ./backend/data/opencode.db

# Useful commands
.tables                  # List tables
.schema users            # Show table schema
SELECT * FROM users;     # View data
```

## Testing

### Running Tests

```bash
# All tests
cd backend && bun test

# Single file
cd backend && bun test src/services/repo.test.ts

# With coverage
cd backend && bun test --coverage
```

### Writing Tests

```typescript
import { expect, test, describe } from 'bun:test'
import { repoService } from '../src/services/repo'

describe('repoService', () => {
  test('listAll returns repositories', async () => {
    const repos = await repoService.listAll()
    expect(Array.isArray(repos)).toBe(true)
  })
})
```

### Coverage Requirements

Minimum 80% coverage is enforced.

## Debugging

### Backend

Logs output to terminal when running `pnpm dev`.

For more detailed debugging:

```bash
cd backend
DEBUG=* bun run dev
```

### Frontend

1. Open browser DevTools (F12)
2. Check Console for errors
3. Check Network tab for API calls
4. Use React DevTools extension

### VS Code

Launch configurations are provided in `.vscode/launch.json`:

- **Debug Backend** - Attach debugger to backend
- **Debug Frontend** - Launch Chrome with debugging

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
rm -f backend/data/opencode.db
pnpm dev  # Database is recreated
```
