import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import path from 'path'
import { access, readFile, writeFile } from 'fs/promises'
import { Hono } from 'hono'
import { AssistantSettingsPatchSchema } from '@opencode-manager/shared/schemas'
import { parseJsonc } from '@opencode-manager/shared/utils'
import type { OpenCodeApi, OpenCodePermissionRule } from '@opencode-manager/shared/opencode'
import { validateOpenCodeConfig } from '@opencode-manager/shared/opencode/config-validation'
import { ensureAssistantMode, getAssistantModeStatus, buildSchedulesSkill, buildReposSkill, buildSettingsSkill, buildSessionsSkill, buildAssistantDefaultAgentMd, buildAssistantOpenCodeConfig, buildAssistantRepo, installAssistantWorkspace, convertAssistantOpenCodeConfigToV2 } from '../../src/services/assistant-mode'
import { createTempAssistantWorkspace, createTestDb, mockRepo } from '../helpers/assistant-workspace'
import { ScheduleService } from '../../src/services/schedules'
import { getOrCreateInternalToken } from '../../src/services/internal-token'
import { createOpenCodeClient } from '../../src/services/opencode/client'
import { getRepoById } from '../../src/db/queries'
import type { ScheduleWorktreeManager } from '../../src/services/schedule-worktree'
import { createInternalTestApp } from '../helpers/internal-test-app'

const ASSISTANT_PERMISSIONS: OpenCodePermissionRule[] = [
  { action: 'read', resource: '*', effect: 'allow' },
  { action: 'edit', resource: '*', effect: 'allow' },
  { action: 'glob', resource: '*', effect: 'allow' },
  { action: 'grep', resource: '*', effect: 'allow' },
  { action: 'list', resource: '*', effect: 'allow' },
  { action: 'shell', resource: '*', effect: 'allow' },
  { action: 'external_directory', resource: '*', effect: 'ask' },
]

describe('buildSchedulesSkill', () => {
  it('instructs the agent to use the ocm tool request action', () => {
    const skill = buildSchedulesSkill()
    expect(skill).toContain('"action": "request"')
    expect(skill).toContain('"method": "GET"')
    expect(skill).toContain('"path": "/schedules/all"')
    expect(skill).not.toContain('curl')
  })

  it('documents repoId 0 for Assistant schedules', () => {
    const skill = buildSchedulesSkill()
    expect(skill).toContain('Use repo ID `0` for the built-in Assistant')
    expect(skill).toContain('/repos/0/schedules')
  })
})

describe('buildReposSkill', () => {
  it('instructs the agent to use the ocm tool request action', () => {
    const skill = buildReposSkill()
    expect(skill).toContain('"action": "request"')
    expect(skill).toContain('"method": "GET"')
    expect(skill).toContain('"path": "/repos"')
  })

  it('contains GET /repos endpoint documentation', () => {
    const skill = buildReposSkill()
    expect(skill).toContain('GET /repos')
  })

  it('does not instruct reading the internal token or sending a bearer header', () => {
    const skill = buildReposSkill()
    expect(skill).not.toContain('Authorization: Bearer')
    expect(skill).not.toContain('.opencode/internal-token')
    expect(skill).not.toContain('curl')
  })

  it('does not contain a localhost base URL', () => {
    const skill = buildReposSkill()
    expect(skill).not.toContain('localhost')
  })

  it('does not document the removed openCodeConfigName field', () => {
    const skill = buildReposSkill()
    expect(skill).not.toContain('openCodeConfigName')
  })
})

describe('buildSessionsSkill', () => {
  it('instructs the agent to use the ocm tool request action', () => {
    const skill = buildSessionsSkill()
    expect(skill).toContain('name: session-management')
    expect(skill).toContain('"action": "request"')
    expect(skill).toContain('"path": "/sessions?repoId=1&limit=10"')
    expect(skill).not.toContain('curl')
  })

  it('documents every session route and that creation returns immediately', () => {
    const skill = buildSessionsSkill()
    expect(skill).toContain('GET /sessions')
    expect(skill).toContain('POST /sessions')
    expect(skill).toContain('POST /sessions/:sessionId/prompt')
    expect(skill).toContain('GET /sessions/:sessionId/reply')
    expect(skill).toContain('POST /sessions/:sessionId/fork')
    expect(skill).toContain('returns as soon as the prompt is queued')
    expect(skill).toContain('poll')
  })

  it('documents that there is no delete route', () => {
    const skill = buildSessionsSkill()
    expect(skill).toContain('There is no delete route')
    expect(skill).not.toContain('DELETE /sessions')
  })

  it('documents the ask permission mode and workspace timeout behavior', () => {
    const skill = buildSessionsSkill()
    expect(skill).toContain('`ask` permission mode')
    expect(skill).toContain('keep the mode the user chose')
    expect(skill).toContain('may still have succeeded')
    expect(skill).toContain('before retrying')
  })

  it('documents the reply wait parameter and workspace repoId semantics', () => {
    const skill = buildSessionsSkill()
    expect(skill).toContain('waitMs=30000')
    expect(skill).toContain('OpenCode workspace')
    expect(skill).toContain('belongs to no known repo')
    expect(skill).toContain('capped')
  })
})

describe('buildSettingsSkill', () => {
  it('instructs the agent to use the ocm tool request action', () => {
    const skill = buildSettingsSkill()
    expect(skill).toContain('"action": "request"')
    expect(skill).toContain('"path": "/settings?userId=default"')
    expect(skill).not.toContain('curl')
  })

  it('includes tts and stt in allowed non-secret preferences', () => {
    const skill = buildSettingsSkill()
    expect(skill).toContain('tts')
    expect(skill).toContain('stt')
    expect(skill).toContain('enabled')
    expect(skill).toContain('provider')
    expect(skill).toContain('autoPlay')
    expect(skill).toContain('voice')
    expect(skill).toContain('model')
    expect(skill).toContain('speed')
    expect(skill).toContain('language')
  })

  it('documents the POST /assistant/reload endpoint', () => {
    const skill = buildSettingsSkill()
    expect(skill).toContain('/assistant/reload')
    expect(skill).toContain('Always confirm with the user before reloading')
    expect(skill).toContain('5 requests per minute')
  })

  it('documents the OpenCode configuration endpoints', () => {
    const skill = buildSettingsSkill()
    expect(skill).toContain('## OpenCode Configuration')
    expect(skill).toContain('GET /opencode-config')
    expect(skill).toContain('PATCH /opencode-config')
    expect(skill).toContain('GET /opencode-config/mcp')
    expect(skill).toContain('restartRequired')
    expect(skill).toContain('Never attempt the restart yourself')
  })

  it('documents the effective config entries and forbids saving them', () => {
    const skill = buildSettingsSkill()
    expect(skill).toContain('GET /opencode-config/effective')
    expect(skill).toContain('entries')
    expect(skill).toContain("type: 'document'")
    expect(skill).toContain("type: 'directory'")
    expect(skill).toContain('never copy this response into a save')
  })

  it('names v2 config keys and documents the unreachable server response', () => {
    const skill = buildSettingsSkill()
    expect(skill).toContain('`plugins`')
    expect(skill).toContain('`mcp.servers`')
    expect(skill).toContain('`providers`')
    expect(skill).not.toContain('including `plugin`')
    expect(skill).toContain('GET /opencode-config/mcp returns `503`')
  })

  it('documents the assistant reload as rebuilding every loaded location', () => {
    const skill = buildSettingsSkill()
    expect(skill).toContain('rebuilding every loaded location')
    expect(skill).not.toContain('disposing the current OpenCode instance')
  })

  it('still lists apiKey and endpoint as forbidden', () => {
    const skill = buildSettingsSkill()
    expect(skill).toContain('tts.apiKey')
    expect(skill).toContain('tts.endpoint')
    expect(skill).toContain('stt.apiKey')
    expect(skill).toContain('stt.endpoint')
    expect(skill).toContain('DO NOT attempt to set')
  })

  it('lists every AssistantSettingsPatchSchema key in the allowed keys section', () => {
    const skill = buildSettingsSkill()
    const allowedSection = skill.split('**Allowed Keys:**')[1]?.split('**DO NOT attempt to set:**')[0]
    if (allowedSection === undefined) throw new Error('Allowed Keys section is missing')
    for (const key of Object.keys(AssistantSettingsPatchSchema.shape)) {
      expect(allowedSection).toContain(`\`${key}\``)
    }
  })
})

describe('buildAssistantDefaultAgentMd', () => {
  it('contains description and mode in frontmatter', () => {
    const content = buildAssistantDefaultAgentMd()
    expect(content).toContain('description: Default OpenCode Manager assistant workspace agent')
    expect(content).toContain('mode: primary')
  })

  it('references workspace skills', () => {
    const content = buildAssistantDefaultAgentMd()
    expect(content).toContain('repo-management')
    expect(content).toContain('schedule-management')
    expect(content).toContain('notifications')
    expect(content).toContain('manager-settings')
  })

  it('contains reload guidance in the agent prompt', () => {
    const content = buildAssistantDefaultAgentMd()
    expect(content).toContain('/assistant/reload')
    expect(content).toContain('Always ask the user before reloading')
  })

  it('does not contain v file', () => {
    const content = buildAssistantDefaultAgentMd()
    expect(content).not.toContain('v file')
  })
})

describe('buildAssistantOpenCodeConfig', () => {
  it('writes v2 permissions and agents.assistant with primary mode and no embedded persona', () => {
    const config = buildAssistantOpenCodeConfig()
    expect(config.default_agent).toBe('assistant')
    expect(config.permissions).toEqual(ASSISTANT_PERMISSIONS)
    expect(config.agents?.assistant).toEqual({ mode: 'primary' })
    expect(config.agents?.assistant?.system).toBeUndefined()
    expect(config.agents?.assistant?.description).toBeUndefined()
    expect(config.agents?.assistant?.permissions).toBeUndefined()
    expect(validateOpenCodeConfig(config).success).toBe(true)
  })
})

describe('ensureAssistantMode', () => {
  let ws: Awaited<ReturnType<typeof createTempAssistantWorkspace>>

  beforeEach(async () => {
    ws = await createTempAssistantWorkspace()
  })
  afterEach(async () => { await ws.cleanup() })

  it('creates AGENTS.md, opencode.json, and SKILL.md on first run', async () => {
    await ensureAssistantMode(mockRepo)
    const agentsMd = await readFile(path.join(ws.assistantDir, 'AGENTS.md'), 'utf8')
    const opencodeJson = await readFile(path.join(ws.assistantDir, 'opencode.json'), 'utf8')
    const skill = await readFile(path.join(ws.assistantDir, '.opencode/skills/schedule-management/SKILL.md'), 'utf8')
    const repoSkill = await readFile(path.join(ws.assistantDir, '.opencode/skills/repo-management/SKILL.md'), 'utf8')
    const sessionSkill = await readFile(path.join(ws.assistantDir, '.opencode/skills/session-management/SKILL.md'), 'utf8')
    const assistantAgent = await readFile(path.join(ws.assistantDir, '.opencode/agents/assistant.md'), 'utf8')

    expect(agentsMd).toContain('.opencode/agents/assistant.md')
    expect(agentsMd).not.toContain('Self-Editing Rules')
    const parsedConfig = JSON.parse(opencodeJson)
    expect(parsedConfig.default_agent).toBe('assistant')
    expect(parsedConfig).not.toHaveProperty('mcp')
    expect(parsedConfig.permissions).toEqual(ASSISTANT_PERMISSIONS)
    expect(parsedConfig.agents?.assistant).toEqual({ mode: 'primary' })
    expect(parsedConfig.agents?.assistant?.system).toBeUndefined()
    expect(parsedConfig.agents?.assistant?.description).toBeUndefined()
    expect(parsedConfig.agents?.assistant?.permissions).toBeUndefined()
    expect(skill).toContain('"action": "request"')
    expect(skill).not.toContain('curl')
    expect(skill).not.toContain('Authorization: Bearer')
    expect(repoSkill).toContain('GET /repos')
    expect(repoSkill).not.toContain('Authorization: Bearer')
    expect(repoSkill).not.toContain('.opencode/internal-token')
    expect(sessionSkill).toContain('name: session-management')
    expect(sessionSkill).toContain('GET /sessions')
    expect(sessionSkill).not.toContain('Authorization: Bearer')
    expect(assistantAgent).toContain('mode: primary')
    expect(assistantAgent).toContain('Default OpenCode Manager assistant workspace agent')
    expect(assistantAgent).not.toContain('v file')
    await expect(access(path.join(ws.assistantDir, '.opencode/internal-token'))).rejects.toThrow()
  })

  it('does not create a .opencode/internal-token file', async () => {
    await ensureAssistantMode(mockRepo)
    await expect(access(path.join(ws.assistantDir, '.opencode/internal-token'))).rejects.toThrow()
  })

  it('writes all files needed before OpenCode assistant session launch', async () => {
    const result = await ensureAssistantMode(mockRepo)

    const opencodeJsonPath = path.join(ws.assistantDir, 'opencode.json')
    const agentsMdPath = path.join(ws.assistantDir, 'AGENTS.md')
    const schedulesSkillPath = path.join(ws.assistantDir, '.opencode/skills/schedule-management/SKILL.md')
    const notificationsSkillPath = path.join(ws.assistantDir, '.opencode/skills/notifications/SKILL.md')
    const settingsSkillPath = path.join(ws.assistantDir, '.opencode/skills/manager-settings/SKILL.md')
    const reposSkillPath = path.join(ws.assistantDir, '.opencode/skills/repo-management/SKILL.md')
    const sessionsSkillPath = path.join(ws.assistantDir, '.opencode/skills/session-management/SKILL.md')
    const assistantAgentPath = path.join(ws.assistantDir, '.opencode/agents/assistant.md')

    const opencodeJsonContent = await readFile(opencodeJsonPath, 'utf8')
    const opencodeJson = JSON.parse(opencodeJsonContent)

    expect(opencodeJson.default_agent).toBe('assistant')
    expect(opencodeJson.instructions).toBeUndefined()
    expect(opencodeJson.permissions).toEqual(ASSISTANT_PERMISSIONS)
    expect(opencodeJson.agents?.assistant).toEqual({ mode: 'primary' })
    expect(opencodeJson.agents?.assistant?.system).toBeUndefined()
    expect(opencodeJson.agents?.assistant?.description).toBeUndefined()
    expect(opencodeJson.agents?.assistant?.permissions).toBeUndefined()

    const agentsMdContent = await readFile(agentsMdPath, 'utf8')
    expect(agentsMdContent).toContain('Assistant Mode Workspace')
    expect(agentsMdContent).toContain('.opencode/agents/assistant.md')
    expect(agentsMdContent).not.toContain('Self-Editing Rules')
    expect(agentsMdContent).not.toContain('Schedule Management')
    expect(agentsMdContent).not.toContain('Notifications')
    expect(agentsMdContent).not.toContain('Settings Management')
    expect(agentsMdContent).not.toContain('Repo Management')

    const schedulesSkillContent = await readFile(schedulesSkillPath, 'utf8')
    expect(schedulesSkillContent).toContain('name: schedule-management')
    expect(schedulesSkillContent).toContain('Manage schedule jobs')
    expect(schedulesSkillContent).toContain('Use repo ID `0` for the built-in Assistant')
    expect(schedulesSkillContent).toContain('/repos/0/schedules')

    const notificationsSkillContent = await readFile(notificationsSkillPath, 'utf8')
    expect(notificationsSkillContent).toContain('name: notifications')
    expect(notificationsSkillContent).toContain('Send push notifications')

    const settingsSkillContent = await readFile(settingsSkillPath, 'utf8')
    expect(settingsSkillContent).toContain('name: manager-settings')
    expect(settingsSkillContent).toContain('Read and modify')
    expect(settingsSkillContent).toContain('/opencode-config')
    expect(settingsSkillContent).toContain('restartRequired')

    const reposSkillContent = await readFile(reposSkillPath, 'utf8')
    expect(reposSkillContent).toContain('name: repo-management')
    expect(reposSkillContent).toContain('List and clone repos')

    const sessionsSkillContent = await readFile(sessionsSkillPath, 'utf8')
    expect(sessionsSkillContent).toContain('name: session-management')
    expect(sessionsSkillContent).toContain('Create and follow up')

    const assistantAgentContent = await readFile(assistantAgentPath, 'utf8')
    expect(assistantAgentContent).toContain('mode: primary')
    expect(assistantAgentContent).toContain('Self-Editing')
    expect(assistantAgentContent).toContain('repo-management')
    expect(assistantAgentContent).toContain('schedule-management')
    expect(assistantAgentContent).toContain('notifications')
    expect(assistantAgentContent).toContain('manager-settings')

    expect(result.files.opencodeJson?.exists).toBe(true)
    expect(result.files.agentsMd?.exists).toBe(true)
    expect(result.repoManagementSkill?.path).toBe(reposSkillPath)
    expect(result.repoManagementSkill?.created).toBe(true)
    expect(result.sessionManagementSkill?.path).toBe(sessionsSkillPath)
    expect(result.sessionManagementSkill?.created).toBe(true)
    expect(result.defaultAgent?.name).toBe('assistant')
    expect(result.defaultAgent?.path).toBe(assistantAgentPath)
    expect(result.defaultAgent?.exists).toBe(true)
    expect(result.defaultAgent?.created).toBe(true)
  })

  it('reports repo management skill status from getAssistantModeStatus', async () => {
    await ensureAssistantMode(mockRepo)

    const status = await getAssistantModeStatus(mockRepo)

    expect(status.repoManagementSkill?.path).toBe(path.join(ws.assistantDir, '.opencode/skills/repo-management/SKILL.md'))
    expect(status.repoManagementSkill?.created).toBe(false)
    expect(status.sessionManagementSkill?.path).toBe(path.join(ws.assistantDir, '.opencode/skills/session-management/SKILL.md'))
    expect(status.sessionManagementSkill?.created).toBe(false)
  })

  it('preserves custom assistant agent content on subsequent ensureAssistantMode calls', async () => {
    await ensureAssistantMode(mockRepo)
    const assistantAgentPath = path.join(ws.assistantDir, '.opencode/agents/assistant.md')

    const customContent = '---\ndescription: Custom assistant\nmode: primary\n---\n\nCustom assistant instructions.'
    await writeFile(assistantAgentPath, customContent)

    const result2 = await ensureAssistantMode(mockRepo)

    const preservedContent = await readFile(assistantAgentPath, 'utf8')
    expect(preservedContent).toBe(customContent)
    expect(result2.defaultAgent?.created).toBe(false)
  })

  it('repairs existing assistant opencode config missing configured assistant agent', async () => {
    await ensureAssistantMode(mockRepo)
    const opencodeJsonPath = path.join(ws.assistantDir, 'opencode.json')
    await writeFile(opencodeJsonPath, JSON.stringify({
      model: 'provider/model',
      instructions: ['AGENTS.md'],
      default_agent: 'build',
      agents: {
        custom: { mode: 'primary', system: 'Custom agent' },
      },
      skills: ['.opencode/skills'],
    }, null, 2))

    const result = await ensureAssistantMode(mockRepo)
    const repaired = JSON.parse(await readFile(opencodeJsonPath, 'utf8'))

    expect(repaired.default_agent).toBe('assistant')
    expect(repaired.permissions).toEqual(ASSISTANT_PERMISSIONS)
    expect(repaired.agents.assistant).toEqual({ mode: 'primary', disabled: false })
    expect(repaired.agents.assistant.system).toBeUndefined()
    expect(repaired.agents.custom.system).toBe('Custom agent')
    expect(repaired.model).toBe('provider/model')
    expect(repaired.skills).toEqual(['.opencode/skills'])
    expect(result.files.opencodeJson?.created).toBe(true)
  })

  it('preserves custom assistant config while making it selectable', async () => {
    await ensureAssistantMode(mockRepo)
    const opencodeJsonPath = path.join(ws.assistantDir, 'opencode.json')
    await writeFile(opencodeJsonPath, JSON.stringify({
      default_agent: 'assistant',
      agents: {
        assistant: {
          mode: 'subagent',
          system: 'Custom assistant prompt',
          description: 'Custom assistant',
          permissions: [{ action: 'shell', resource: '*', effect: 'ask' }],
        },
      },
    }, null, 2))

    const result = await ensureAssistantMode(mockRepo)
    const repaired = JSON.parse(await readFile(opencodeJsonPath, 'utf8'))

    expect(repaired.agents.assistant.system).toBe('Custom assistant prompt')
    expect(repaired.agents.assistant.description).toBe('Custom assistant')
    expect(repaired.agents.assistant.permissions).toEqual([{ action: 'shell', resource: '*', effect: 'ask' }])
    expect(repaired.agents.assistant.mode).toBe('primary')
    expect(repaired.agents.assistant.disabled).toBe(false)
    expect(result.files.opencodeJson?.created).toBe(true)
  })

  it('leaves a v1 assistant opencode config untouched so the conversion can upgrade it', async () => {
    await ensureAssistantMode(mockRepo)
    const opencodeJsonPath = path.join(ws.assistantDir, 'opencode.json')
    const v1Config = `{
  // keep this comment
  "default_agent": "assistant",
  "permission": { "read": "allow", "shell": "ask" },
  "agent": { "assistant": { "mode": "primary", "prompt": "Custom v1 prompt" } }
}
`
    await writeFile(opencodeJsonPath, v1Config)

    const result = await ensureAssistantMode(mockRepo)

    expect(await readFile(opencodeJsonPath, 'utf8')).toBe(v1Config)
    expect(result.files.opencodeJson?.created).toBe(false)
  })

  it('writes the generated v2 config over a v1 config when overwrite is requested', async () => {
    await ensureAssistantMode(mockRepo)
    const opencodeJsonPath = path.join(ws.assistantDir, 'opencode.json')
    const v1Config = `{
  "permission": { "read": "allow", "shell": "ask" },
  "agent": { "assistant": { "mode": "primary", "prompt": "Custom v1 prompt" } }
}
`
    await writeFile(opencodeJsonPath, v1Config)

    const result = await ensureAssistantMode(mockRepo, { overwriteOpenCodeConfig: true })

    expect(JSON.parse(await readFile(opencodeJsonPath, 'utf8'))).toEqual(buildAssistantOpenCodeConfig())
    expect(result.files.opencodeJson?.created).toBe(true)
  })

  it('migrates generated legacy AGENTS.md and assistant.md to the new split', async () => {
    await ensureAssistantMode(mockRepo)

    const legacyAgentsMd = `# Assistant Mode Instructions

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

    const legacyAssistantAgent = `---
description: Default OpenCode Manager assistant workspace agent
mode: primary
permission:
  read: allow
  edit: allow
  glob: allow
  grep: allow
  list: allow
  bash: allow
  external_directory: ask
---

You are the default Assistant Mode agent for OpenCode Manager.

This workspace is the shared assistant workspace. Help the user manage repos, schedules, notifications, settings, and assistant behavior safely.

Use the workspace skills when relevant:
- Load repo-management before schedule-management when you need a repo ID.
- Load schedule-management for schedule jobs and runs.
- Load notifications when the user should be notified about important events.
- Load manager-settings when reading or safely updating UI preferences.

Preserve user-customized workspace files unless the user explicitly asks you to change them.
Ask before destructive operations or changes outside this assistant workspace.
`

    const agentsMdPath = path.join(ws.assistantDir, 'AGENTS.md')
    const opencodeJsonPath = path.join(ws.assistantDir, 'opencode.json')
    const assistantAgentPath = path.join(ws.assistantDir, '.opencode/agents/assistant.md')
    const legacyAssistantPrompt = legacyAssistantAgent.split('---\n\n')[1]?.trimEnd()

    if (legacyAssistantPrompt === undefined) throw new Error('Legacy assistant prompt fixture is invalid')

    await writeFile(agentsMdPath, legacyAgentsMd)
    await writeFile(assistantAgentPath, legacyAssistantAgent)
    await writeFile(opencodeJsonPath, JSON.stringify({
      default_agent: 'assistant',
      instructions: ['AGENTS.md'],
      permissions: [{ action: 'read', resource: '*', effect: 'allow' }],
      agents: {
        assistant: {
          description: 'Default OpenCode Manager assistant workspace agent',
          mode: 'primary',
          system: legacyAssistantPrompt,
          permissions: [{ action: 'shell', resource: '*', effect: 'allow' }],
        },
      },
    }, null, 2))

    const result = await ensureAssistantMode(mockRepo)

    const updatedAgentsMd = await readFile(agentsMdPath, 'utf8')
    const updatedAssistantAgent = await readFile(assistantAgentPath, 'utf8')
    const updatedOpenCodeJson = JSON.parse(await readFile(opencodeJsonPath, 'utf8'))

    expect(updatedAgentsMd).toContain('Assistant Mode Workspace')
    expect(updatedAgentsMd).toContain('.opencode/agents/assistant.md')
    expect(updatedAgentsMd).not.toContain('Self-Editing Rules')

    expect(updatedAssistantAgent).toContain('Self-Editing')
    expect(updatedAssistantAgent).toContain('/assistant/reload')
    expect(updatedAssistantAgent).toContain('Always ask the user before reloading')
    expect(updatedAssistantAgent).toContain('repo-management')
    expect(updatedAssistantAgent).toContain('schedule-management')
    expect(updatedAssistantAgent).toContain('notifications')
    expect(updatedAssistantAgent).toContain('manager-settings')

    expect(updatedOpenCodeJson.agents.assistant.system).toBeUndefined()
    expect(updatedOpenCodeJson.agents.assistant.description).toBeUndefined()
    expect(updatedOpenCodeJson.agents.assistant.permissions).toBeUndefined()
    expect(updatedOpenCodeJson.agents.assistant.mode).toBe('primary')
    expect(updatedOpenCodeJson.permissions).toEqual([{ action: 'read', resource: '*', effect: 'allow' }])

    expect(result.files.agentsMd?.created).toBe(true)
    expect(result.files.opencodeJson?.created).toBe(true)
    expect(result.defaultAgent?.created).toBe(true)
  })

  it('migrates previous-generation generated AGENTS.md that still mentions the internal token', async () => {
    await ensureAssistantMode(mockRepo)
    const agentsMdPath = path.join(ws.assistantDir, 'AGENTS.md')

    const previousAgentsMd = `# Assistant Mode Workspace

This directory is the shared Assistant Mode workspace for OpenCode Manager.

## Directory Contents

- \`opencode.json\` configures this workspace and selects the default assistant agent.
- \`.opencode/agents/assistant.md\` contains the default assistant agent instructions, behavior, durable preferences, and self-editing rules.
- \`.opencode/skills/\` contains managed workspace skills for repos, schedules, notifications, and settings.
- \`.opencode/internal-token\` is managed by OpenCode Manager for internal API authentication.

Assistant-specific instructions belong in \`.opencode/agents/assistant.md\`.
`
    await writeFile(agentsMdPath, previousAgentsMd)

    const result = await ensureAssistantMode(mockRepo)

    const updatedAgentsMd = await readFile(agentsMdPath, 'utf8')
    expect(updatedAgentsMd).toContain('Assistant Mode Workspace')
    expect(updatedAgentsMd).toContain('.opencode/agents/assistant.md')
    expect(updatedAgentsMd).not.toContain('.opencode/internal-token')
    expect(result.files.agentsMd?.created).toBe(true)
  })

  it('preserves custom AGENTS.md content on subsequent ensureAssistantMode calls', async () => {
    await ensureAssistantMode(mockRepo)
    const agentsMdPath = path.join(ws.assistantDir, 'AGENTS.md')

    const customContent = '# Custom Assistant Workspace\n\nThis is my custom AGENTS.md content.'
    await writeFile(agentsMdPath, customContent)

    const result = await ensureAssistantMode(mockRepo)

    const preservedContent = await readFile(agentsMdPath, 'utf8')
    expect(preservedContent).toBe(customContent)
    expect(result.files.agentsMd?.created).toBe(false)
  })

  it('warns when managed updates apply but customized legacy AGENTS.md is preserved', async () => {
    await ensureAssistantMode(mockRepo)
    const agentsMdPath = path.join(ws.assistantDir, 'AGENTS.md')
    const assistantAgentPath = path.join(ws.assistantDir, '.opencode/agents/assistant.md')

    await writeFile(agentsMdPath, `# Assistant Mode Instructions

This folder is the shared Assistant mode workspace for OpenCode Manager.

## Self-Editing Rules

The agent MAY self-edit the following files within this workspace:
- \`AGENTS.md\` - Assistant instructions, persona, and durable preferences
`)
    await writeFile(assistantAgentPath, `---
description: Default OpenCode Manager assistant workspace agent
mode: primary
permission:
  read: allow
  edit: allow
  glob: allow
  grep: allow
  list: allow
  bash: allow
  external_directory: ask
---

You are the default Assistant Mode agent for OpenCode Manager.

This workspace is the shared assistant workspace. Help the user manage repos, schedules, notifications, settings, and assistant behavior safely.

Use the workspace skills when relevant:
- Load repo-management before schedule-management when you need a repo ID.
- Load schedule-management for schedule jobs and runs.
- Load notifications when the user should be notified about important events.
- Load manager-settings when reading or safely updating UI preferences.

Preserve user-customized workspace files unless the user explicitly asks you to change them.
Ask before destructive operations or changes outside this assistant workspace.
`)

    const result = await ensureAssistantMode(mockRepo)

    const preservedAgentsMd = await readFile(agentsMdPath, 'utf8')
    expect(preservedAgentsMd).toContain('Self-Editing Rules')
    expect(result.files.agentsMd?.created).toBe(false)
    expect(result.defaultAgent?.created).toBe(true)
    expect(result.warnings?.[0]?.code).toBe('assistant-agents-md-preserved')
    expect(result.warnings?.[0]?.message).toContain('manually delete AGENTS.md')
  })

  it('overwrites custom AGENTS.md when overwriteAgentsMd is true', async () => {
    await ensureAssistantMode(mockRepo)
    const agentsMdPath = path.join(ws.assistantDir, 'AGENTS.md')

    const customContent = '# Custom Assistant Workspace\n\nThis is my custom AGENTS.md content.'
    await writeFile(agentsMdPath, customContent)

    const result = await ensureAssistantMode(mockRepo, { overwriteAgentsMd: true })

    const updatedContent = await readFile(agentsMdPath, 'utf8')
    expect(updatedContent).toContain('Assistant Mode Workspace')
    expect(updatedContent).toContain('.opencode/agents/assistant.md')
    expect(updatedContent).not.toBe(customContent)
    expect(result.files.agentsMd?.created).toBe(true)
  })
})

describe('convertAssistantOpenCodeConfigToV2', () => {
  let ws: Awaited<ReturnType<typeof createTempAssistantWorkspace>>

  beforeEach(async () => {
    ws = await createTempAssistantWorkspace()
  })
  afterEach(async () => { await ws.cleanup() })

  function createConfigApi(
    getEntries: (assistantDir: string) => unknown[],
  ): OpenCodeApi {
    return {
      config: {
        get: async () => getEntries(ws.assistantDir),
      },
    } as unknown as OpenCodeApi
  }

  const v1Config = `{
  // keep this comment
  "default_agent": "assistant",
  "permission": { "read": "allow", "shell": "ask" },
  "agent": { "assistant": { "mode": "primary", "prompt": "Custom v1 prompt" } }
}
`

  const convertedPermissions = [
    { action: 'read', resource: '*', effect: 'allow' },
    { action: 'shell', resource: '*', effect: 'ask' },
  ]

  it('writes the converted v2 values and removes the v1 keys while keeping comments', async () => {
    await ensureAssistantMode(mockRepo)
    const opencodeJsonPath = path.join(ws.assistantDir, 'opencode.json')
    await writeFile(opencodeJsonPath, v1Config)

    const api = createConfigApi((assistantDir) => [{
      type: 'document',
      path: path.join(assistantDir, 'opencode.json'),
      info: {
        default_agent: 'assistant',
        permissions: convertedPermissions,
        agents: { assistant: { mode: 'primary', system: 'Converted prompt' } },
      },
    }])

    const converted = await convertAssistantOpenCodeConfigToV2(api)

    const raw = await readFile(opencodeJsonPath, 'utf8')
    const config = parseJsonc<Record<string, unknown>>(raw)
    expect(converted).toBe(true)
    expect(config.agents).toEqual({ assistant: { mode: 'primary', system: 'Converted prompt' } })
    expect(config.permissions).toEqual(convertedPermissions)
    expect(config.agent).toBeUndefined()
    expect(config.permission).toBeUndefined()
    expect(raw).toContain('// keep this comment')
  })

  it('keeps comments attached to retained keys in a commented v1 config', async () => {
    await ensureAssistantMode(mockRepo)
    const opencodeJsonPath = path.join(ws.assistantDir, 'opencode.json')
    await writeFile(opencodeJsonPath, `{
  // about agent
  "agent": {
    // assistant comment
    "assistant": { "mode": "primary", "prompt": "Custom v1 prompt" },
    // kept sibling comment
    "reviewer": { "mode": "subagent", "prompt": "Reviewer" }
  },
  // about permission
  "permission": { "read": "allow", "shell": "ask" }, // trailing note
  "theme": "opencode"
}
`)

    const api = createConfigApi((assistantDir) => [{
      type: 'document',
      path: path.join(assistantDir, 'opencode.json'),
      info: {
        default_agent: 'assistant',
        permissions: convertedPermissions,
        agents: { assistant: { mode: 'primary', system: 'Converted prompt' } },
      },
    }])

    expect(await convertAssistantOpenCodeConfigToV2(api)).toBe(true)

    const raw = await readFile(opencodeJsonPath, 'utf8')
    const config = parseJsonc<Record<string, unknown>>(raw)
    expect(config.agents).toEqual({ assistant: { mode: 'primary', system: 'Converted prompt' } })
    expect(config.permissions).toEqual(convertedPermissions)
    expect(config.agent).toEqual({ reviewer: { mode: 'subagent', prompt: 'Reviewer' } })
    expect(config.permission).toBeUndefined()
    expect(config.theme).toBe('opencode')
    expect(raw).toContain('// about agent')
    expect(raw).toContain('// kept sibling comment')
    expect(raw).toContain('// about permission')
    expect(raw).toContain('// trailing note')
  })

  it('keeps other v1 agent entries when only agent.assistant is converted', async () => {
    await ensureAssistantMode(mockRepo)
    const opencodeJsonPath = path.join(ws.assistantDir, 'opencode.json')
    await writeFile(opencodeJsonPath, JSON.stringify({
      default_agent: 'assistant',
      agent: {
        assistant: { mode: 'primary', prompt: 'Custom v1 prompt' },
        reviewer: { mode: 'subagent', prompt: 'Reviewer' },
      },
    }, null, 2))

    const api = createConfigApi((assistantDir) => [{
      type: 'document',
      path: path.join(assistantDir, 'opencode.json'),
      info: {
        default_agent: 'assistant',
        permissions: convertedPermissions,
        agents: { assistant: { mode: 'primary', system: 'Converted prompt' } },
      },
    }])

    expect(await convertAssistantOpenCodeConfigToV2(api)).toBe(true)

    const config = JSON.parse(await readFile(opencodeJsonPath, 'utf8'))
    expect(config.agents.assistant.system).toBe('Converted prompt')
    expect(config.agent.assistant).toBeUndefined()
    expect(config.agent.reviewer.prompt).toBe('Reviewer')
  })

  it('drops a generated assistant persona from the converted agent', async () => {
    await ensureAssistantMode(mockRepo)
    const opencodeJsonPath = path.join(ws.assistantDir, 'opencode.json')
    await writeFile(opencodeJsonPath, JSON.stringify({
      default_agent: 'assistant',
      agent: { assistant: { mode: 'all' } },
    }, null, 2))

    const generatedPrompt = buildAssistantDefaultAgentMd().split('---\n\n')[1]?.trimEnd()
    if (generatedPrompt === undefined) throw new Error('Generated assistant prompt is missing')

    const api = createConfigApi((assistantDir) => [{
      type: 'document',
      path: path.join(assistantDir, 'opencode.json'),
      info: {
        default_agent: 'assistant',
        permissions: convertedPermissions,
        agents: { assistant: { mode: 'all', system: generatedPrompt, description: 'Generated persona' } },
      },
    }])

    expect(await convertAssistantOpenCodeConfigToV2(api)).toBe(true)

    const config = JSON.parse(await readFile(opencodeJsonPath, 'utf8'))
    expect(config.agents.assistant).toEqual({ mode: 'all' })
  })

  it('leaves the file unchanged when the OpenCode client fails', async () => {
    await ensureAssistantMode(mockRepo)
    const opencodeJsonPath = path.join(ws.assistantDir, 'opencode.json')
    await writeFile(opencodeJsonPath, v1Config)

    const api = {
      config: {
        get: async () => { throw new Error('unreachable') },
      },
    } as unknown as OpenCodeApi

    const converted = await convertAssistantOpenCodeConfigToV2(api)

    expect(converted).toBe(false)
    expect(await readFile(opencodeJsonPath, 'utf8')).toBe(v1Config)
  })

  it('does nothing for a v2 config', async () => {
    await ensureAssistantMode(mockRepo)
    let calls = 0
    const api = {
      config: {
        get: async () => { calls += 1; return [] },
      },
    } as unknown as OpenCodeApi

    expect(await convertAssistantOpenCodeConfigToV2(api)).toBe(false)
    expect(calls).toBe(0)
  })
})

describe('assistant-mode end-to-end', () => {
  let ws: Awaited<ReturnType<typeof createTempAssistantWorkspace>>
  let db: ReturnType<typeof createTestDb>

  beforeEach(async () => {
    ws = await createTempAssistantWorkspace()
    db = createTestDb()
  })
  afterEach(async () => { await ws.cleanup() })

  it('the database internal token authenticates a request to /api/internal/schedules/all', async () => {
    await ensureAssistantMode(mockRepo)

    const token = getOrCreateInternalToken(db)

    const stubWorktreeManager = { prepare: () => Promise.resolve(null), finalize: () => Promise.resolve({ commitHash: null }), listWorktrees: () => [] } as unknown as ScheduleWorktreeManager
    const scheduleService = new ScheduleService(db, createOpenCodeClient(), stubWorktreeManager)
    const app = new Hono()
    app.route('/api/internal', createInternalTestApp(db, { scheduleService }))

    const unauth = await app.request('/api/internal/schedules/all')
    expect(unauth.status).toBe(401)

    const authed = await app.request('/api/internal/schedules/all', {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(authed.status).toBe(200)
    const body = await authed.json() as { jobs: unknown[] }
    expect(Array.isArray(body.jobs)).toBe(true)
  })
})

describe('buildAssistantRepo', () => {
  it('returns the synthetic assistant repo with id 0', () => {
    const repo = buildAssistantRepo()
    expect(repo.id).toBe(0)
    expect(repo.localPath).toBe('assistant')
    expect(repo.cloneStatus).toBe('ready')
    expect(repo.repoUrl).toBeUndefined()
    expect(repo.isWorktree).toBe(false)
  })
})

describe('installAssistantWorkspace', () => {
  let ws: Awaited<ReturnType<typeof createTempAssistantWorkspace>>
  let db: ReturnType<typeof createTestDb>

  beforeEach(async () => {
    ws = await createTempAssistantWorkspace()
    db = createTestDb()
  })
  afterEach(async () => { await ws.cleanup() })

  it('provisions the assistant workspace files without contacting OpenCode', async () => {
    const result = await installAssistantWorkspace({ db })

    const opencodeJson = await readFile(path.join(ws.assistantDir, 'opencode.json'), 'utf8')
    expect(JSON.parse(opencodeJson).default_agent).toBe('assistant')

    const agentsMd = await readFile(path.join(ws.assistantDir, 'AGENTS.md'), 'utf8')
    expect(agentsMd).toContain('Assistant Mode Workspace')

    const assistantAgent = await readFile(path.join(ws.assistantDir, '.opencode/agents/assistant.md'), 'utf8')
    expect(assistantAgent).toContain('mode: primary')

    expect(result.files.opencodeJson?.exists).toBe(true)
    expect(result.files.agentsMd?.exists).toBe(true)
    expect(result.defaultAgent?.exists).toBe(true)
    expect(result.repoId).toBe(0)

    const assistantRepo = getRepoById(db, 0)
    expect(assistantRepo?.id).toBe(0)
    expect(assistantRepo?.localPath).toBe('assistant')
    expect(assistantRepo?.fullPath).toBe(ws.assistantDir)
    expect(assistantRepo?.cloneStatus).toBe('ready')
    expect(assistantRepo?.defaultBranch).toBe('main')
  })

  it('repairs an assistant row created with a non-zero id', async () => {
    db.prepare(`
      INSERT INTO repos (
        id,
        repo_url,
        local_path,
        source_path,
        branch,
        default_branch,
        clone_status,
        cloned_at,
        last_accessed_at,
        is_worktree,
        is_local
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(99, null, 'assistant', null, null, 'main', 'ready', Date.now(), Date.now(), 0, 0)
    db.prepare(`
      INSERT INTO schedule_jobs (
        repo_id,
        name,
        description,
        enabled,
        interval_minutes,
        schedule_mode,
        cron_expression,
        timezone,
        agent_slug,
        prompt,
        model,
        skill_metadata,
        created_at,
        updated_at,
        last_run_at,
        next_run_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(99, 'Assistant job', null, 1, 60, 'interval', null, null, null, 'hello', null, null, Date.now(), Date.now(), null, null)

    await installAssistantWorkspace({ db })

    expect(getRepoById(db, 99)).toBeNull()
    const assistantRepo = getRepoById(db, 0)
    expect(assistantRepo?.localPath).toBe('assistant')

    const migratedJob = db.prepare('SELECT repo_id FROM schedule_jobs WHERE name = ?').get('Assistant job') as { repo_id: number }
    expect(migratedJob.repo_id).toBe(0)
  })

  it('is idempotent — second call does not recreate files and content is unchanged', async () => {
    await installAssistantWorkspace({ db })

    const opencodeJsonPath = path.join(ws.assistantDir, 'opencode.json')
    const agentsMdPath = path.join(ws.assistantDir, 'AGENTS.md')
    const assistantAgentPath = path.join(ws.assistantDir, '.opencode/agents/assistant.md')

    const firstContent = {
      opencodeJson: await readFile(opencodeJsonPath, 'utf8'),
      agentsMd: await readFile(agentsMdPath, 'utf8'),
      assistantAgent: await readFile(assistantAgentPath, 'utf8'),
    }

    const result = await installAssistantWorkspace({ db })

    const secondContent = {
      opencodeJson: await readFile(opencodeJsonPath, 'utf8'),
      agentsMd: await readFile(agentsMdPath, 'utf8'),
      assistantAgent: await readFile(assistantAgentPath, 'utf8'),
    }

    expect(secondContent.opencodeJson).toBe(firstContent.opencodeJson)
    expect(secondContent.agentsMd).toBe(firstContent.agentsMd)
    expect(secondContent.assistantAgent).toBe(firstContent.assistantAgent)

    expect(result.files.opencodeJson?.created).toBe(false)
    expect(result.files.agentsMd?.created).toBe(false)
    expect(result.defaultAgent?.created).toBe(false)
  })
})

describe('assistant mode directory contract', () => {
  it('resolves the assistant directory and .opencode directory under the workspace', async () => {
    const ws = await createTempAssistantWorkspace()
    try {
      const { getAssistantModePath, getAssistantOpenCodeDir } = await import('@opencode-manager/shared/config/env')
      const { getAssistantModeDirectory } = await import('../../src/services/assistant-mode')

      expect(getAssistantModeDirectory()).toBe(getAssistantModePath())
      expect(getAssistantOpenCodeDir()).toBe(path.join(ws.assistantDir, '.opencode'))
    } finally {
      await ws.cleanup()
    }
  })
})
