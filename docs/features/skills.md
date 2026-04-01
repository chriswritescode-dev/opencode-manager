# Skills

Skills are reusable instruction sets that provide domain-specific workflows and guidance to OpenCode AI agents. They are stored as `SKILL.md` files and can be scoped globally or per-project.

## Scopes

| Scope | Location | Description |
|-------|----------|-------------|
| **Global** | `$WORKSPACE_PATH/.config/opencode/skills/<name>/SKILL.md` (defaults to `./workspace/.config/opencode/skills/`) | Available across all repositories |
| **Project** | `<repo>/.opencode/skills/<name>/SKILL.md` | Scoped to a specific repository |

## Skill File Format

Each skill is a `SKILL.md` file with YAML frontmatter and a markdown body:

```markdown
---
name: my-skill
description: Short description of what this skill does
license: MIT
compatibility: opencode >= 1.0
metadata:
  author: your-name
  version: 1.0.0
---
Your skill instructions go here. This is the content that gets
injected into the AI agent's context when the skill is loaded.
```

### Frontmatter Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Lowercase alphanumeric with hyphens (e.g., `my-skill`). Max 64 characters. |
| `description` | Yes | What the skill does. Max 1024 characters. |
| `license` | No | License identifier (e.g., `MIT`) |
| `compatibility` | No | Version compatibility note |
| `metadata` | No | Key-value pairs for additional context |

### Naming Rules

Skill names must match the pattern `^[a-z0-9]+(-[a-z0-9]+)*$`:

- Lowercase letters and numbers only
- Hyphens allowed between words
- No spaces, underscores, or uppercase letters
- Examples: `test-skill`, `code-review`, `deploy-helper`

## Managing Skills

Skills are managed through the Settings UI under the Skills section, or via the API.

### API Endpoints

All endpoints are under `/api/settings/skills`.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/skills` | List all skills (optional `?repoId=` filter) |
| `GET` | `/skills/:name` | Get a specific skill (requires `scope` query param, optional `repoId`) |
| `POST` | `/skills` | Create a new skill |
| `PUT` | `/skills/:name` | Update an existing skill (requires `scope` query param, optional `repoId`) |
| `DELETE` | `/skills/:name` | Delete a skill (requires `scope` query param, optional `repoId`) |

### Create Request

```json
{
  "name": "my-skill",
  "description": "Runs type check and lint",
  "body": "Instructions for the AI agent...",
  "scope": "global",
  "license": "MIT",
  "compatibility": "opencode >= 1.0",
  "metadata": { "author": "your-name" },
  "repoId": 1
}
```

`repoId` is required when `scope` is `"project"`.

### Update Request

All fields are optional. Set a field to `null` to clear it.

```json
{
  "description": "Updated description",
  "body": "Updated instructions",
  "license": null
}
```
