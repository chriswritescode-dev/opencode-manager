import path from 'path'
import { createHash } from 'node:crypto'
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
import { ASSISTANT_NOTIFICATION_LIMITS, OpenCodeConfigSchema } from '@opencode-manager/shared/schemas'
import { ASSISTANT_REPO_ID, ASSISTANT_REPO_PATH, ASSISTANT_OPENCODE_DIR_NAME } from '@opencode-manager/shared/utils'
import { getAssistantModePath, getReposPath } from '@opencode-manager/shared/config/env'
import type { Database } from 'bun:sqlite'
import { MANAGER_TOOL_NAME } from './opencode-manager-tool-plugin'
import { ensureAssistantRepo } from '../db/queries'


const ASSISTANT_MODE_DIR = ASSISTANT_REPO_PATH
const ASSISTANT_MODE_RELATIVE_PATH = 'repos/assistant'
const ASSISTANT_AGENTS_MD_FILENAME = 'AGENTS.md'
const ASSISTANT_OPENCODE_CONFIG_FILENAME = 'opencode.json'
const ASSISTANT_OPENCODE_DIR = ASSISTANT_OPENCODE_DIR_NAME
const ASSISTANT_SKILLS_DIR = 'skills'
const ASSISTANT_SCHEDULES_SKILL_DIR = 'schedule-management'
const ASSISTANT_NOTIFICATIONS_SKILL_DIR = 'notifications'
const ASSISTANT_SETTINGS_SKILL_DIR = 'manager-settings'
const ASSISTANT_REPOS_SKILL_DIR = 'repo-management'
const ASSISTANT_SKILL_FILENAME = 'SKILL.md'
const ASSISTANT_AGENTS_DIR = 'agents'
const ASSISTANT_DEFAULT_AGENT_NAME = 'assistant'
const ASSISTANT_DEFAULT_AGENT_FILENAME = `${ASSISTANT_DEFAULT_AGENT_NAME}.md`

export function getAssistantModeDirectory(): string {
  const assistantDir = getAssistantModePath()
  const resolvedReposRoot = path.resolve(getReposPath())
  const resolvedAssistantDir = path.resolve(assistantDir)

  if (!resolvedAssistantDir.startsWith(resolvedReposRoot)) {
    throw new Error('Assistant mode directory must be within repos root')
  }

  return resolvedAssistantDir
}

export function buildAssistantRepo(): Repo {
  return {
    id: ASSISTANT_REPO_ID,
    localPath: ASSISTANT_MODE_DIR,
    fullPath: getAssistantModeDirectory(),
    defaultBranch: 'main',
    cloneStatus: 'ready',
    clonedAt: Date.now(),
    isWorktree: false,
    isLocal: false,
  }
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

function getReposSkillPath(assistantDir: string): string {
  return path.join(assistantDir, ASSISTANT_OPENCODE_DIR, ASSISTANT_SKILLS_DIR, ASSISTANT_REPOS_SKILL_DIR, ASSISTANT_SKILL_FILENAME)
}

function getAssistantDefaultAgentPath(assistantDir: string): string {
  return path.join(
    assistantDir,
    ASSISTANT_OPENCODE_DIR,
    ASSISTANT_AGENTS_DIR,
    ASSISTANT_DEFAULT_AGENT_FILENAME,
  )
}

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function hasSameContentHash(existingContent: string | undefined, generatedContent: string): boolean {
  return existingContent !== undefined && hashContent(existingContent) === hashContent(generatedContent)
}

function buildLegacyAssistantAgentsMd(): string {
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

## Repo Management

This workspace includes a skill at \`.opencode/skills/repo-management/SKILL.md\` for listing repos available to OpenCode Manager via the internal HTTP API. Load it before the schedule-management skill when you don't know the repo ID.

## Schedule Management

This workspace ships with a workspace-scoped skill at \`.opencode/skills/schedule-management/SKILL.md\` that documents how to list, create, update, delete, run, inspect, and cancel schedule jobs and runs across any repo via the internal HTTP API. Load it whenever the user asks about schedules.

## Notifications

This workspace includes a skill at \`.opencode/skills/notifications/SKILL.md\` for sending push notifications to the user's registered devices via the internal HTTP API. Load it when you need to notify the user about important events.

## Settings Management

This workspace includes a skill at \`.opencode/skills/manager-settings/SKILL.md\` for reading and safely modifying user preferences via the internal HTTP API. Load it when you need to inspect or update UI settings.
`
}

function buildLegacyAssistantAgentPrompt(): string {
  return [
    'You are the default Assistant Mode agent for OpenCode Manager.',
    '',
    'This workspace is the shared assistant workspace. Help the user manage repos, schedules, notifications, settings, and assistant behavior safely.',
    '',
    'Use the workspace skills when relevant:',
    '- Load repo-management before schedule-management when you need a repo ID.',
    '- Load schedule-management for schedule jobs and runs.',
    '- Load notifications when the user should be notified about important events.',
    '- Load manager-settings when reading or safely updating UI preferences.',
    '',
    'Preserve user-customized workspace files unless the user explicitly asks you to change them.',
    'Ask before destructive operations or changes outside this assistant workspace.',
  ].join('\n')
}

function buildAssistantDefaultAgentMdFromPrompt(prompt: string): string {
  const permission = buildAssistantAgentPermission()

  return `---
description: Default OpenCode Manager assistant workspace agent
mode: primary
permission:
  read: ${permission.read}
  edit: ${permission.edit}
  glob: ${permission.glob}
  grep: ${permission.grep}
  list: ${permission.list}
  bash: ${permission.bash}
  external_directory: ${permission.external_directory}
---

${prompt}
`
}

function buildLegacyAssistantDefaultAgentMd(): string {
  return buildAssistantDefaultAgentMdFromPrompt(buildLegacyAssistantAgentPrompt())
}

function buildPreviousAssistantAgentsMd(): string {
  return `# Assistant Mode Workspace

This directory is the shared Assistant Mode workspace for OpenCode Manager.

## Directory Contents

- \`opencode.json\` configures this workspace and selects the default assistant agent.
- \`.opencode/agents/assistant.md\` contains the default assistant agent instructions, behavior, durable preferences, and self-editing rules.
- \`.opencode/skills/\` contains managed workspace skills for repos, schedules, notifications, and settings.
- \`.opencode/internal-token\` is managed by OpenCode Manager for internal API authentication.

Assistant-specific instructions belong in \`.opencode/agents/assistant.md\`.
`
}

function matchesGeneratedAssistantAgentsMd(content: string): boolean {
  const currentHash = hashContent(buildAssistantAgentsMd())
  const previousHash = hashContent(buildPreviousAssistantAgentsMd())
  const legacyHash = hashContent(buildLegacyAssistantAgentsMd())
  const contentHash = hashContent(content)
  return contentHash === currentHash || contentHash === previousHash || contentHash === legacyHash
}

function matchesGeneratedAssistantDefaultAgentMd(content: string): boolean {
  const currentHash = hashContent(buildAssistantDefaultAgentMd())
  const previousHash = hashContent(buildPreviousAssistantDefaultAgentMd())
  const legacyHash = hashContent(buildLegacyAssistantDefaultAgentMd())
  const contentHash = hashContent(content)
  return contentHash === currentHash || contentHash === previousHash || contentHash === legacyHash
}

function matchesGeneratedAssistantAgentPrompt(content: unknown): content is string {
  if (typeof content !== 'string') return false
  const currentHash = hashContent(buildAssistantAgentPrompt())
  const previousHash = hashContent(buildPreviousAssistantAgentPrompt())
  const legacyHash = hashContent(buildLegacyAssistantAgentPrompt())
  const contentHash = hashContent(content)
  return contentHash === currentHash || contentHash === previousHash || contentHash === legacyHash
}

function containsLegacyAssistantAgentsGuidance(content: string): boolean {
  return content.includes('## Self-Editing Rules') &&
    content.includes('AGENTS.md') &&
    content.includes('durable preferences')
}

export function buildAssistantAgentsMd(): string {
  return `# Assistant Mode Workspace

This directory is the shared Assistant Mode workspace for OpenCode Manager.

## Directory Contents

- \`opencode.json\` configures this workspace and selects the default assistant agent.
- \`.opencode/agents/assistant.md\` contains the default assistant agent instructions, behavior, durable preferences, and self-editing rules.
- \`.opencode/skills/\` contains managed workspace skills for repos, schedules, notifications, and settings.

Assistant-specific instructions belong in \`.opencode/agents/assistant.md\`.
`
}

function buildPreviousAssistantAgentPrompt(): string {
  return [
    'You are the default Assistant Mode agent for OpenCode Manager.',
    '',
    'This workspace is the shared assistant workspace for OpenCode Manager. Help the user manage repos, schedules, notifications, settings, and assistant behavior safely.',
    '',
    '## Self-Editing Rules',
    '',
    'Durable assistant instructions, behavior, and preferences belong in `.opencode/agents/assistant.md`. Edit that file when the user expresses lasting preferences or when you need to refine your behavior.',
    '',
    'The workspace directory explanation belongs in `AGENTS.md`. Keep that file focused on describing the directory contents and pointing to managed files.',
    '',
    'Preserve user-customized workspace files unless the user explicitly asks you to change them. Ask before making significant, destructive, or out-of-workspace changes.',
    '',
    '## Skill Usage',
    '',
    'Use the workspace skills when relevant:',
    '- Load `repo-management` before `schedule-management` when you need a repo ID.',
    '- Load `schedule-management` for schedule jobs and runs.',
    '- Load `notifications` when the user should be notified about important events.',
    '- Load `manager-settings` when reading or safely updating UI preferences.',
  ].join('\n')
}

function buildAssistantAgentPrompt(): string {
  return [
    'You are the default Assistant Mode agent for OpenCode Manager.',
    '',
    'This workspace is the shared assistant workspace for OpenCode Manager. Help the user manage repos, schedules, notifications, settings, and assistant behavior safely.',
    '',
    '## Self-Editing Rules',
    '',
    'Durable assistant instructions, behavior, and preferences belong in `.opencode/agents/assistant.md`. Edit that file when the user expresses lasting preferences or when you need to refine your behavior.',
    '',
    'The workspace directory explanation belongs in `AGENTS.md`. Keep that file focused on describing the directory contents and pointing to managed files.',
    '',
    'Preserve user-customized workspace files unless the user explicitly asks you to change them. Ask before making significant, destructive, or out-of-workspace changes.',
    '',
    'After editing `.opencode/agents/assistant.md`, load `manager-settings` and call `POST /assistant/reload` to apply changes. Always ask the user before reloading.',
    '',
    '## Skill Usage',
    '',
    'Use the workspace skills when relevant:',
    '- Load `repo-management` before `schedule-management` when you need a repo ID.',
    '- Load `schedule-management` for schedule jobs and runs.',
    '- Load `notifications` when the user should be notified about important events.',
    '- Load `manager-settings` when reading or safely updating UI preferences.',
  ].join('\n')
}

function buildAssistantAgentPermission(): { read: 'allow'; edit: 'allow'; glob: 'allow'; grep: 'allow'; list: 'allow'; bash: 'allow'; external_directory: 'ask' } {
  return {
    read: 'allow',
    edit: 'allow',
    glob: 'allow',
    grep: 'allow',
    list: 'allow',
    bash: 'allow',
    external_directory: 'ask',
  }
}

function buildPreviousAssistantDefaultAgentMd(): string {
  return buildAssistantDefaultAgentMdFromPrompt(buildPreviousAssistantAgentPrompt())
}

export function buildAssistantDefaultAgentMd(): string {
  return buildAssistantDefaultAgentMdFromPrompt(buildAssistantAgentPrompt())
}

export function buildSchedulesSkill(): string {
  return `---
name: schedule-management
description: Manage schedule jobs and runs across any repo with the ${MANAGER_TOOL_NAME} tool
---

## When to Load

Load this skill when the user asks about managing schedules, schedule jobs, schedule runs, or anything related to automated task execution across repos.

## Tool

Use the \`${MANAGER_TOOL_NAME}\` tool with the \`request\` action. The tool runs inside OpenCode Manager, so it needs no token, no base URL, and no network access from the shell. It works the same in a normal session, a sandboxed session, and a scheduled run. Paths are relative to the internal API (for example \`/schedules/all\` or \`/repos/0/schedules\`) and query strings are allowed.

**Arguments:**
\`\`\`ts
{
  action: 'request',
  params: {
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string   // relative internal API path; query strings allowed
    body?: object  // JSON body for POST and PATCH routes
  }
}
\`\`\`

## Assistant Schedules

Use repo ID \`0\` for the built-in Assistant. For example, use \`/repos/0/schedules\` to list or create schedule jobs that run in the Assistant workspace.

## Endpoints

### GET /schedules/all
List all schedule jobs across all repos.

\`\`\`json
{
  "action": "request",
  "params": {
    "method": "GET",
    "path": "/schedules/all"
  }
}
\`\`\`

### GET /schedules/all/runs
List all schedule runs across all repos with optional filtering.

Query params: \`limit\`, \`offset\`, \`status\`, \`repoId\`, \`jobId\`, \`triggerSource\`

\`\`\`json
{
  "action": "request",
  "params": {
    "method": "GET",
    "path": "/schedules/all/runs?limit=20"
  }
}
\`\`\`

### GET /repos/:repoId/schedules
List all schedule jobs for a specific repo.

\`\`\`json
{
  "action": "request",
  "params": {
    "method": "GET",
    "path": "/repos/:repoId/schedules"
  }
}
\`\`\`

### POST /repos/:repoId/schedules
Create a new schedule job.

Body matches \`CreateScheduleJobRequest\` schema (discriminated union with \`scheduleMode: 'interval' | 'cron'\`).

\`\`\`json
{
  "action": "request",
  "params": {
    "method": "POST",
    "path": "/repos/:repoId/schedules",
    "body": {
      "name": "my-job",
      "prompt": "do something",
      "scheduleMode": "interval",
      "intervalMinutes": 60
    }
  }
}
\`\`\`

### GET /repos/:repoId/schedules/:jobId
Get a specific schedule job.

\`\`\`json
{
  "action": "request",
  "params": {
    "method": "GET",
    "path": "/repos/:repoId/schedules/:jobId"
  }
}
\`\`\`

### PATCH /repos/:repoId/schedules/:jobId
Update an existing schedule job.

Body matches \`UpdateScheduleJobRequest\` schema.

\`\`\`json
{
  "action": "request",
  "params": {
    "method": "PATCH",
    "path": "/repos/:repoId/schedules/:jobId",
    "body": {
      "enabled": false
    }
  }
}
\`\`\`

### DELETE /repos/:repoId/schedules/:jobId
Delete a schedule job.

\`\`\`json
{
  "action": "request",
  "params": {
    "method": "DELETE",
    "path": "/repos/:repoId/schedules/:jobId"
  }
}
\`\`\`

### POST /repos/:repoId/schedules/:jobId/run
Manually trigger a schedule job.

\`\`\`json
{
  "action": "request",
  "params": {
    "method": "POST",
    "path": "/repos/:repoId/schedules/:jobId/run"
  }
}
\`\`\`

### GET /repos/:repoId/schedules/:jobId/runs
List runs for a specific job.

Query params: \`limit\`

\`\`\`json
{
  "action": "request",
  "params": {
    "method": "GET",
    "path": "/repos/:repoId/schedules/:jobId/runs?limit=20"
  }
}
\`\`\`

### GET /repos/:repoId/schedules/:jobId/runs/:runId
Get a specific schedule run.

\`\`\`json
{
  "action": "request",
  "params": {
    "method": "GET",
    "path": "/repos/:repoId/schedules/:jobId/runs/:runId"
  }
}
\`\`\`

### POST /repos/:repoId/schedules/:jobId/runs/:runId/cancel
Cancel a running schedule run.

\`\`\`json
{
  "action": "request",
  "params": {
    "method": "POST",
    "path": "/repos/:repoId/schedules/:jobId/runs/:runId/cancel"
  }
}
\`\`\`

## Safety

Always confirm destructive operations (\`DELETE\` jobs, \`cancel\` runs) with the user before executing.
`
}

export function buildNotificationsSkill(): string {
  return `---
name: notifications
description: Send push notifications to the user's registered devices with the ${MANAGER_TOOL_NAME} tool
---

## When to Load

Load this skill when you need to notify the user about important events, completed tasks, or questions that require their attention.

## Tool

Use the \`${MANAGER_TOOL_NAME}\` tool with the \`send_notification\` action. The tool runs inside OpenCode Manager, so it needs no token, no base URL, and no network access from the shell. It works the same in a normal session, a sandboxed session, and a scheduled run.

The tool declares its arguments as a typed schema, so the editor and the model both see the exact shape and the tool call is rejected before it runs if it does not match.

**Arguments:**
\`\`\`ts
{
  action: 'send_notification',
  params: {
    title: string       // 1-${ASSISTANT_NOTIFICATION_LIMITS.TITLE_MAX} characters
    body: string        // 1-${ASSISTANT_NOTIFICATION_LIMITS.BODY_MAX} characters
    url?: string        // Optional: deep link to navigate to (1-${ASSISTANT_NOTIFICATION_LIMITS.URL_MAX} chars)
    tag?: string        // Optional: notification tag for deduplication (max ${ASSISTANT_NOTIFICATION_LIMITS.TAG_MAX} chars)
    priority?: 'normal' | 'high'  // Defaults to 'normal'
  }
}
\`\`\`

**Example:**
\`\`\`json
{
  "action": "send_notification",
  "params": {
    "title": "Task Complete",
    "body": "The build has finished successfully",
    "url": "/repos/my-repo",
    "priority": "high"
  }
}
\`\`\`

The tool reports how many devices the notification was delivered to, and says so explicitly when the user has no registered devices.

## Rate Limiting

Sending is rate limited to **10 notifications per minute**. Beyond that the tool fails with a \`429\` status; wait before retrying.

## Notes

- Notifications are only sent if the user has registered devices (browser push subscriptions)
- If VAPID is not configured on the server, the tool fails with a \`503\` status
- Use \`priority: 'high'\` for urgent notifications that should interrupt the user
- Do not call the internal HTTP API with \`curl\` for notifications; the tool is the supported path
`
}

export function buildSettingsSkill(): string {
  return `---
name: manager-settings
description: Read and modify safe user preferences with the ${MANAGER_TOOL_NAME} tool
---

## When to Load

Load this skill when you need to inspect or update the user's UI preferences, theme, mode, or other non-sensitive settings.

## Tool

Use the \`${MANAGER_TOOL_NAME}\` tool with the \`request\` action. The tool runs inside OpenCode Manager, so it needs no token, no base URL, and no network access from the shell. It works the same in a normal session, a sandboxed session, and a scheduled run. Paths are relative to the internal API (for example \`/settings\` or \`/assistant/reload\`) and query strings are allowed.

**Arguments:**
\`\`\`ts
{
  action: 'request',
  params: {
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string   // relative internal API path; query strings allowed
    body?: object  // JSON body for POST and PATCH routes
  }
}
\`\`\`

## Endpoints

### GET /settings

Retrieve the user's full settings, including all preferences.

**Query Parameters:**
- \`userId\` (optional): User ID. Defaults to \`"default"\`.

**Example:**
\`\`\`json
{
  "action": "request",
  "params": {
    "method": "GET",
    "path": "/settings?userId=default"
  }
}
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
- \`tts\` — Non-secret TTS preferences (\`enabled\`, \`provider\`, \`autoPlay\`, \`voice\`, \`model\`, \`speed\`). TTS must already be configured in the UI (the endpoint returns 400 otherwise).
- \`stt\` — Non-secret STT preferences (\`enabled\`, \`provider\`, \`model\`, \`language\`). STT must already be configured in the UI (the endpoint returns 400 otherwise).

**DO NOT attempt to set:**
- \`gitCredentials\` - Git credentials must be managed via the full UI
- \`gitIdentity\` - Git identity must be managed via the full UI
- \`tts.apiKey\` - TTS credentials must be managed via the full UI
- \`tts.endpoint\` - TTS endpoint must be managed via the full UI
- \`stt.apiKey\` - STT credentials must be managed via the full UI
- \`stt.endpoint\` - STT endpoint must be managed via the full UI
- \`lastKnownGoodConfig\` - Internal state, do not modify
- Any other keys not in the allowed list above

**Request Body:**
Partial object with any of the allowed keys.

**Example:**
\`\`\`json
{
  "action": "request",
  "params": {
    "method": "PATCH",
    "path": "/settings?userId=default",
    "body": {
      "theme": "dark",
      "mode": "build"
    }
  }
}
\`\`\`

**Response:**
Returns the updated settings object with the same structure as GET.

### POST /assistant/reload

Reload the assistant workspace by disposing the current OpenCode instance. Use this after editing \`.opencode/agents/assistant.md\` or \`opencode.json\` so changes take effect on the next message.

**Note:** Always confirm with the user before reloading, as it re-bootstraps the workspace.

**Rate Limiting:** 5 requests per minute per token. Returns \`429 Too Many Requests\` with \`Retry-After\` header when exceeded.

**Example:**
\`\`\`json
{
  "action": "request",
  "params": {
    "method": "POST",
    "path": "/assistant/reload"
  }
}
\`\`\`

**Response:**
\`\`\`ts
{ "success": true }
\`\`\`

## Safety

- This API intentionally rejects any attempt to modify credentials, API keys, or other sensitive settings
- If you need to change credentials (Git, TTS, STT, etc.), guide the user to use the full UI
- The settings PATCH endpoint does NOT trigger OpenCode reload or restart
`
}

export function buildReposSkill(): string {
  return `---
name: repo-management
description: List repos available to OpenCode Manager with the ${MANAGER_TOOL_NAME} tool
---

## When to Load

Load this skill when you need to discover repos, look up repo IDs, or need to reference repo information before managing schedules. Load it before the schedule-management skill if you don't know the repo ID.

## Tool

Use the \`${MANAGER_TOOL_NAME}\` tool with the \`request\` action. The tool runs inside OpenCode Manager, so it needs no token, no base URL, and no network access from the shell. It works the same in a normal session, a sandboxed session, and a scheduled run. Paths are relative to the internal API (for example \`/repos\` or \`/repos/0/schedules\`) and query strings are allowed.

**Arguments:**
\`\`\`ts
{
  action: 'request',
  params: {
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string   // relative internal API path; query strings allowed
    body?: object  // JSON body for POST and PATCH routes
  }
}
\`\`\`

## Endpoints

### GET /repos

List all repos available to OpenCode Manager. The repos are returned in the order configured by the user (respecting \`repoOrder\` preference).

**Example:**
\`\`\`json
{
  "action": "request",
  "params": {
    "method": "GET",
    "path": "/repos"
  }
}
\`\`\`

**Response:**
\`\`\`ts
{
  repos: Array<{
    id: number          // Use as :repoId in other endpoints
    repoUrl?: string   // Git remote URL if cloned
    localPath: string  // Relative path under repos root
    fullPath: string   // Absolute local path
    sourcePath?: string // Source path for worktrees
    branch?: string    // Current branch (not always available)
    defaultBranch: string
    cloneStatus: 'cloning' | 'ready' | 'error'
    clonedAt: number   // Unix timestamp
    lastPulled?: number
    lastAccessedAt?: number
    openCodeConfigName?: string
    isWorktree?: boolean
    isLocal?: boolean
  }>
}
\`\`\`

## Notes

- Use \`id\` as \`:repoId\` in other API endpoints (e.g., \`/repos/:repoId/schedules\`)
- \`fullPath\` is the absolute local path - use it for file operations
- This endpoint is read-only - there are no POST/PUT/DELETE operations for repos
- \`currentBranch\` is not included in the response - it requires git operations to determine
- Repo order is controlled by the \`repoOrder\` preference in settings
`
}

export function buildAssistantOpenCodeConfig(): OpenCodeConfigInput {
  const config: OpenCodeConfigInput = {
    default_agent: ASSISTANT_DEFAULT_AGENT_NAME,
    instructions: ['AGENTS.md'],
    permission: buildAssistantAgentPermission(),
    agent: {
      [ASSISTANT_DEFAULT_AGENT_NAME]: { mode: 'primary' },
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
  options?: AssistantModeInitRequest,
): Promise<AssistantModeStatus> {
  const assistantDir = getAssistantModeDirectory()

  await ensureDirectoryExists(assistantDir)

  const agentsMdPath = path.join(assistantDir, ASSISTANT_AGENTS_MD_FILENAME)
  const opencodeJsonPath = path.join(assistantDir, ASSISTANT_OPENCODE_CONFIG_FILENAME)
  const skillPath = getSchedulesSkillPath(assistantDir)
  const assistantAgentPath = getAssistantDefaultAgentPath(assistantDir)

  const agentsMdExists = await fileExists(agentsMdPath)
  const opencodeJsonExists = await fileExists(opencodeJsonPath)

  const overwriteOpenCodeConfig = options?.overwriteOpenCodeConfig ?? false

  const overwriteAgentsMd = options?.overwriteAgentsMd ?? false
  const agentsMdContent = buildAssistantAgentsMd()
  const existingAgentsMdContent = agentsMdExists ? await readFileContent(agentsMdPath) : undefined

  const agentsMdShouldMigrate =
    existingAgentsMdContent !== undefined &&
    matchesGeneratedAssistantAgentsMd(existingAgentsMdContent) &&
    !hasSameContentHash(existingAgentsMdContent, agentsMdContent)

  const agentsMdHasPreservedLegacyGuidance =
    existingAgentsMdContent !== undefined &&
    !overwriteAgentsMd &&
    !matchesGeneratedAssistantAgentsMd(existingAgentsMdContent) &&
    containsLegacyAssistantAgentsGuidance(existingAgentsMdContent)

  const agentsMdCreated =
    !agentsMdExists ||
    overwriteAgentsMd ||
    agentsMdShouldMigrate

  if (agentsMdCreated && !hasSameContentHash(existingAgentsMdContent, agentsMdContent)) {
    await writeFileContent(agentsMdPath, agentsMdContent)
  }

  const hasLegacyOpenCodeConfig = opencodeJsonExists && await isLegacyAssistantOpenCodeConfig(opencodeJsonPath)

  let opencodeJsonUpdated = false
  if (!opencodeJsonExists || overwriteOpenCodeConfig || hasLegacyOpenCodeConfig) {
    const config = hasLegacyOpenCodeConfig && opencodeJsonExists
      ? await (async () => {
          try {
            const existingContent = await readFileContent(opencodeJsonPath)
            const existingConfig = JSON.parse(existingContent) as OpenCodeConfigInput
            const mergedConfig = mergeAssistantOpenCodeConfig(existingConfig)
            return assistantOpenCodeConfigHasGeneratedAgentPersona(mergedConfig)
              ? stripGeneratedAssistantAgentPersona(mergedConfig)
              : mergedConfig
          } catch {
            return buildAssistantOpenCodeConfig()
          }
        })()
      : buildAssistantOpenCodeConfig()
    await writeFileContent(opencodeJsonPath, JSON.stringify(config, null, 2))
    opencodeJsonUpdated = true
  } else if (opencodeJsonExists) {
    try {
      const existingContent = await readFileContent(opencodeJsonPath)
      const existingConfig = JSON.parse(existingContent) as OpenCodeConfigInput
      const repairedConfig = assistantOpenCodeConfigNeedsRepair(existingConfig)
        ? mergeAssistantOpenCodeConfig(existingConfig)
        : existingConfig
      const updatedConfig = assistantOpenCodeConfigHasGeneratedAgentPersona(repairedConfig)
        ? stripGeneratedAssistantAgentPersona(repairedConfig)
        : repairedConfig

      if (updatedConfig !== existingConfig) {
        await writeFileContent(opencodeJsonPath, JSON.stringify(updatedConfig, null, 2))
        opencodeJsonUpdated = true
      }
    } catch {
      const config = buildAssistantOpenCodeConfig()
      await writeFileContent(opencodeJsonPath, JSON.stringify(config, null, 2))
      opencodeJsonUpdated = true
    }
  }

  await ensureDirectoryExists(path.join(assistantDir, ASSISTANT_OPENCODE_DIR))
  await ensureDirectoryExists(path.join(assistantDir, ASSISTANT_OPENCODE_DIR, ASSISTANT_AGENTS_DIR))
  await ensureDirectoryExists(path.join(assistantDir, ASSISTANT_OPENCODE_DIR, ASSISTANT_SKILLS_DIR, ASSISTANT_SCHEDULES_SKILL_DIR))
  await ensureDirectoryExists(path.join(assistantDir, ASSISTANT_OPENCODE_DIR, ASSISTANT_SKILLS_DIR, ASSISTANT_NOTIFICATIONS_SKILL_DIR))
  await ensureDirectoryExists(path.join(assistantDir, ASSISTANT_OPENCODE_DIR, ASSISTANT_SKILLS_DIR, ASSISTANT_SETTINGS_SKILL_DIR))
  await ensureDirectoryExists(path.join(assistantDir, ASSISTANT_OPENCODE_DIR, ASSISTANT_SKILLS_DIR, ASSISTANT_REPOS_SKILL_DIR))

  const schedulesSkillContent = buildSchedulesSkill()
  const existingSchedulesSkillContent = await fileExists(skillPath) ? await readFileContent(skillPath) : undefined
  const schedulesSkillCreated = !hasSameContentHash(existingSchedulesSkillContent, schedulesSkillContent)
  if (schedulesSkillCreated) {
    await writeFileContent(skillPath, schedulesSkillContent)
  }

  const notificationsSkillPath = getNotificationsSkillPath(assistantDir)
  const notificationsSkillContent = buildNotificationsSkill()
  const existingNotificationsSkillContent = await fileExists(notificationsSkillPath) ? await readFileContent(notificationsSkillPath) : undefined
  const notificationsSkillCreated = !hasSameContentHash(existingNotificationsSkillContent, notificationsSkillContent)
  if (notificationsSkillCreated) {
    await writeFileContent(notificationsSkillPath, notificationsSkillContent)
  }

  const settingsSkillPath = getSettingsSkillPath(assistantDir)
  const settingsSkillContent = buildSettingsSkill()
  const existingSettingsSkillContent = await fileExists(settingsSkillPath) ? await readFileContent(settingsSkillPath) : undefined
  const settingsSkillCreated = !hasSameContentHash(existingSettingsSkillContent, settingsSkillContent)
  if (settingsSkillCreated) {
    await writeFileContent(settingsSkillPath, settingsSkillContent)
  }

  const reposSkillPath = getReposSkillPath(assistantDir)
  const reposSkillContent = buildReposSkill()
  const existingReposSkillContent = await fileExists(reposSkillPath) ? await readFileContent(reposSkillPath) : undefined
  const reposSkillCreated = !hasSameContentHash(existingReposSkillContent, reposSkillContent)
  if (reposSkillCreated) {
    await writeFileContent(reposSkillPath, reposSkillContent)
  }

  const assistantAgentExists = await fileExists(assistantAgentPath)
  const assistantAgentContent = buildAssistantDefaultAgentMd()
  const existingAssistantAgentContent = assistantAgentExists
    ? await readFileContent(assistantAgentPath)
    : undefined

  const assistantAgentShouldMigrate =
    existingAssistantAgentContent !== undefined &&
    matchesGeneratedAssistantDefaultAgentMd(existingAssistantAgentContent) &&
    !hasSameContentHash(existingAssistantAgentContent, assistantAgentContent)

  const assistantAgentCreated = !assistantAgentExists || assistantAgentShouldMigrate

  if (assistantAgentCreated) {
    await writeFileContent(assistantAgentPath, assistantAgentContent)
  }

  const managedUpdatesApplied = agentsMdCreated || opencodeJsonUpdated || assistantAgentCreated
  const warnings = managedUpdatesApplied && agentsMdHasPreservedLegacyGuidance
    ? [
        {
          code: 'assistant-agents-md-preserved',
          path: agentsMdPath,
          message: 'Some Assistant Mode instruction updates were not applied because AGENTS.md appears to contain customized legacy assistant instructions. To regenerate the default workspace explanation, manually delete AGENTS.md and initialize Assistant Mode again.',
        },
      ]
    : undefined

  return {
    repoId: repo.id,
    directory: assistantDir,
    relativePath: ASSISTANT_MODE_RELATIVE_PATH,
    warnings,
    files: {
      agentsMd: {
        path: agentsMdPath,
        exists: true,
        created: agentsMdCreated,
      },
      opencodeJson: {
        path: opencodeJsonPath,
        exists: true,
        created: opencodeJsonUpdated,
      },
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
    repoManagementSkill: {
      path: reposSkillPath,
      created: reposSkillCreated,
    },
    defaultAgent: {
      name: ASSISTANT_DEFAULT_AGENT_NAME,
      path: assistantAgentPath,
      exists: true,
      created: assistantAgentCreated,
    },
  }
}

function assistantOpenCodeConfigNeedsRepair(config: OpenCodeConfigInput): boolean {
  if (config.default_agent !== ASSISTANT_DEFAULT_AGENT_NAME) return true
  if (!config.agent || typeof config.agent !== 'object') return true
  const assistantAgent = config.agent[ASSISTANT_DEFAULT_AGENT_NAME]
  if (!assistantAgent || typeof assistantAgent !== 'object') return true
  const mode = (assistantAgent as { mode?: unknown }).mode
  if (mode !== 'primary' && mode !== 'all') return true
  if ((assistantAgent as { disable?: unknown }).disable === true) return true
  if (assistantOpenCodeConfigHasGeneratedAgentPersona(config)) return true
  return false
}

function assistantOpenCodeConfigHasGeneratedAgentPersona(config: OpenCodeConfigInput): boolean {
  const agent = config.agent?.[ASSISTANT_DEFAULT_AGENT_NAME]
  if (typeof agent !== 'object' || agent === null) return false
  const prompt = (agent as { prompt?: unknown }).prompt
  return matchesGeneratedAssistantAgentPrompt(prompt)
}

function resolveValidAssistantMode(agent: unknown): 'primary' | 'all' {
  const mode = (agent as { mode?: unknown } | undefined)?.mode
  return mode === 'primary' || mode === 'all' ? mode : 'primary'
}

function stripGeneratedAssistantAgentPersona(config: OpenCodeConfigInput): OpenCodeConfigInput {
  const existingAssistantAgent = config.agent?.[ASSISTANT_DEFAULT_AGENT_NAME]
  const validMode = resolveValidAssistantMode(existingAssistantAgent)

  return {
    ...config,
    agent: {
      ...(config.agent ?? {}),
      [ASSISTANT_DEFAULT_AGENT_NAME]: { mode: validMode },
    },
  }
}

function mergeAssistantOpenCodeConfig(existing?: OpenCodeConfigInput): OpenCodeConfigInput {
  const generated = buildAssistantOpenCodeConfig()
  const existingAssistantAgent = existing?.agent?.[ASSISTANT_DEFAULT_AGENT_NAME]
  const validMode = resolveValidAssistantMode(existingAssistantAgent)

  const existingIsGenerated = existingAssistantAgent != null &&
    typeof existingAssistantAgent === 'object' &&
    matchesGeneratedAssistantAgentPrompt(
      (existingAssistantAgent as { prompt?: unknown }).prompt,
    )

  let mergedAssistantAgent: Record<string, unknown>
  if (existingIsGenerated) {
    mergedAssistantAgent = { mode: validMode }
  } else {
    mergedAssistantAgent = {
      ...(typeof existingAssistantAgent === 'object' && existingAssistantAgent !== null ? existingAssistantAgent : {}),
      mode: validMode,
      disable: false,
    }
  }

  return {
    ...generated,
    ...existing,
    default_agent: ASSISTANT_DEFAULT_AGENT_NAME,
    instructions: existing?.instructions ?? generated.instructions,
    permission: existing?.permission ?? generated.permission,
    agent: {
      ...(existing?.agent ?? {}),
      [ASSISTANT_DEFAULT_AGENT_NAME]: mergedAssistantAgent,
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
  const skillPath = getSchedulesSkillPath(assistantDir)
  const notificationsSkillPath = getNotificationsSkillPath(assistantDir)
  const settingsSkillPath = getSettingsSkillPath(assistantDir)
  const reposSkillPath = getReposSkillPath(assistantDir)
  const assistantAgentPath = getAssistantDefaultAgentPath(assistantDir)

  const agentsMdExists = await fileExists(agentsMdPath)
  const opencodeJsonExists = await fileExists(opencodeJsonPath)
  const assistantAgentExists = await fileExists(assistantAgentPath)

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
    repoManagementSkill: {
      path: reposSkillPath,
      created: false,
    },
    defaultAgent: {
      name: ASSISTANT_DEFAULT_AGENT_NAME,
      path: assistantAgentPath,
      exists: assistantAgentExists,
      created: false,
    },
  }
}

export async function installAssistantWorkspace(deps: {
  db: Database
}): Promise<AssistantModeStatus> {
  const assistantRepo = ensureAssistantRepo(deps.db)

  return ensureAssistantMode(assistantRepo)
}
