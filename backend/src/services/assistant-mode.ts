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
import type { Database } from 'bun:sqlite'
import { getOrCreateInternalToken } from './internal-token'

const ASSISTANT_MODE_DIR = 'assistant'
const ASSISTANT_MODE_RELATIVE_PATH = 'repos/assistant'
const ASSISTANT_AGENTS_MD_FILENAME = 'AGENTS.md'
const ASSISTANT_OPENCODE_CONFIG_FILENAME = 'opencode.json'
const ASSISTANT_OPENCODE_DIR = '.opencode'
const ASSISTANT_INTERNAL_TOKEN_FILENAME = 'internal-token'
const ASSISTANT_SKILLS_DIR = 'skills'
const ASSISTANT_SCHEDULES_SKILL_DIR = 'schedule-management'
const ASSISTANT_SKILL_FILENAME = 'SKILL.md'

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

function getInternalTokenPath(assistantDir: string): string {
  return path.join(assistantDir, ASSISTANT_OPENCODE_DIR, ASSISTANT_INTERNAL_TOKEN_FILENAME)
}

function getSchedulesSkillPath(assistantDir: string): string {
  return path.join(assistantDir, ASSISTANT_OPENCODE_DIR, ASSISTANT_SKILLS_DIR, ASSISTANT_SCHEDULES_SKILL_DIR, ASSISTANT_SKILL_FILENAME)
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

## Schedule Management

This workspace ships a workspace-scoped skill at \`.opencode/skills/schedule-management/SKILL.md\` that documents how to list, create, update, delete, run, inspect, and cancel schedule jobs and runs across any repo via the internal HTTP API. Load it whenever the user asks about schedules.
`
}

function toLocalhostInternalBaseUrl(baseUrl: string): string {
  const url = new URL(baseUrl)
  url.hostname = 'localhost'
  return url.toString().replace(/\/$/, '')
}

export function buildSchedulesSkill(baseUrl: string): string {
  const internalBaseUrl = toLocalhostInternalBaseUrl(baseUrl)

  return `---
name: schedule-management
description: Manage schedule jobs and runs across any repo via the internal HTTP API
---

## When to Load

Load this skill when the user asks about managing schedules, schedule jobs, schedule runs, or anything related to automated task execution across repos.

## Authentication

All API calls require a bearer token. Read the token from \`.opencode/internal-token\` (relative to the assistant workspace cwd) and pass it as:

\`\`\`
Authorization: Bearer <token>
\`\`\`

## Base URL

\`${internalBaseUrl}\`

## Endpoints

### GET /schedules/all
List all schedule jobs across all repos.

\`\`\`bash
curl -H "Authorization: Bearer <token>" ${internalBaseUrl}/schedules/all
\`\`\`

### GET /schedules/all/runs
List all schedule runs across all repos with optional filtering.

Query params: \`limit\`, \`offset\`, \`status\`, \`repoId\`, \`jobId\`, \`triggerSource\`

\`\`\`bash
curl -H "Authorization: Bearer <token>" "${internalBaseUrl}/schedules/all/runs?limit=20"
\`\`\`

### GET /repos/:repoId/schedules
List all schedule jobs for a specific repo.

\`\`\`bash
curl -H "Authorization: Bearer <token>" ${internalBaseUrl}/repos/:repoId/schedules
\`\`\`

### POST /repos/:repoId/schedules
Create a new schedule job.

Body matches \`CreateScheduleJobRequest\` schema (discriminated union with \`scheduleMode: 'interval' | 'cron'\`).

\`\`\`bash
curl -X POST -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \\
  -d '{"name":"my-job","prompt":"do something","scheduleMode":"interval","intervalMinutes":60}' \\
  ${internalBaseUrl}/repos/:repoId/schedules
\`\`\`

### GET /repos/:repoId/schedules/:jobId
Get a specific schedule job.

\`\`\`bash
curl -H "Authorization: Bearer <token>" ${internalBaseUrl}/repos/:repoId/schedules/:jobId
\`\`\`

### PATCH /repos/:repoId/schedules/:jobId
Update an existing schedule job.

Body matches \`UpdateScheduleJobRequest\` schema.

\`\`\`bash
curl -X PATCH -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \\
  -d '{"enabled":false}' \\
  ${internalBaseUrl}/repos/:repoId/schedules/:jobId
\`\`\`

### DELETE /repos/:repoId/schedules/:jobId
Delete a schedule job.

\`\`\`bash
curl -X DELETE -H "Authorization: Bearer <token>" ${internalBaseUrl}/repos/:repoId/schedules/:jobId
\`\`\`

### POST /repos/:repoId/schedules/:jobId/run
Manually trigger a schedule job.

\`\`\`bash
curl -X POST -H "Authorization: Bearer <token>" ${internalBaseUrl}/repos/:repoId/schedules/:jobId/run
\`\`\`

### GET /repos/:repoId/schedules/:jobId/runs
List runs for a specific job.

Query params: \`limit\`

\`\`\`bash
curl -H "Authorization: Bearer <token>" ${internalBaseUrl}/repos/:repoId/schedules/:jobId/runs?limit=20
\`\`\`

### GET /repos/:repoId/schedules/:jobId/runs/:runId
Get a specific schedule run.

\`\`\`bash
curl -H "Authorization: Bearer <token>" ${internalBaseUrl}/repos/:repoId/schedules/:jobId/runs/:runId
\`\`\`

### POST /repos/:repoId/schedules/:jobId/runs/:runId/cancel
Cancel a running schedule run.

\`\`\`bash
curl -X POST -H "Authorization: Bearer <token>" ${internalBaseUrl}/repos/:repoId/schedules/:jobId/runs/:runId/cancel
\`\`\`

## Safety

Always confirm destructive operations (\`DELETE\` jobs, \`cancel\` runs) with the user before executing.
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
  deps: { db: Database; apiBaseUrl: string },
  options?: AssistantModeInitRequest,
): Promise<AssistantModeStatus> {
  const assistantDir = getAssistantModeDirectory()

  await ensureDirectoryExists(assistantDir)

  const agentsMdPath = path.join(assistantDir, ASSISTANT_AGENTS_MD_FILENAME)
  const opencodeJsonPath = path.join(assistantDir, ASSISTANT_OPENCODE_CONFIG_FILENAME)
  const tokenPath = getInternalTokenPath(assistantDir)
  const skillPath = getSchedulesSkillPath(assistantDir)

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

  await ensureDirectoryExists(path.join(assistantDir, ASSISTANT_OPENCODE_DIR))
  await ensureDirectoryExists(path.join(assistantDir, ASSISTANT_OPENCODE_DIR, ASSISTANT_SKILLS_DIR, ASSISTANT_SCHEDULES_SKILL_DIR))

  const token = getOrCreateInternalToken(deps.db)
  const existingTokenContent = await fileExists(tokenPath) ? await readFileContent(tokenPath) : undefined
  const tokenCreated = !existingTokenContent || existingTokenContent.trim() !== token
  if (tokenCreated) {
    await writeFileContent(tokenPath, token)
  }

  const skillContent = buildSchedulesSkill(deps.apiBaseUrl)
  const existingSkillContent = await fileExists(skillPath) ? await readFileContent(skillPath) : undefined
  const skillCreated = !existingSkillContent || existingSkillContent !== skillContent
  if (skillCreated) {
    await writeFileContent(skillPath, skillContent)
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
    internalToken: {
      path: tokenPath,
      created: tokenCreated,
    },
    schedulesSkill: {
      path: skillPath,
      created: skillCreated,
    },
  }
}

async function isLegacyAssistantOpenCodeConfig(opencodeJsonPath: string): Promise<boolean> {
  try {
    const content = await readFileContent(opencodeJsonPath)
    const config = JSON.parse(content) as {
      permission?: { allow?: unknown; ask?: unknown }
    }
    if (Array.isArray(config.permission?.allow) || Array.isArray(config.permission?.ask)) return true
    return false
  } catch {
    return false
  }
}

export async function getAssistantModeStatus(repo: Repo): Promise<AssistantModeStatus> {
  const assistantDir = getAssistantModeDirectory()

  const agentsMdPath = path.join(assistantDir, ASSISTANT_AGENTS_MD_FILENAME)
  const opencodeJsonPath = path.join(assistantDir, ASSISTANT_OPENCODE_CONFIG_FILENAME)
  const tokenPath = getInternalTokenPath(assistantDir)
  const skillPath = getSchedulesSkillPath(assistantDir)

  const agentsMdExists = await fileExists(agentsMdPath)
  const opencodeJsonExists = await fileExists(opencodeJsonPath)
  await fileExists(tokenPath)
  await fileExists(skillPath)

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
    internalToken: {
      path: tokenPath,
      created: false,
    },
    schedulesSkill: {
      path: skillPath,
      created: false,
    },
  }
}
