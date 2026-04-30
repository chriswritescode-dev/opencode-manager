import path from 'path'
import { randomBytes } from 'crypto'
import type { Database } from 'bun:sqlite'
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
import { createRepo, getRepoByLocalPath } from '../db/queries'

const ASSISTANT_MODE_DIR = 'assistant'
const ASSISTANT_MODE_RELATIVE_PATH = 'repos/assistant'
const ASSISTANT_AGENTS_MD_FILENAME = 'AGENTS.md'
const ASSISTANT_OPENCODE_CONFIG_FILENAME = 'opencode.json'
const ASSISTANT_SCHEDULER_SKILL_PATH = path.join('.opencode', 'skills', 'scheduler', 'SKILL.md')
const ASSISTANT_SCHEDULER_TOKEN_PATH = path.join('.opencode', 'scheduler-token')

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

## Scheduler

Use the scheduler skill when the user wants recurring scheduled work in the Assistant repository.
`
}

export function buildAssistantSchedulerSkill(): string {
  return `---
name: scheduler
description: Configure recurring schedules for the Assistant repository. Use when the user asks the Assistant to create, update, pause, resume, or run a scheduled recurring job.
---

# Scheduler Skill

Use this skill when configuring recurring work for the Assistant repository.

## Scope

- Manage only schedules for the Assistant repository directory.
- Use the assistant schedule API below. It maps every operation to the Assistant repo and cannot target other repositories.
- Do not create a separate scheduler store or schedule metadata layer.

## Workflow

1. Clarify the schedule name, recurring cadence, timezone, prompt, enabled state, and optional agent or model.
2. Confirm the final schedule configuration before creating or updating it.
3. Read the bearer token from \`.opencode/scheduler-token\`.
4. Use the assistant schedule API for every list, create, update, delete, run, and run-history request.
5. Prefer cron schedules for wall-clock times and interval schedules for simple repeated checks.
6. After changes, list the assistant schedules and report the updated state to the user.

## API Shape

- List schedules: \`GET /api/assistant/schedules\`
- Create schedule: \`POST /api/assistant/schedules\`
- Update schedule: \`PATCH /api/assistant/schedules/:jobId\`
- Delete schedule: \`DELETE /api/assistant/schedules/:jobId\`
- Run schedule now: \`POST /api/assistant/schedules/:jobId/run\`

Send \`Authorization: Bearer <token>\` with every request.

## Schedule Payloads

Interval schedules use:

\`\`\`json
{
  "name": "Morning repo review",
  "description": "Daily repository review",
  "enabled": true,
  "scheduleMode": "interval",
  "intervalMinutes": 1440,
  "prompt": "Review this repository and summarize useful follow-ups."
}
\`\`\`

Cron schedules use:

\`\`\`json
{
  "name": "Weekday repo review",
  "enabled": true,
  "scheduleMode": "cron",
  "cronExpression": "0 9 * * 1-5",
  "timezone": "UTC",
  "prompt": "Review this repository and summarize useful follow-ups."
}
\`\`\`
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
    skills: {
      paths: ['.opencode/skills'],
    },
  }

  const result = OpenCodeConfigSchema.safeParse(config)
  if (!result.success) {
    throw new Error(`Generated OpenCode config is invalid: ${result.error.message}`)
  }

  return config
}

export function ensureAssistantRepo(db: Database): Repo {
  const existing = getRepoByLocalPath(db, ASSISTANT_MODE_DIR)
  if (existing) {
    return existing
  }

  return createRepo(db, {
    localPath: ASSISTANT_MODE_DIR,
    defaultBranch: 'main',
    cloneStatus: 'ready',
    clonedAt: Date.now(),
    isLocal: true,
  })
}

export async function ensureAssistantSchedulerToken(assistantDir: string): Promise<string> {
  const tokenPath = path.join(assistantDir, ASSISTANT_SCHEDULER_TOKEN_PATH)
  const tokenExists = await fileExists(tokenPath)
  if (tokenExists) {
    return (await readFileContent(tokenPath)).trim()
  }

  const token = randomBytes(32).toString('hex')
  await writeFileContent(tokenPath, token)
  return token
}

export async function getAssistantSchedulerToken(): Promise<string | null> {
  const tokenPath = path.join(getAssistantModeDirectory(), ASSISTANT_SCHEDULER_TOKEN_PATH)
  if (!await fileExists(tokenPath)) {
    return null
  }

  return (await readFileContent(tokenPath)).trim()
}

async function ensureSchedulerSkillPathInOpenCodeConfig(opencodeJsonPath: string): Promise<void> {
  let config: OpenCodeConfigInput
  try {
    const content = await readFileContent(opencodeJsonPath)
    config = OpenCodeConfigSchema.parse(JSON.parse(content))
  } catch {
    return
  }

  const existingPaths = config.skills?.paths ?? []
  if (existingPaths.includes('.opencode/skills')) return

  const updatedConfig = {
    ...config,
    skills: {
      ...config.skills,
      paths: [...existingPaths, '.opencode/skills'],
    },
  }

  await writeFileContent(opencodeJsonPath, JSON.stringify(updatedConfig, null, 2))
}

export async function ensureAssistantMode(
  repo: Repo,
  options?: AssistantModeInitRequest,
  db?: Database,
): Promise<AssistantModeStatus> {
  const assistantDir = getAssistantModeDirectory()
  const assistantRepo = db ? ensureAssistantRepo(db) : repo

  await ensureDirectoryExists(assistantDir)

  const agentsMdPath = path.join(assistantDir, ASSISTANT_AGENTS_MD_FILENAME)
  const opencodeJsonPath = path.join(assistantDir, ASSISTANT_OPENCODE_CONFIG_FILENAME)
  const schedulerSkillPath = path.join(assistantDir, ASSISTANT_SCHEDULER_SKILL_PATH)

  const agentsMdExists = await fileExists(agentsMdPath)
  const opencodeJsonExists = await fileExists(opencodeJsonPath)
  const schedulerSkillExists = await fileExists(schedulerSkillPath)

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
  } else {
    await ensureSchedulerSkillPathInOpenCodeConfig(opencodeJsonPath)
  }

  if (!schedulerSkillExists) {
    await writeFileContent(schedulerSkillPath, buildAssistantSchedulerSkill())
  }

  await ensureAssistantSchedulerToken(assistantDir)

  return {
    repoId: assistantRepo.id,
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
