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
import { getReposPath, ENV } from '@opencode-manager/shared/config/env'
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
const ASSISTANT_NOTIFICATIONS_SKILL_DIR = 'notifications'
const ASSISTANT_SETTINGS_SKILL_DIR = 'manager-settings'
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

function getNotificationsSkillPath(assistantDir: string): string {
  return path.join(assistantDir, ASSISTANT_OPENCODE_DIR, ASSISTANT_SKILLS_DIR, ASSISTANT_NOTIFICATIONS_SKILL_DIR, ASSISTANT_SKILL_FILENAME)
}

function getSettingsSkillPath(assistantDir: string): string {
  return path.join(assistantDir, ASSISTANT_OPENCODE_DIR, ASSISTANT_SKILLS_DIR, ASSISTANT_SETTINGS_SKILL_DIR, ASSISTANT_SKILL_FILENAME)
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

## Notifications

This workspace includes a skill at \`.opencode/skills/notifications/SKILL.md\` for sending push notifications to the user's registered devices via the internal HTTP API. Load it when you need to notify the user about important events.

## Settings Management

This workspace includes a skill at \`.opencode/skills/manager-settings/SKILL.md\` for reading and safely modifying user preferences via the internal HTTP API. Load it when you need to inspect or update UI settings.
`
}

function toLocalhostInternalBaseUrl(baseUrl: string): string {
  const url = new URL(baseUrl)
  url.protocol = 'http'
  url.hostname = 'localhost'
  url.port = String(ENV.SERVER.PORT)
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

export function buildNotificationsSkill(baseUrl: string): string {
  const internalBaseUrl = toLocalhostInternalBaseUrl(baseUrl)

  return `---
name: notifications
description: Send push notifications to the user's registered devices via the internal HTTP API
---

## When to Load

Load this skill when you need to notify the user about important events, completed tasks, or questions that require their attention.

## Authentication

All API calls require a bearer token. Read the token from \`.opencode/internal-token\` (relative to the assistant workspace cwd) and pass it as:

\`\`\`
Authorization: Bearer <token>
\`\`\`

## Base URL

\`${internalBaseUrl}\`

## Endpoint

### POST /notifications/send

Send a push notification to all of the user's registered devices.

**Query Parameters:**
- \`userId\` (optional): User ID. Defaults to \`"default"\`.

**Request Body:**
\`\`\`ts
{
  title: string       // 1-120 characters
  body: string        // 1-500 characters
  url?: string        // Optional: deep link to navigate to (1-500 chars)
  tag?: string        // Optional: notification tag for deduplication (max 80 chars)
  priority?: 'normal' | 'high'  // Defaults to 'normal'
}
\`\`\`

**Example:**
\`\`\`bash
curl -X POST -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{"title":"Task Complete","body":"The build has finished successfully","url":"/repos/my-repo","priority":"high"}' \\
  "${internalBaseUrl}/notifications/send?userId=default"
\`\`\`

**Response:**
\`\`\`ts
{
  delivered: number       // Number of successfully delivered notifications
  expired: number         // Number of expired subscriptions removed
  failed: number          // Number of failed deliveries
  noSubscriptions: boolean // True if user has no registered devices
}
\`\`\`

## Rate Limiting

The endpoint enforces a rate limit of **10 requests per minute per token**. If exceeded, you'll receive a \`429 Too Many Requests\` response with a \`Retry-After\` header.

## Notes

- Notifications are only sent if the user has registered devices (browser push subscriptions)
- If VAPID is not configured on the server, the endpoint returns \`503 Service Unavailable\`
- Use \`priority: 'high'\` for urgent notifications that should interrupt the user
`
}

export function buildSettingsSkill(baseUrl: string): string {
  const internalBaseUrl = toLocalhostInternalBaseUrl(baseUrl)

  return `---
name: manager-settings
description: Read and modify safe user preferences via the internal HTTP API
---

## When to Load

Load this skill when you need to inspect or update the user's UI preferences, theme, mode, or other non-sensitive settings.

## Authentication

All API calls require a bearer token. Read the token from \`.opencode/internal-token\` (relative to the assistant workspace cwd) and pass it as:

\`\`\`
Authorization: Bearer <token>
\`\`\`

## Base URL

\`${internalBaseUrl}\`

## Endpoints

### GET /settings

Retrieve the user's full settings, including all preferences.

**Query Parameters:**
- \`userId\` (optional): User ID. Defaults to \`"default"\`.

**Example:**
\`\`\`bash
curl -H "Authorization: Bearer <token>" "${internalBaseUrl}/settings?userId=default"
\`\`\`

**Response:**
\`\`\`ts
{
  preferences: {
    theme: 'dark' | 'light' | 'system',
    mode: 'plan' | 'build',
    defaultModel?: string,
    defaultAgent?: string,
    autoScroll: boolean,
    expandDiffs: boolean,
    expandToolCalls: boolean,
    showReasoning: boolean,
    simpleChatMode: boolean,
    leaderKey?: string,
    directShortcuts?: string[],
    keyboardShortcuts: Record<string, string>,
    customCommands: Array<{ name: string; description: string; promptTemplate: string }>,
    notifications?: { enabled: boolean; ... },
    repoOrder?: number[],
    repoSortMode: 'recent' | 'manual' | 'name',
    // ... other safe preferences
  },
  updatedAt: number
}
\`\`\`

### PATCH /settings

Update a subset of safe user preferences.

**Allowed Keys:**
The following preference keys can be modified:
- \`theme\`, \`mode\`, \`defaultModel\`, \`defaultAgent\`
- \`autoScroll\`, \`expandDiffs\`, \`expandToolCalls\`, \`showReasoning\`
- \`simpleChatMode\`, \`leaderKey\`, \`directShortcuts\`
- \`keyboardShortcuts\`, \`customCommands\`, \`notifications\`
- \`repoOrder\`, \`repoSortMode\`

**DO NOT attempt to set:**
- \`gitCredentials\` - Git credentials must be managed via the full UI
- \`gitIdentity\` - Git identity must be managed via the full UI
- \`tts.apiKey\` - TTS credentials must be managed via the full UI
- \`stt.apiKey\` - STT credentials must be managed via the full UI
- \`lastKnownGoodConfig\` - Internal state, do not modify
- Any other keys not in the allowed list above

**Request Body:**
Partial object with any of the allowed keys.

**Example:**
\`\`\`bash
curl -X PATCH -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{"theme":"dark","mode":"build"}' \\
  "${internalBaseUrl}/settings?userId=default"
\`\`\`

**Response:**
Returns the updated settings object with the same structure as GET.

## Safety

- This API intentionally rejects any attempt to modify credentials, API keys, or other sensitive settings
- If you need to change credentials (Git, TTS, STT, etc.), guide the user to use the full UI
- The settings PATCH endpoint does NOT trigger OpenCode reload or restart
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
  await ensureDirectoryExists(path.join(assistantDir, ASSISTANT_OPENCODE_DIR, ASSISTANT_SKILLS_DIR, ASSISTANT_NOTIFICATIONS_SKILL_DIR))
  await ensureDirectoryExists(path.join(assistantDir, ASSISTANT_OPENCODE_DIR, ASSISTANT_SKILLS_DIR, ASSISTANT_SETTINGS_SKILL_DIR))

  const token = getOrCreateInternalToken(deps.db)
  const existingTokenContent = await fileExists(tokenPath) ? await readFileContent(tokenPath) : undefined
  const tokenCreated = !existingTokenContent || existingTokenContent.trim() !== token
  if (tokenCreated) {
    await writeFileContent(tokenPath, token)
  }

  const schedulesSkillContent = buildSchedulesSkill(deps.apiBaseUrl)
  const existingSchedulesSkillContent = await fileExists(skillPath) ? await readFileContent(skillPath) : undefined
  const schedulesSkillCreated = !existingSchedulesSkillContent || existingSchedulesSkillContent !== schedulesSkillContent
  if (schedulesSkillCreated) {
    await writeFileContent(skillPath, schedulesSkillContent)
  }

  const notificationsSkillPath = getNotificationsSkillPath(assistantDir)
  const notificationsSkillContent = buildNotificationsSkill(deps.apiBaseUrl)
  const existingNotificationsSkillContent = await fileExists(notificationsSkillPath) ? await readFileContent(notificationsSkillPath) : undefined
  const notificationsSkillCreated = !existingNotificationsSkillContent || existingNotificationsSkillContent !== notificationsSkillContent
  if (notificationsSkillCreated) {
    await writeFileContent(notificationsSkillPath, notificationsSkillContent)
  }

  const settingsSkillPath = getSettingsSkillPath(assistantDir)
  const settingsSkillContent = buildSettingsSkill(deps.apiBaseUrl)
  const existingSettingsSkillContent = await fileExists(settingsSkillPath) ? await readFileContent(settingsSkillPath) : undefined
  const settingsSkillCreated = !existingSettingsSkillContent || existingSettingsSkillContent !== settingsSkillContent
  if (settingsSkillCreated) {
    await writeFileContent(settingsSkillPath, settingsSkillContent)
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
      created: schedulesSkillCreated,
    },
    notificationsSkill: {
      path: notificationsSkillPath,
      created: notificationsSkillCreated,
    },
    settingsSkill: {
      path: settingsSkillPath,
      created: settingsSkillCreated,
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
  const notificationsSkillPath = getNotificationsSkillPath(assistantDir)
  const settingsSkillPath = getSettingsSkillPath(assistantDir)

  const agentsMdExists = await fileExists(agentsMdPath)
  const opencodeJsonExists = await fileExists(opencodeJsonPath)
  await fileExists(tokenPath)
  await fileExists(skillPath)
  await fileExists(notificationsSkillPath)
  await fileExists(settingsSkillPath)

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
    notificationsSkill: {
      path: notificationsSkillPath,
      created: false,
    },
    settingsSkill: {
      path: settingsSkillPath,
      created: false,
    },
  }
}
