# Copilot Code Review Instructions

## Technology Stack

- **Monorepo**: pnpm workspace with backend, frontend, and shared packages
- **Backend**: Bun runtime + Hono framework + Better SQLite3
- **Frontend**: React 19 + Vite 7 + Radix UI + Tailwind CSS 4
- **Validation**: Zod schemas throughout
- **State**: React Query + Zustand
- **Language**: TypeScript (strict mode)

## Code Style Requirements

### Must Flag as Issues

- Any code comments (code must be self-documenting)
- Console.log statements (use structured logging)
- Use of `any` type without justification
- Default exports (named exports only)
- .then() chains (use async/await)
- Unused variables, imports, or dead code
- Direct state mutations in React components

### Import Patterns

- Backend: `import { Hono } from 'hono'`
- Frontend: `import { Button } from '@/components/ui/button'`
- Shared types: `import { ... } from '@opencode-manager/shared'`

### Architecture Patterns

- Backend routes in `backend/src/routes/`
- Backend services in `backend/src/services/`
- Frontend pages in `frontend/src/pages/`
- Shared types/schemas in `shared/src/`

### Quality Standards

- Test coverage: 80% minimum
- DRY: No duplicated logic
- SOLID principles enforced
- YAGNI: No speculative code
- All functions should have single responsibility

### Review Focus Areas

1. TypeScript type safety (no implicit any)
2. Error handling with try/catch
3. React hooks rules compliance
4. Zod validation on API boundaries
5. Consistent async/await usage
