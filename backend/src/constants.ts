export const DEFAULT_AGENTS_MD = `# OpenCode Manager - Global Agent Instructions

## Critical System Constraints

- **DO NOT** use ports 5003 or 5551 - these are reserved for OpenCode Manager
- **DO NOT** kill or stop processes on ports 5003 or 5551
- **DO NOT** modify files in the \`.config/opencode\` directory unless explicitly requested

## Dev Server Ports

When starting dev servers, use the pre-allocated ports 5100-5103:
- Port 5100: Primary dev server (frontend)
- Port 5101: Secondary dev server (API/backend)
- Port 5102: Additional service
- Port 5103: Additional service

Always bind to \`0.0.0.0\` to allow external access from the Docker host.

## Package Management

### Node.js Packages
Prefer **pnpm** or **bun** over npm for installing dependencies to save disk space:
- Use \`pnpm install\` instead of \`npm install\`
- Use \`bun install\` as an alternative
- Both are pre-installed in the container

 ### Python Packages
 Always create a virtual environment in the repository directory before installing packages:

 1. Create virtual environment in repo:
   \`cd \`<repo_path>\`
   \`uv venv .venv\`

 2. Activate the virtual environment:
   \`source .venv/bin/activate\`  # or \`uv pip sync\` for project-based workflows

 3. Install packages into activated environment:
   \`uv pip install \`<package>\`
   \`uv pip install -r requirements.txt\`

 4. Run Python commands:
   \`python script.py\`  # Uses activated .venv

 Alternative: Use \`uv run python script.py\` to skip explicit activation

 **Important:**
 - Always create .venv in the repository directory (not workspace root)
 - Activate the environment before running pip operations
 - uv is pre-installed in the container and provides faster package installation
 - .venv directories created in repos will persist but can be removed safely

## General Guidelines

- This file is merged with any AGENTS.md files in individual repositories
- Repository-specific instructions take precedence for their respective codebases
`
