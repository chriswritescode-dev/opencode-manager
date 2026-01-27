# Contributing

Guide for contributing to OpenCode Manager.

## Getting Started

1. Fork the repository
2. Clone your fork
3. Set up local development (see [Local Setup](setup.md))
4. Create a feature branch
5. Make changes
6. Submit a pull request

## Code Style

### General Guidelines

- **No comments** - Code should be self-documenting
- **No console.log** - Use proper logging
- **Strict TypeScript** - Proper typing everywhere
- **Named imports** - No default imports
- **DRY principles** - Don't repeat yourself
- **SOLID design** - Follow SOLID principles

### Backend (Bun + Hono)

```typescript
// Route handler
app.get('/api/repos', async (c) => {
  const repos = await repoService.listAll()
  return c.json(repos)
})

// Service
export const repoService = {
  async listAll(): Promise<Repository[]> {
    return db.query.repositories.findMany()
  }
}
```

Guidelines:

- Use Zod for validation
- Async/await (no .then() chains)
- Structured error handling
- Follow existing patterns

### Frontend (React + Vite)

```typescript
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useRepositories } from '@/hooks/useRepositories'

export function RepoList() {
  const { data: repos } = useRepositories()
  
  return (
    <div>
      {repos?.map(repo => (
        <RepoCard key={repo.id} repo={repo} />
      ))}
    </div>
  )
}
```

Guidelines:

- Use `@/` alias for imports
- React Query for server state
- React Hook Form + Zod for forms
- Radix UI + Tailwind for components

## Pull Request Process

### Before Submitting

1. **Run linting**: `pnpm lint`
2. **Run tests**: `pnpm test`
3. **Check types**: `pnpm typecheck`
4. **Test manually**: Verify your changes work

### PR Guidelines

- Keep PRs focused on a single feature/fix
- Write clear commit messages
- Include tests for new functionality
- Update documentation if needed
- Reference related issues

### Commit Messages

Format: `type: brief description`

Types:
- `feat` - New feature
- `fix` - Bug fix
- `docs` - Documentation
- `refactor` - Code refactoring
- `test` - Adding tests
- `chore` - Maintenance

Examples:
```
feat: add file upload progress indicator
fix: resolve session expiry on mobile
docs: update installation guide
refactor: extract git service from routes
```

## Testing

### Writing Tests

```typescript
import { expect, test, describe, beforeEach } from 'bun:test'

describe('featureName', () => {
  beforeEach(() => {
    // Setup
  })

  test('should do something', async () => {
    const result = await doSomething()
    expect(result).toBe(expected)
  })
})
```

### Coverage Requirements

- Minimum 80% coverage
- Cover edge cases
- Test error conditions

### Running Tests

```bash
# All tests
pnpm test

# With coverage
cd backend && bun test --coverage

# Single file
cd backend && bun test path/to/test.ts
```

## Architecture Decisions

### Why Bun?

- Fast startup and execution
- Built-in TypeScript support
- SQLite driver included
- Modern JavaScript runtime

### Why Hono?

- Lightweight and fast
- TypeScript-first
- Works with Bun natively
- Simple, Express-like API

### Why React Query?

- Automatic caching and refetching
- Server state management
- Optimistic updates
- SSE support for streaming

### Why Radix UI?

- Accessible by default
- Unstyled (pairs with Tailwind)
- Headless components
- Production-ready

## Adding Features

### New API Endpoint

1. Create route in `backend/src/routes/`
2. Add service logic in `backend/src/services/`
3. Define types in `shared/`
4. Add tests
5. Update API client in frontend

### New UI Component

1. Create component in `frontend/src/components/`
2. Use Radix UI primitives if applicable
3. Style with Tailwind
4. Add to relevant page
5. Test responsiveness

### New Feature Flag

1. Add to settings schema
2. Create migration if needed
3. Add UI toggle in settings
4. Check flag in relevant code

## Getting Help

- **Questions**: Open a GitHub Discussion
- **Bugs**: Open a GitHub Issue
- **Features**: Open a GitHub Issue with `feature` label

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
