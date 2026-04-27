# Assistant Workspace

Assistant mode creates a shared workspace at `repos/assistant` for customizing how the OpenCode Manager Assistant behaves.

This workspace is separate from your project repositories. Use it for Assistant instructions, Assistant-specific OpenCode settings, and reusable workflows.

## First Run

The first time you open Assistant mode, OpenCode Manager creates:

- `AGENTS.md` - durable Assistant instructions and preferences
- `opencode.json` - OpenCode configuration for the Assistant workspace
- `.opencode/skills/update-configuration/SKILL.md` - a skill for safe config updates and reloads

Existing files are preserved. OpenCode Manager only seeds missing files or replaces legacy generated config that is no longer valid.

## Directory Layout

```text
repos/assistant/
├── AGENTS.md
├── opencode.json
└── .opencode/
    └── skills/
        └── update-configuration/
            └── SKILL.md
```

## Customizing Assistant Behavior

Edit `AGENTS.md` when you want to change durable behavior, communication style, working agreements, or preferences.

Edit `opencode.json` when you want to change workspace-level OpenCode configuration such as permissions, agents, providers, plugins, or models.

Add skills under `.opencode/skills/<skill-name>/SKILL.md` when you want reusable Assistant workflows.

## Update Configuration Skill

The seeded `update-configuration` skill gives the Assistant a safe workflow for changing its own workspace configuration.

Use it when you want to:

- Update Assistant instructions in `AGENTS.md`
- Change Assistant workspace settings in `opencode.json`
- Add or modify Assistant-scoped skills
- Reload or restart OpenCode after configuration changes

The skill instructs the Assistant to inspect current files first, make the smallest safe edit, preserve user customizations, validate JSON, and report reload results.

## Sessions

Assistant sessions are scoped to the Assistant workspace directory. When you open Assistant mode, OpenCode Manager reopens the most recent Assistant session or creates a new one with onboarding guidance.
