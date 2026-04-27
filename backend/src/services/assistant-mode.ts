import path from 'path'
import type { Repo } from '@opencode-manager/shared/types'
import type {
  AssistantModeStatus,
  AssistantModeInitRequest,
  OpenCodeConfigInput,
} from '@opencode-manager/shared/types'
import {
  readFileContent,
  writeFileContent,
  fileExists,
  ensureDirectoryExists,
} from './file-operations'
import { OpenCodeConfigSchema } from '@opencode-manager/shared/schemas'
import { getReposPath } from '@opencode-manager/shared/config/env'

const ASSISTANT_MODE_DIR = 'assistant'
const ASSISTANT_MODE_RELATIVE_PATH = 'repos/assistant'
const ASSISTANT_AGENTS_MD_FILENAME = 'AGENTS.md'
const ASSISTANT_OPENCODE_CONFIG_FILENAME = 'opencode.json'
const ASSISTANT_UPDATE_CONFIGURATION_SKILL_PATH = path.join('.opencode', 'skills', 'update-configuration', 'SKILL.md')

export function getAssistantModeDirectory(): string {
  const reposPath = getReposPath()
  const assistantDir = path.join(reposPath, ASSISTANT_MODE_DIR)
  const resolvedReposRoot = path.resolve(reposPath)
  const resolvedAssistantDir = path.resolve(assistantDir)

  if (!resolvedAssistantDir.startsWith(resolvedReposRoot)) {
    throw new Error('Assistant mode directory must be within repos root')
  }

  return resolvedAssistantDir
}

export function buildAssistantAgentsMd(): string {
  return `# Assistant Directory

This directory is the shared Assistant workspace for OpenCode Manager.

## Purpose

Use this workspace to customize how the Assistant behaves across OpenCode Manager sessions. It is separate from your project repositories, so changes here are for the Assistant itself rather than application code.

This workspace is useful for:
- Durable Assistant instructions, preferences, and working agreements
- Assistant-specific OpenCode configuration
- Reusable skills and workflows for managing this environment
- Iterative improvements to how the Assistant helps you

## Files

- \`AGENTS.md\` defines Assistant instructions loaded for this workspace
- \`opencode.json\` defines OpenCode configuration for this workspace
- \`.opencode/skills/\` contains Assistant-scoped skills

## Customization

Edit \`AGENTS.md\` when you want to change the Assistant's default behavior, communication style, or durable preferences.

Edit \`opencode.json\` when you want to change OpenCode settings such as models, agents, providers, permissions, or plugins for this workspace.

Add skills under \`.opencode/skills/<skill-name>/SKILL.md\` when you want reusable workflows. The seeded \`update-configuration\` skill is for safely updating this workspace configuration and reloading OpenCode afterward.

## Self-Editing Rules

The agent MAY self-edit the following files within this workspace:
- \`AGENTS.md\` - Assistant instructions, persona, and durable preferences
- \`opencode.json\` - OpenCode configuration for this workspace
- \`.opencode/skills/\` - Assistant-scoped reusable workflows

## Constraints

- Changes outside this workspace require explicit user direction
- Self-edits should be concise and auditable
- Preserve user-customized content when modifying files
- Always ask for confirmation before making significant changes
- Validate JSON before saving \`opencode.json\`
- Reload or restart OpenCode after configuration or skill changes when needed

## Guidelines

1. Keep instructions clear and actionable
2. Update AGENTS.md when learning durable preferences
3. Prefer small configuration changes over broad rewrites
4. Maintain version control awareness
5. Document significant changes in commit messages
`
}

export function buildAssistantUpdateConfigurationSkill(): string {
  return `---
name: update-configuration
description: Safely update Assistant workspace instructions, OpenCode config, and skills, then reload OpenCode configuration when needed.
---
# Update Configuration

Use this skill when the user wants to change how the Assistant workspace behaves, including edits to \`AGENTS.md\`, \`opencode.json\`, or Assistant-scoped skills.

## Workflow

1. Inspect the current Assistant workspace files before editing.
2. Identify the smallest configuration change that satisfies the request.
3. Preserve user-written instructions and existing settings unless the user asks to replace them.
4. Validate \`opencode.json\` as JSON after changes.
5. Reload or restart OpenCode configuration after changing \`opencode.json\` or skills.
6. Tell the user what changed and whether reload succeeded.

## Files

- \`AGENTS.md\` stores durable Assistant instructions and preferences.
- \`opencode.json\` stores Assistant workspace OpenCode settings.
- \`.opencode/skills/<name>/SKILL.md\` stores Assistant-scoped reusable workflows.

## Rules

- Do not rewrite the whole configuration when a targeted edit is enough.
- Do not remove user customizations unless explicitly requested.
- Do not edit project repositories unless the user explicitly asks.
- If reload fails, report the error and leave the files in a valid state.
`
}

export function buildAssistantOpenCodeConfig(): OpenCodeConfigInput {
  const config: OpenCodeConfigInput = {
    instructions: [
      'AGENTS.md',
    ],
    permission: {
      read: 'allow',
      edit: 'allow',
      glob: 'allow',
      grep: 'allow',
      list: 'allow',
      bash: 'allow',
      external_directory: 'ask',
    },
  }

  const result = OpenCodeConfigSchema.safeParse(config)
  if (!result.success) {
    throw new Error(`Generated OpenCode config is invalid: ${result.error.message}`)
  }

  return config
}

export async function ensureAssistantMode(
  repo: Repo,
  options?: AssistantModeInitRequest
): Promise<AssistantModeStatus> {
  const assistantDir = getAssistantModeDirectory()

  await ensureDirectoryExists(assistantDir)

  const agentsMdPath = path.join(assistantDir, ASSISTANT_AGENTS_MD_FILENAME)
  const opencodeJsonPath = path.join(assistantDir, ASSISTANT_OPENCODE_CONFIG_FILENAME)
  const updateConfigurationSkillPath = path.join(assistantDir, ASSISTANT_UPDATE_CONFIGURATION_SKILL_PATH)

  const agentsMdExists = await fileExists(agentsMdPath)
  const opencodeJsonExists = await fileExists(opencodeJsonPath)
  const updateConfigurationSkillExists = await fileExists(updateConfigurationSkillPath)

  const overwriteAgentsMd = options?.overwriteAgentsMd ?? false
  const overwriteOpenCodeConfig = options?.overwriteOpenCodeConfig ?? false

  if (!agentsMdExists || overwriteAgentsMd) {
    const content = buildAssistantAgentsMd()
    await writeFileContent(agentsMdPath, content)
  }

  const hasLegacyOpenCodeConfig = opencodeJsonExists && await isLegacyAssistantOpenCodeConfig(opencodeJsonPath)

  if (!opencodeJsonExists || overwriteOpenCodeConfig || hasLegacyOpenCodeConfig) {
    const config = buildAssistantOpenCodeConfig()
    await writeFileContent(opencodeJsonPath, JSON.stringify(config, null, 2))
  }

  if (!updateConfigurationSkillExists) {
    await writeFileContent(updateConfigurationSkillPath, buildAssistantUpdateConfigurationSkill())
  }

  return {
    repoId: repo.id,
    directory: assistantDir,
    relativePath: ASSISTANT_MODE_RELATIVE_PATH,
    files: {
      agentsMd: {
        path: agentsMdPath,
        exists: true,
        created: !agentsMdExists || overwriteAgentsMd,
      },
      opencodeJson: {
        path: opencodeJsonPath,
        exists: true,
        created: !opencodeJsonExists || overwriteOpenCodeConfig || hasLegacyOpenCodeConfig,
      },
      updateConfigurationSkill: {
        path: updateConfigurationSkillPath,
        exists: true,
        created: !updateConfigurationSkillExists,
      },
    },
  }
}

async function isLegacyAssistantOpenCodeConfig(opencodeJsonPath: string): Promise<boolean> {
  try {
    const content = await readFileContent(opencodeJsonPath)
    const config = JSON.parse(content) as { permission?: { allow?: unknown; ask?: unknown } }
    return Array.isArray(config.permission?.allow) || Array.isArray(config.permission?.ask)
  } catch {
    return false
  }
}

export async function getAssistantModeStatus(repo: Repo): Promise<AssistantModeStatus> {
  const assistantDir = getAssistantModeDirectory()

  const agentsMdPath = path.join(assistantDir, ASSISTANT_AGENTS_MD_FILENAME)
  const opencodeJsonPath = path.join(assistantDir, ASSISTANT_OPENCODE_CONFIG_FILENAME)
  const updateConfigurationSkillPath = path.join(assistantDir, ASSISTANT_UPDATE_CONFIGURATION_SKILL_PATH)

  const agentsMdExists = await fileExists(agentsMdPath)
  const opencodeJsonExists = await fileExists(opencodeJsonPath)
  const updateConfigurationSkillExists = await fileExists(updateConfigurationSkillPath)

  return {
    repoId: repo.id,
    directory: assistantDir,
    relativePath: ASSISTANT_MODE_RELATIVE_PATH,
    files: {
      agentsMd: {
        path: agentsMdPath,
        exists: agentsMdExists,
        created: false,
      },
      opencodeJson: {
        path: opencodeJsonPath,
        exists: opencodeJsonExists,
        created: false,
      },
      updateConfigurationSkill: {
        path: updateConfigurationSkillPath,
        exists: updateConfigurationSkillExists,
        created: false,
      },
    },
  }
}
