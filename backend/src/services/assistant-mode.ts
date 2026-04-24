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
  return `# Assistant Mode Instructions

This folder is the shared Assistant mode workspace for OpenCode Manager.

## Purpose

Assistant mode provides an isolated space for:
- Self-editing agent instructions and preferences
- Customized workflows specific to this assistant workspace
- Iterative improvement of assistant behavior

## Self-Editing Rules

The agent MAY self-edit the following files within this workspace:
- \`AGENTS.md\` - Assistant instructions, persona, and durable preferences
- \`opencode.json\` - OpenCode configuration for this workspace

## Constraints

- Changes outside this workspace require explicit user direction
- Self-edits should be concise and auditable
- Preserve user-customized content when modifying files
- Always ask for confirmation before making significant changes

## Guidelines

1. Keep instructions clear and actionable
2. Update AGENTS.md when learning durable preferences
3. Maintain version control awareness
4. Document significant changes in commit messages
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

  const agentsMdExists = await fileExists(agentsMdPath)
  const opencodeJsonExists = await fileExists(opencodeJsonPath)

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

  const agentsMdExists = await fileExists(agentsMdPath)
  const opencodeJsonExists = await fileExists(opencodeJsonPath)

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
    },
  }
}
