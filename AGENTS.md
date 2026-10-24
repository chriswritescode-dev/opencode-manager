# OpenCode WebUI - Agent Guidelines

## Commands

- `pnpm dev` - Start both backend (5003) and frontend (5173)
- `pnpm dev:backend` - Backend only: `NODE_ENV=development bun --watch backend/src/index.ts`
- `pnpm dev:frontend` - Frontend only: `pnpm --filter frontend dev`
- `pnpm build` - Build CLI, backend, and frontend
- `pnpm test` - Run CLI, backend, and frontend tests
- `cd backend && pnpm exec vitest run <filename>` - Run single test file
- `cd backend && pnpm exec vitest --ui` - Interactive test UI
- `cd backend && pnpm exec vitest run --coverage` - Coverage report (80% threshold)
- `cd backend && bun test <filename>` - Run a Bun-only suite, excluded from Vitest (`test/routes/internal-sandbox.test.ts`, `src/routes/repos.test.ts`)
- `pnpm lint` - Lint CLI, frontend, and backend
- `pnpm lint:backend` - Backend linting
- `pnpm lint:frontend` - Frontend linting

## Code Style

- Doc comments only in new and changed code: JSDoc/TSDoc attached to the declaration they document, in the language's native doc convention. No inline, explanatory, or section comments; code must be self-documenting
- No console logs (use Bun's logger or proper error handling)
- Strict TypeScript everywhere, proper typing required
- Named imports only: `import { Hono } from 'hono'`, `import { useState } from 'react'`

### Backend (Bun + Hono)

- Hono framework with Zod validation, Bun SQLite (bun:sqlite) database
- Error handling with try/catch and structured logging
- Follow existing route/service/utility structure
- Use async/await consistently, avoid .then() chains
- Test coverage: 80% minimum required

### Frontend (React + Vite)

- @/ alias for components: `import { Button } from '@/components/ui/button'`
- Radix UI + Tailwind CSS, React Hook Form + Zod
- React Query (@tanstack/react-query) for state management
- ESLint TypeScript rules enforced
- Use React hooks properly, no direct state mutations

### General

- DRY principles, follow existing patterns
- Use SOLID principles throughout design and implementation:
  - **Single Responsibility**: Each module/class/function should have one reason to change—keep responsibilities focused.
  - **Open/Closed**: Entities should be open for extension, closed for modification—prefer adding new code over altering stable code.
  - **Liskov Substitution**: Subtypes must be substitutable for their base types—no breaking expected behavior when swapping implementations.
  - **Interface Segregation**: Prefer small, specific interfaces over large, general ones—clients shouldn’t depend on methods they don’t use.
  - **Dependency Inversion**: Depend on abstractions, not concretions—inject dependencies and avoid hard-coding implementations.
- YAGNI: Don’t build or keep code you don’t need. If you change something, remove the unused parts. use the new code or keep the old, but don’t keep both.
- Never leave dead code: remove unused code, commented-out blocks, and unused variables/imports.
- `temp/opencode` is a reference clone of OpenCode 2 at tag `v2.0.15` (gitignored, never committed)
- Use shared types from workspace package (@opencode-manager/shared)
- OpenCode server runs on port 5551, backend API on port 5003
- Prefer pnpm over npm for all package management
- Run `pnpm lint` after completing tasks to ensure code quality