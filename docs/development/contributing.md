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

- No comments — code should be self-documenting
- No console.log — use proper logging
- Strict TypeScript — proper typing everywhere
- Named imports — no default imports
- DRY principles — don't repeat yourself
- SOLID design — follow SOLID principles

## Pull Request Process

### Before Submitting

1. Run linting: `pnpm lint`
2. Run tests: `pnpm test`
3. Check types: `pnpm typecheck`
4. Verify your changes work manually

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
