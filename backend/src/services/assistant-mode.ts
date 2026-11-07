import path from 'path'
import { createHash } from 'node:crypto'
import type { Repo } from '@opencode-manager/shared/types'
import type {
  AssistantModeStatus,
  AssistantModeInitRequest,
} from '@opencode-manager/shared/types'
import {
  readFileContent,
  writeFileContent,
  fileExists,
  ensureDirectoryExists,
} from './file-operations'
import { ASSISTANT_NOTIFICATION_LIMITS, AssistantSettingsPatchSchema, DEFAULT_KEYBOARD_SHORTCUTS, DEFAULT_LEADER_KEY, MANAGER_TOOL_NAME } from '@opencode-manager/shared/schemas'
import { MANAGER_COLOR_THEME_ID, OPENCODE_THEMES } from '@opencode-manager/shared/themes'
import { ASSISTANT_REPO_ID, ASSISTANT_REPO_PATH, ASSISTANT_OPENCODE_DIR_NAME, isRecord, parseJsonc } from '@opencode-manager/shared/utils'
import { getAssistantModePath, getReposPath } from '@opencode-manager/shared/config/env'
import type { OpenCodeAgentConfig, OpenCodeApi, OpenCodeConfigInfo } from '@opencode-manager/shared/opencode'
import { validateOpenCodeConfig } from '@opencode-manager/shared/opencode/config-validation'
import type { Database } from 'bun:sqlite'
import { ensureAssistantRepo } from '../db/queries'
import { applyOpenCodeConfigEdits, removeOpenCodeConfigProperty, V1_ENTITY_PATHS, type OpenCodeConfigPathOperation } from './opencode-config-file'
import { readConfigValueAtPath, restoreOpenCodeConfigReferences } from './opencode-config-references'
import { readOpenCodeConfigDocuments } from './opencode-config-effective'
import { logger } from '../utils/logger'
import { withFileLock } from '../utils/atomic-json'


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
const ASSISTANT_SESSIONS_SKILL_DIR = 'session-management'
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

function getSessionsSkillPath(assistantDir: string): string {
  return path.join(assistantDir, ASSISTANT_OPENCODE_DIR, ASSISTANT_SKILLS_DIR, ASSISTANT_SESSIONS_SKILL_DIR, ASSISTANT_SKILL_FILENAME)
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

function buildAssistantDefaultAgentMdFromPrompt(prompt: string, shellPermissionKey: 'bash' | 'shell'): string {
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
  ${shellPermissionKey}: ${permission.shell}
  external_directory: ${permission.external_directory}
---

${prompt}
`
}

function buildLegacyAssistantDefaultAgentMd(): string {
  return buildAssistantDefaultAgentMdFromPrompt(buildLegacyAssistantAgentPrompt(), 'bash')
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

function buildAssistantAgentPermission(): { read: 'allow'; edit: 'allow'; glob: 'allow'; grep: 'allow'; list: 'allow'; shell: 'allow'; external_directory: 'ask' } {
  return {
    read: 'allow',
    edit: 'allow',
    glob: 'allow',
    grep: 'allow',
    list: 'allow',
    shell: 'allow',
    external_directory: 'ask',
  }
}

function buildPreviousAssistantDefaultAgentMd(): string {
  return buildAssistantDefaultAgentMdFromPrompt(buildPreviousAssistantAgentPrompt(), 'bash')
}

export function buildAssistantDefaultAgentMd(): string {
  return buildAssistantDefaultAgentMdFromPrompt(buildAssistantAgentPrompt(), 'shell')
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
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
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

Body matches \`CreateScheduleJobRequest\` schema (discriminated union with \`scheduleMode: 'interval' | 'cron' | 'once'\`). \`once\` takes \`runAt\` (\`YYYY-MM-DDTHH:mm\` wall time) and \`timezone\`, must be in the future when enabled, and turns itself off when its timed run starts; \`Run now\` does not use it up.

Optional \`workspaceMode\` sets where runs execute: \`worktree\` (default, a fresh worktree removed after each run), \`kept-worktree\` (a fresh worktree kept after each run), or \`shared-worktree\` (one worktree and branch reused by every run). Kept and shared worktrees are listed with \`GET /repos/:repoId/schedules/:jobId/worktrees\`. Removing schedule worktrees is done by the user in the Manager UI.

Optional \`sandbox: { enabled, resources: { cpus, memoryMib } | null }\` runs the scheduled session and its subagents in a dedicated sandbox microVM with Docker available. It works only for schedules on the local OpenCode server, requires server sandboxing to be enabled in settings, and the VM and its Docker volume are removed after each run. The run fails if the VM cannot start.

Optional \`showInInbox\` (default \`true\`). When \`false\`, successful runs are stored as already viewed and send no completion push; failed runs still appear in the Reports inbox, and a session execution failure still sends the error push. \`PATCH\` accepts it too, and a change applies to runs that finish afterwards.

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
- In a scheduled run, the notification always opens that run's report, so \`url\` is not needed
- Do not call the internal HTTP API with \`curl\` for notifications; the tool is the supported path
`
}

type AssistantSettingsKey = keyof typeof AssistantSettingsPatchSchema.shape

const ASSISTANT_SETTINGS_KEY_NOTES: Partial<Record<AssistantSettingsKey, string>> = {
  tts: 'Non-secret TTS preferences (`enabled`, `provider`, `autoPlay`, `voice`, `model`, `speed`). TTS must already be configured in the UI (the endpoint returns 400 otherwise).',
  stt: 'Non-secret STT preferences (`enabled`, `provider`, `model`, `language`). STT must already be configured in the UI (the endpoint returns 400 otherwise).',
}

function buildAllowedSettingsKeysList(): string {
  const keys = Object.keys(AssistantSettingsPatchSchema.shape) as AssistantSettingsKey[]
  return keys
    .map((key) => {
      const note = ASSISTANT_SETTINGS_KEY_NOTES[key]
      return note === undefined ? `- \`${key}\`` : `- \`${key}\` — ${note}`
    })
    .join('\n')
}

export function buildSettingsSkill(): string {
  return `---
name: manager-settings
description: Read and modify safe user preferences and the OpenCode configuration file with the ${MANAGER_TOOL_NAME} tool
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
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string   // relative internal API path; query strings allowed
    body?: object  // JSON body for POST and PATCH routes
  }
}
\`\`\`

## Endpoints

### GET /settings

Retrieve the user's full settings, including all preferences. Stored credentials (git credential tokens, SSH keys and passphrases, TTS and STT API keys, server environment variable values, and the last known good config) are replaced with \`<redacted>\`; an empty value means none is set. PATCH responses are redacted the same way.

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
    colorTheme?: string, // one of: ${[MANAGER_COLOR_THEME_ID, ...OPENCODE_THEMES.map((theme) => theme.id)].join(', ')}
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
${buildAllowedSettingsKeysList()}

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

### Keyboard Shortcut Preferences

\`keyboardShortcuts\`, \`leaderKey\`, and \`directShortcuts\` control keyboard bindings.

**Actions:** ${Object.keys(DEFAULT_KEYBOARD_SHORTCUTS).join(', ')}

**Key format:** modifiers joined with \`+\`, using \`Ctrl\`, \`Cmd\`, \`Alt\`, and \`Shift\` (for example \`Ctrl+Alt+U\` or \`Shift+Tab\`). \`Cmd\` is the Command key on macOS and Ctrl on other platforms. An empty string unbinds the action.

**Leader vs direct:** by default a binding is a leader binding, pressed after the \`leaderKey\` (default \`${DEFAULT_LEADER_KEY}\`). List an action in \`directShortcuts\` to fire it without the leader key.

**Sending changes:** \`keyboardShortcuts\` and \`directShortcuts\` are replaced wholesale. Read the current \`keyboardShortcuts\` (and \`directShortcuts\` when changing binding kinds) from GET /settings, modify only the actions you need, and send the complete map or list back; actions absent from the stored map use their built-in defaults.

### POST /assistant/reload

Reload the OpenCode configuration without restarting the server, rebuilding every loaded location. OpenCode re-reads \`opencode.json\`/\`opencode.jsonc\`, agents, commands, skills, plugins, and \`AGENTS.md\`; running sessions, including this one, keep running. Use this after editing \`.opencode/agents/assistant.md\` or other workspace files so changes take effect on the next message. Returns \`400\` with \`validationIssues\` when the OpenCode configuration is invalid.

**Note:** Always confirm with the user before reloading.

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

## OpenCode Configuration

The global configuration files on disk are the source of truth. Use the \`ocm\` tool's \`request\` action with the endpoints below to read or change them; never edit the files directly. Global sources merge in order: \`opencode.json\`, then \`opencode.jsonc\`.

### GET /opencode-config

Read the merged persisted global configuration and its source files. Returns \`404\` when no source exists. Secret values are replaced with \`<redacted>\` and the raw source text is omitted, so a read never returns credentials; \`redactedPaths\` lists the hidden paths. This is not the running instance configuration: project overrides and expanded environment values are not included. \`GET /opencode-config/effective\` reads the running server's configuration separately as \`entries\`: the configuration documents and discovery directories in precedence order, lowest first, each shaped as \`{ type: 'document', path, info }\` or \`{ type: 'directory', path }\`. Its \`info\` values are expanded for the running server, with secrets redacted; never copy this response into a save.

**Response:**
\`\`\`ts
{
  path: string
  content: object           // secrets replaced with "<redacted>"
  isValid: boolean
  validationIssues?: Array<{ path: string, message: string }>
  updatedAt: number
  sources: Array<{ name: string, path: string, content: object, isValid: boolean, validationIssues?: Array<{ path: string, message: string }>, updatedAt: number }>
  revision: string
  redactedPaths: string[]
}
\`\`\`

**Example:**
\`\`\`json
{
  "action": "request",
  "params": {
    "method": "GET",
    "path": "/opencode-config"
  }
}
\`\`\`

### PATCH /opencode-config

Change only the paths the user asked for. Send a nested \`patch\` object naming those paths and the values to set; a path you do not name keeps its current value, and a \`null\` value removes a path. Naming a v2 entity (\`agents.<name>\`, \`commands.<name>\`, \`providers.<id>\`, \`mcp.servers.<name>\`, or \`permissions\`) also deletes its v1 counterpart (\`agent.<name>\`, \`command.<name>\`, \`provider.<id>\`, \`mcp.<name>\`, or \`permission\`) in the same edit. \`{env:…}\` and \`{file:…}\` references in fields whose value is sent back unchanged are kept. Only changed fields are patched into the preferred existing source: JSONC, then JSON. New installations use opencode.jsonc. Unchanged inherited values and comments are preserved.

Send \`expectedRevision\` from a read. A \`409\` with \`expectedRevision\` and \`actualRevision\` means the revision is stale, and a \`409\` with \`paths\` means the v1 entry to remove exists only in a lower-priority config source (the \`OpenCodeConfigShadowedRemovalError\` case): read again and reconcile rather than retrying stale content. A \`409\` with neither field means OpenCode has not loaded the saved configuration since a failed reload, so a patch naming an agent, command, provider or MCP server is refused: do not retry, and tell the user to restart the OpenCode server from Settings. Patches that name no such entity still apply.

**Request Body:**
\`\`\`ts
{ patch: object, expectedRevision?: string, source?: "opencode.json" | "opencode.jsonc" }
\`\`\`

**Example** — change one MCP server's bearer token without reading the file:
\`\`\`json
{
  "action": "request",
  "params": {
    "method": "PATCH",
    "path": "/opencode-config",
    "body": {
      "patch": {
        "mcp": {
          "servers": {
            "linear": { "headers": { "Authorization": "Bearer <token>" } }
          }
        }
      }
    }
  }
}
\`\`\`

**Response:**
Returns the refreshed merged configuration and source files, with secrets redacted. A semantic change is applied automatically: the Manager reloads OpenCode without restarting the server, so agents, permissions, providers, models, and plugins take effect on the next message and running sessions keep running. An \`mcp\` change is applied the same way, and only the servers whose configuration changed reconnect. Comment-only changes do nothing.

The response adds \`restartRequired: true\` only when the automatic reload failed, for example because the OpenCode server is unavailable.

Returns \`400\` for invalid configuration or a \`<redacted>\` value (\`paths\` lists them), and \`409\` when \`expectedRevision\` is stale, the v1 entry to remove exists only in a lower-priority config source, or an entity patch arrives while an OpenCode restart is pending.

### GET /opencode-config/mcp

List the configured MCP servers with their enabled state and live connection status. Use this to answer questions about MCP servers instead of reading the whole configuration. Header and environment values are never returned.

\`type\` is \`local\` or \`remote\`, and \`command\` or \`url\` is included for the matching type. \`enabled\` reflects the stored flag. Every entry comes from a native \`mcp.servers.<name>\` entry, so address it by that path; saving \`mcp.servers.<name>\` replaces a flat \`mcp.<name>\` entry left by an older config. \`status\` is the live OpenCode status (\`connected\`, \`pending\`, \`disabled\`, \`failed\`, or \`needs_auth\`) when the server is reachable, and \`error\` carries the failure reason.

**Response:**
\`\`\`ts
{
  revision: string
  servers: Array<{
    name: string
    type: 'local' | 'remote'
    command?: string[]
    url?: string
    enabled: boolean
    status?: 'connected' | 'pending' | 'disabled' | 'failed' | 'needs_auth'
    error?: string
  }>
}
\`\`\`

GET /opencode-config/mcp returns \`503\` when the OpenCode server is unreachable.

When the response contains \`restartRequired: true\`, tell the user to restart the OpenCode server from Settings. Never attempt the restart yourself: it would terminate your own session.

Only changes to how the OpenCode process is launched need a user restart from Settings: server environment variables, Git credentials and identity, sandbox enforcement, rotating the manager token, the server password, and installing or upgrading the OpenCode version. You cannot make these changes through this API.

## Safety

- The settings PATCH endpoint rejects any attempt to modify credentials, API keys, or other sensitive settings; guide the user to the full UI for Git, TTS, and STT credentials
- PATCH /opencode-config patches only the paths you name, including \`plugins\`, \`mcp.servers\`, and \`providers\` entries; change only the keys the user explicitly asked for and never add plugins, MCP servers, or provider credentials the user did not request
- GET /opencode-config redacts secrets; never reconstruct a secret you did not read, and never send a \`<redacted>\` value back
- The settings PATCH endpoint does NOT trigger an OpenCode reload or restart
`
}

export function buildReposSkill(): string {
  return `---
name: repo-management
description: List and clone repos in OpenCode Manager with the ${MANAGER_TOOL_NAME} tool
---

## When to Load

Load this skill when you need to discover repos, look up repo IDs, add a repo by cloning a git URL, or need to reference repo information before managing schedules. Load it before the schedule-management skill if you don't know the repo ID.

## Tool

Use the \`${MANAGER_TOOL_NAME}\` tool with the \`request\` action. The tool runs inside OpenCode Manager, so it needs no token, no base URL, and no network access from the shell. It works the same in a normal session, a sandboxed session, and a scheduled run. Paths are relative to the internal API (for example \`/repos\` or \`/repos/0/schedules\`) and query strings are allowed.

**Arguments:**
\`\`\`ts
{
  action: 'request',
  params: {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
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
    isWorktree?: boolean
    isLocal?: boolean
  }>
}
\`\`\`

### POST /repos

Clone a git repository into the repos root and register it with OpenCode Manager. Accepts HTTPS and SSH URLs. If the same URL and branch is already registered, the existing repo is returned instead of cloning again.

**Body:**
\`\`\`ts
{
  repoUrl: string        // e.g. https://github.com/owner/name
  branch?: string        // branch to check out; created locally if the remote has none
  directoryName?: string // directory under the repos root; defaults to the repo name
}
\`\`\`

**Example:**
\`\`\`json
{
  "action": "request",
  "params": {
    "method": "POST",
    "path": "/repos",
    "body": { "repoUrl": "https://github.com/owner/name" }
  }
}
\`\`\`

**Response:** the repo object (same shape as an entry in \`GET /repos\`) with \`cloneStatus: 'ready'\` when the clone has finished, or \`'cloning'\` when an identical clone is still running. When it is \`'cloning'\`, poll \`GET /repos\` until it becomes \`'ready'\` before using the repo.

## Notes

- Use \`id\` as \`:repoId\` in other API endpoints (e.g., \`/repos/:repoId/schedules\`)
- \`fullPath\` is the absolute local path - use it for file operations
- Only clone a repo the user asked for; there is no delete or update operation for repos through this tool
- Large clones can outlast the tool request timeout while the clone keeps running; if the request times out, poll \`GET /repos\` until the repo shows \`cloneStatus: 'ready'\`
- A \`409\` means the target directory already holds a different repository; retry with a different \`directoryName\`
- \`currentBranch\` is not included in the response - it requires git operations to determine
- Repo order is controlled by the \`repoOrder\` preference in settings
`
}

export function buildSessionsSkill(): string {
  return `---
name: session-management
description: Create and follow up on OpenCode sessions with the ${MANAGER_TOOL_NAME} tool
---

## When to Load

Load this skill when the user asks you to start work in a repo, hand a task to a new session, follow up on a running session, read what a session replied, or fork a session.

## Tool

Use the \`${MANAGER_TOOL_NAME}\` tool with the \`request\` action. The tool runs inside OpenCode Manager, so it needs no token, no base URL, and no network access from the shell. It works the same in a normal session, a sandboxed session, and a scheduled run. Paths are relative to the internal API (for example \`/sessions?repoId=1\` or \`/sessions/ses_abc/prompt\`) and query strings are allowed.

**Arguments:**
\`\`\`ts
{
  action: 'request',
  params: {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string   // relative internal API path; query strings allowed
    body?: object  // JSON body for POST and PATCH routes
  }
}
\`\`\`

## Endpoints

### GET /sessions

List sessions, newest first. Pass \`repoId\` to restrict the list to one repo; this covers every OpenCode workspace of that repo, not only the repo directory. Pass \`limit\` (1-50, default 10) to bound it.

Query params: \`repoId\`, \`limit\`

\`\`\`json
{
  "action": "request",
  "params": {
    "method": "GET",
    "path": "/sessions?repoId=1&limit=10"
  }
}
\`\`\`

**Response:**
\`\`\`ts
{
  sessions: Array<{
    id: string
    title: string | null
    directory: string
    repoId: number | null   // null when the directory belongs to no known repo
    busy: boolean           // true while the session is running
    outcome: 'succeeded' | 'failed' | 'interrupted' | null
    updated: number
  }>
}
\`\`\`

### POST /sessions

Create a session in a repo and send the first prompt. The response returns as soon as the prompt is queued, not when the run finishes. Use \`GET /sessions/:sessionId/reply\` to read the result.

Sessions created through this tool always start in \`ask\` permission mode; existing sessions keep the mode the user chose.

Pass \`worktree: true\` to run the session in a new isolated workspace instead of the repo directory. Creating a workspace can take tens of seconds; if the request times out it may still have succeeded, so call \`GET /sessions\` before retrying. \`ref\` selects the base ref for that workspace. \`model\` must be an available model reference; an unavailable model is rejected with \`400\` rather than silently substituted.

\`\`\`json
{
  "action": "request",
  "params": {
    "method": "POST",
    "path": "/sessions",
    "body": {
      "repoId": 1,
      "prompt": "Fix the failing login test",
      "title": "Fix login test",
      "worktree": true
    }
  }
}
\`\`\`

**Response (\`201\`):**
\`\`\`ts
{
  sessionId: string
  repoId: number
  directory: string
  workspaceDirectory: string | null
  model: string
  title: string | null
  url: string   // deep link to open the session in the UI
}
\`\`\`

### POST /sessions/:sessionId/prompt

Queue a follow-up prompt for an existing session.

\`\`\`json
{
  "action": "request",
  "params": {
    "method": "POST",
    "path": "/sessions/ses_abc/prompt",
    "body": { "text": "Also add a regression test" }
  }
}
\`\`\`

**Response (\`202\`):** \`{ "queued": true }\`

### GET /sessions/:sessionId/reply

Read the latest assistant reply for a session and whether it is still running. Prefer \`?waitMs=30000\` (integer, 0-45000) to wait for the session to settle instead of polling in a loop; the response returns once it settles or the timeout elapses. \`responseText\` is capped.

\`\`\`json
{
  "action": "request",
  "params": {
    "method": "GET",
    "path": "/sessions/ses_abc/reply?waitMs=30000"
  }
}
\`\`\`

**Response:**
\`\`\`ts
{
  busy: boolean
  responseText: string | null   // latest assistant text, null when there is none yet
  errorText: string | null      // assistant error message, null when the turn succeeded
  completed: boolean            // true once the latest assistant turn finished
}
\`\`\`

### POST /sessions/:sessionId/fork

Fork a session, optionally before a specific message. Omit \`beforeMessageId\` to fork from the current point. The forked session starts in \`ask\` permission mode.

\`\`\`json
{
  "action": "request",
  "params": {
    "method": "POST",
    "path": "/sessions/ses_abc/fork",
    "body": { "beforeMessageId": "msg_123" }
  }
}
\`\`\`

**Response:**
\`\`\`ts
{
  sessionId: string   // the new forked session
  directory: string
}
\`\`\`

## Notes

- Session creation always goes through OpenCode Manager, which validates the repo and the requested model before creating anything
- There is no delete route. Deleting sessions and workspaces stays out of this tool
- An unknown session returns \`404\`; other failures return \`502\`
`
}

/**
 * Builds the canonical Assistant `opencode.json` document: the assistant agent as default agent, its
 * allowed permissions, and a `primary` agent entry. The result is schema-validated, and an invalid
 * result throws rather than returning a config OpenCode would reject.
 */
export function buildAssistantOpenCodeConfig(): OpenCodeConfigInfo {
  const permission = buildAssistantAgentPermission()
  const config: OpenCodeConfigInfo = {
    default_agent: ASSISTANT_DEFAULT_AGENT_NAME,
    permissions: Object.entries(permission).map(([action, effect]) => ({
      action,
      resource: '*',
      effect,
    })),
    agents: {
      [ASSISTANT_DEFAULT_AGENT_NAME]: { mode: 'primary' },
    },
  }

  const result = validateOpenCodeConfig(config)
  if (!result.success) {
    throw new Error(
      `Generated OpenCode config is invalid: ${result.issues.map((issue) => `${issue.path}: ${issue.message}`).join(', ')}`,
    )
  }

  return config
}

/**
 * Creates or repairs the Assistant workspace for `repo`: writes AGENTS.md, the assistant OpenCode
 * config, the bundled skills and the default agent file, updating the config under a file lock and
 * preserving customized content unless the matching `overwrite*` option is set. Returns the
 * resulting status, including warnings for instruction updates it declined to apply.
 */
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

  const opencodeJsonUpdated = await withFileLock(opencodeJsonPath, async () => {
    const opencodeJsonExists = await fileExists(opencodeJsonPath)
    const existingOpenCodeJsonContent = opencodeJsonExists ? await readFileContent(opencodeJsonPath) : undefined
    const parsedOpenCodeConfig = existingOpenCodeJsonContent === undefined
      ? undefined
      : parseAssistantOpenCodeConfig(existingOpenCodeJsonContent)
    const hasV1OpenCodeConfig = parsedOpenCodeConfig !== undefined && hasAssistantV1OpenCodeConfig(parsedOpenCodeConfig)
    const existingOpenCodeConfig = parsedOpenCodeConfig as OpenCodeConfigInfo | undefined

    if (!opencodeJsonExists || overwriteOpenCodeConfig) {
      await writeFileContent(opencodeJsonPath, JSON.stringify(buildAssistantOpenCodeConfig(), null, 2))
      return true
    }
    if (hasV1OpenCodeConfig) return false
    if (existingOpenCodeConfig === undefined) {
      await writeFileContent(opencodeJsonPath, JSON.stringify(buildAssistantOpenCodeConfig(), null, 2))
      return true
    }

    const repairedConfig = assistantOpenCodeConfigNeedsRepair(existingOpenCodeConfig)
      ? mergeAssistantOpenCodeConfig(existingOpenCodeConfig)
      : existingOpenCodeConfig
    const updatedConfig = assistantOpenCodeConfigHasGeneratedAgentPersona(repairedConfig)
      ? stripGeneratedAssistantAgentPersona(repairedConfig)
      : repairedConfig
    if (updatedConfig === existingOpenCodeConfig) return false

    await writeFileContent(opencodeJsonPath, JSON.stringify(updatedConfig, null, 2))
    return true
  })

  await ensureDirectoryExists(path.join(assistantDir, ASSISTANT_OPENCODE_DIR))
  await ensureDirectoryExists(path.join(assistantDir, ASSISTANT_OPENCODE_DIR, ASSISTANT_AGENTS_DIR))
  await ensureDirectoryExists(path.join(assistantDir, ASSISTANT_OPENCODE_DIR, ASSISTANT_SKILLS_DIR, ASSISTANT_SCHEDULES_SKILL_DIR))
  await ensureDirectoryExists(path.join(assistantDir, ASSISTANT_OPENCODE_DIR, ASSISTANT_SKILLS_DIR, ASSISTANT_NOTIFICATIONS_SKILL_DIR))
  await ensureDirectoryExists(path.join(assistantDir, ASSISTANT_OPENCODE_DIR, ASSISTANT_SKILLS_DIR, ASSISTANT_SETTINGS_SKILL_DIR))
  await ensureDirectoryExists(path.join(assistantDir, ASSISTANT_OPENCODE_DIR, ASSISTANT_SKILLS_DIR, ASSISTANT_REPOS_SKILL_DIR))
  await ensureDirectoryExists(path.join(assistantDir, ASSISTANT_OPENCODE_DIR, ASSISTANT_SKILLS_DIR, ASSISTANT_SESSIONS_SKILL_DIR))

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

  const sessionsSkillPath = getSessionsSkillPath(assistantDir)
  const sessionsSkillContent = buildSessionsSkill()
  const existingSessionsSkillContent = await fileExists(sessionsSkillPath) ? await readFileContent(sessionsSkillPath) : undefined
  const sessionsSkillCreated = !hasSameContentHash(existingSessionsSkillContent, sessionsSkillContent)
  if (sessionsSkillCreated) {
    await writeFileContent(sessionsSkillPath, sessionsSkillContent)
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
    sessionManagementSkill: {
      path: sessionsSkillPath,
      created: sessionsSkillCreated,
    },
    defaultAgent: {
      name: ASSISTANT_DEFAULT_AGENT_NAME,
      path: assistantAgentPath,
      exists: true,
      created: assistantAgentCreated,
    },
  }
}

/**
 * Parses JSONC config text into a config object, returning `undefined` when the text is malformed or
 * its root is not an object.
 */
function parseAssistantOpenCodeConfig(rawContent: string): Record<string, unknown> | undefined {
  try {
    const parsed = parseJsonc(rawContent)
    return isRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

/**
 * Resolves the v1 container that OpenCode converts into the given v2 container.
 */
function resolveV1EntityPath(v2Path: readonly string[]): string[] {
  const mapping = V1_ENTITY_PATHS.find(
    (entry) => entry.v2Path.length === v2Path.length && entry.v2Path.every((segment, index) => segment === v2Path[index]),
  )
  if (mapping === undefined) {
    throw new Error(`No v1 config path is defined for ${v2Path.join('.')}`)
  }
  return [...mapping.v1Path]
}

const ASSISTANT_V1_AGENT_PATH = resolveV1EntityPath(['agents'])
const ASSISTANT_V1_PERMISSION_PATH = resolveV1EntityPath(['permissions'])

/**
 * Reports whether the config still carries v1 keys, which mark a file that has not been converted to
 * the v2 shape yet.
 */
function hasAssistantV1OpenCodeConfig(config: Record<string, unknown>): boolean {
  if (readConfigValueAtPath(config, ASSISTANT_V1_PERMISSION_PATH) !== undefined) return true
  const v1Agents = readConfigValueAtPath(config, ASSISTANT_V1_AGENT_PATH)
  return isRecord(v1Agents) && isRecord(v1Agents[ASSISTANT_DEFAULT_AGENT_NAME])
}

/**
 * Reports whether an existing Assistant config lacks what `ensureAssistantMode` requires: the
 * assistant as default agent, an enabled agent entry with a valid mode, and no generated persona left
 * inline.
 */
function assistantOpenCodeConfigNeedsRepair(config: OpenCodeConfigInfo): boolean {
  if (config.default_agent !== ASSISTANT_DEFAULT_AGENT_NAME) return true
  const agents = config.agents
  if (!agents || typeof agents !== 'object') return true
  const assistantAgent = agents[ASSISTANT_DEFAULT_AGENT_NAME]
  if (!assistantAgent || typeof assistantAgent !== 'object') return true
  if (assistantAgent.mode !== 'primary' && assistantAgent.mode !== 'all') return true
  if (assistantAgent.disabled === true) return true
  if (assistantOpenCodeConfigHasGeneratedAgentPersona(config)) return true
  return false
}

function assistantOpenCodeConfigHasGeneratedAgentPersona(config: OpenCodeConfigInfo): boolean {
  return normalizeAssistantAgent(config.agents?.[ASSISTANT_DEFAULT_AGENT_NAME]) !== undefined
}

/** Returns the agent's `mode` when it is `primary` or `all`, otherwise falling back to `primary`. */
function resolveValidAssistantMode(agent: unknown): 'primary' | 'all' {
  const mode = (agent as { mode?: unknown } | undefined)?.mode
  return mode === 'primary' || mode === 'all' ? mode : 'primary'
}

/**
 * Reduces a generated assistant persona to a mode-only agent, leaving a customized persona to the caller.
 */
function normalizeAssistantAgent(agent: unknown): OpenCodeAgentConfig | undefined {
  if (!isRecord(agent) || !matchesGeneratedAssistantAgentPrompt(agent.system)) return undefined
  return { mode: resolveValidAssistantMode(agent) }
}

/**
 * Rewrites the assistant agent entry to a mode-only value, dropping a generated `system` prompt so it
 * comes from the agent markdown file rather than opaque config text.
 */
function stripGeneratedAssistantAgentPersona(config: OpenCodeConfigInfo): OpenCodeConfigInfo {
  const existingAssistantAgent = config.agents?.[ASSISTANT_DEFAULT_AGENT_NAME]

  return {
    ...config,
    agents: {
      ...(config.agents ?? {}),
      [ASSISTANT_DEFAULT_AGENT_NAME]: normalizeAssistantAgent(existingAssistantAgent) ?? {
        mode: resolveValidAssistantMode(existingAssistantAgent),
      },
    },
  }
}

/**
 * Merges an existing Assistant config over a freshly generated one, keeping user settings and extra
 * agents while forcing the assistant as default agent and re-enabling its entry.
 */
function mergeAssistantOpenCodeConfig(existing?: OpenCodeConfigInfo): OpenCodeConfigInfo {
  const generated = buildAssistantOpenCodeConfig()
  const existingAssistantAgent = existing?.agents?.[ASSISTANT_DEFAULT_AGENT_NAME]
  const validMode = resolveValidAssistantMode(existingAssistantAgent)
  const mergedAssistantAgent: OpenCodeAgentConfig = normalizeAssistantAgent(existingAssistantAgent) ?? {
    ...(existingAssistantAgent ?? {}),
    mode: validMode,
    disabled: false,
  }

  return {
    ...generated,
    ...existing,
    default_agent: ASSISTANT_DEFAULT_AGENT_NAME,
    permissions: existing?.permissions ?? generated.permissions,
    agents: {
      ...(existing?.agents ?? {}),
      [ASSISTANT_DEFAULT_AGENT_NAME]: mergedAssistantAgent,
    },
  }
}

/**
 * Lists the v1 paths to delete after a conversion: the assistant agent entry, widened to the whole v1
 * `agents` container when that container held nothing else, plus `permissions` when a v2 counterpart
 * has just been written.
 */
function buildAssistantV1ConfigRemovalPaths(
  config: Record<string, unknown>,
  convertedPermissions: unknown,
): string[][] {
  const v1Agent = readConfigValueAtPath(config, ASSISTANT_V1_AGENT_PATH)
  const removeWholeAgent = isRecord(v1Agent) &&
    Object.keys(v1Agent).length === 1 &&
    isRecord(v1Agent[ASSISTANT_DEFAULT_AGENT_NAME])

  const paths: string[][] = [
    removeWholeAgent ? ASSISTANT_V1_AGENT_PATH : [...ASSISTANT_V1_AGENT_PATH, ASSISTANT_DEFAULT_AGENT_NAME],
  ]
  if (convertedPermissions !== undefined && readConfigValueAtPath(config, ASSISTANT_V1_PERMISSION_PATH) !== undefined) {
    paths.push(ASSISTANT_V1_PERMISSION_PATH)
  }
  return paths
}

/**
 * Picks the assistant agent written back to the converted file, preferring OpenCode's converted entry,
 * then the agent passed in, then a mode derived from the v1 definition.
 */
function resolveConvertedAssistantAgent(
  agent: OpenCodeAgentConfig | undefined,
  v1Agent: unknown,
): OpenCodeAgentConfig {
  return normalizeAssistantAgent(agent) ?? agent ?? { mode: resolveValidAssistantMode(v1Agent) }
}

/**
 * Puts the raw `{env:…}` and `{file:…}` references from the original file back into the converted
 * assistant agent, returning the agent unchanged when no restored entry can be read.
 */
function restoreAssistantAgentReferences(
  agent: OpenCodeAgentConfig,
  resolved: OpenCodeConfigInfo,
  raw: Record<string, unknown>,
): OpenCodeAgentConfig {
  const restored = restoreOpenCodeConfigReferences(
    { agents: { [ASSISTANT_DEFAULT_AGENT_NAME]: agent } },
    resolved as Record<string, unknown>,
    raw,
  )
  const restoredAgent = readConfigValueAtPath(restored, ['agents', ASSISTANT_DEFAULT_AGENT_NAME])
  if (typeof restoredAgent !== 'object' || restoredAgent === null) return agent
  return restoredAgent as OpenCodeAgentConfig
}

/**
 * Rewrites a v1 Assistant `opencode.json` to the v2 shape using OpenCode's own conversion,
 * keeping comments and formatting. The file is left untouched when OpenCode is unreachable.
 */
export async function convertAssistantOpenCodeConfigToV2(api: OpenCodeApi): Promise<boolean> {
  const assistantDir = getAssistantModeDirectory()
  const opencodeJsonPath = path.join(assistantDir, ASSISTANT_OPENCODE_CONFIG_FILENAME)
  try {
    return await withFileLock(opencodeJsonPath, () => convertAssistantOpenCodeConfigFile(api, assistantDir, opencodeJsonPath))
  } catch (error) {
    logger.warn('Skipped the Assistant OpenCode config conversion:', error)
    return false
  }
}

/**
 * Converts one Assistant `opencode.json` in place when it still holds v1 keys, writing OpenCode's
 * converted agent and permissions while preserving comments. Returns `false` without writing when the
 * file is absent, already v2, unreadable by OpenCode, or the rewritten text fails validation.
 */
async function convertAssistantOpenCodeConfigFile(
  api: OpenCodeApi,
  assistantDir: string,
  opencodeJsonPath: string,
): Promise<boolean> {
  if (!await fileExists(opencodeJsonPath)) return false

  const rawContent = await readFileContent(opencodeJsonPath)
  const rawConfig = parseAssistantOpenCodeConfig(rawContent)
  if (rawConfig === undefined || !hasAssistantV1OpenCodeConfig(rawConfig)) return false

  const documents = await readOpenCodeConfigDocuments(api, assistantDir)
  const documentInfo = documents.get(path.resolve(opencodeJsonPath))
  if (documentInfo === undefined) return false

  const v1Assistants = readConfigValueAtPath(rawConfig, ASSISTANT_V1_AGENT_PATH)
  const v1AssistantAgent = isRecord(v1Assistants) ? v1Assistants[ASSISTANT_DEFAULT_AGENT_NAME] : undefined
  if (isRecord(v1AssistantAgent) && documentInfo.agents?.[ASSISTANT_DEFAULT_AGENT_NAME] === undefined) {
    logger.warn('Skipped the Assistant OpenCode config conversion: OpenCode returned no converted assistant agent')
    return false
  }
  const setOperations: OpenCodeConfigPathOperation[] = [
    {
      path: ['agents', ASSISTANT_DEFAULT_AGENT_NAME],
      value: restoreAssistantAgentReferences(
        resolveConvertedAssistantAgent(
          documentInfo.agents?.[ASSISTANT_DEFAULT_AGENT_NAME],
          v1AssistantAgent,
        ),
        documentInfo,
        rawConfig,
      ),
    },
  ]
  if (documentInfo.permissions !== undefined) {
    setOperations.push({ path: ['permissions'], value: documentInfo.permissions })
  }

  let updatedText = applyOpenCodeConfigEdits(rawContent, setOperations)
  for (const removalPath of buildAssistantV1ConfigRemovalPaths(rawConfig, documentInfo.permissions)) {
    updatedText = removeOpenCodeConfigProperty(updatedText, removalPath)
  }

  const validation = validateOpenCodeConfig(parseJsonc(updatedText))
  if (!validation.success) {
    logger.warn('Skipped the Assistant OpenCode config conversion: the converted config is invalid', validation.issues)
    return false
  }

  await writeFileContent(opencodeJsonPath, updatedText)
  return true
}

export async function getAssistantModeStatus(repo: Repo): Promise<AssistantModeStatus> {
  const assistantDir = getAssistantModeDirectory()

  const agentsMdPath = path.join(assistantDir, ASSISTANT_AGENTS_MD_FILENAME)
  const opencodeJsonPath = path.join(assistantDir, ASSISTANT_OPENCODE_CONFIG_FILENAME)
  const skillPath = getSchedulesSkillPath(assistantDir)
  const notificationsSkillPath = getNotificationsSkillPath(assistantDir)
  const settingsSkillPath = getSettingsSkillPath(assistantDir)
  const reposSkillPath = getReposSkillPath(assistantDir)
  const sessionsSkillPath = getSessionsSkillPath(assistantDir)
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
    sessionManagementSkill: {
      path: sessionsSkillPath,
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
