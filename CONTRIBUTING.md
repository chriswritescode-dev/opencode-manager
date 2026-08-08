# Contributing to OpenCode Manager

Thanks for your interest in contributing! This guide covers our workflow and how to get started.

## Getting Started

1. Fork the repository
2. Clone your fork locally

See the [Development Setup Guide](docs/development/setup.md) for detailed setup instructions.

## Project Board Workflow

We use a [GitHub Project board](https://github.com/users/chriswritescode-dev/projects/2) to coordinate work and avoid duplicate effort.

### Claiming an Issue

1. Check the project board to see what's already in progress
2. Find an issue you'd like to work on from the **Todo** column
3. Comment on the issue: "I'd like to work on this"
4. A maintainer will assign you and move it to **In Progress**
5. Fork the repo and start working


### Status Columns

| Column | Meaning |
|--------|---------|
| **Todo** | Ready to be picked up |
| **In Progress** | Someone is actively working on it |
| **In Review** | PR is open and awaiting review |
| **Done** | Merged and complete |

### Themes

Each item is tagged with a theme to help you find work in your area of interest:

| Theme | Description |
|-------|-------------|
| UI Polish | User interface improvements |
| Auth | Authentication and security features |
| Git/VCS | Version control features |
| Agent          | AI agent capabilities |
| Infrastructure | Deployment and environment setup |
| STT | Speech-to-text features |
| Cost/Analytics | Usage tracking and analytics |

## Development Guidelines

### Code Style

- Self-documenting code (no comments needed)
- Strict TypeScript with proper typing
- Named imports only
- DRY principles - check for existing patterns before adding new ones
- Functions should be single-responsibility and reusable

### Backend (Bun + Hono)

- Hono framework with Zod validation
- Bun SQLite (bun:sqlite) for database
- Proper error handling with try/catch
- Use async/await consistently

### Frontend (React + Vite)

- Use `@/` alias for component imports
- Radix UI + Tailwind CSS for styling
- React Query for state management
- React Hook Form + Zod for forms

### Running Tests

```bash
pnpm test              # Run all tests (backend)
cd backend && vitest <filename>   # Run single test file
```

### Linting

```bash
pnpm lint              # Lint both backend and frontend
```

Run linting before submitting a PR.

## Submitting Changes

1. Create a feature branch from `main`
2. Make your changes with clear, focused commits
3. Run tests and linting
4. Open a PR and link it to your issue (use "Closes #123" in the PR description)
5. A maintainer will move the item to **In Review**
6. Address review feedback
7. Once merged, the item moves to **Done**

## Questions?

Open an issue or discussion on GitHub if you have questions or ideas.
