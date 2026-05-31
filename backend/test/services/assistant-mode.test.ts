import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import path from 'path'
import { readFile, stat, writeFile } from 'fs/promises'
import { Hono } from 'hono'
import { ensureAssistantMode, getAssistantModeStatus, buildSchedulesSkill, buildReposSkill, buildSettingsSkill, buildAssistantDefaultAgentMd, buildAssistantOpenCodeConfig, buildAssistantRepo, warmAssistantWorkspace } from '../../src/services/assistant-mode'
import { createTempAssistantWorkspace, createTestDb, mockRepo } from '../helpers/assistant-workspace'
import type { OpenCodeClient } from '../../src/services/opencode/client'
import { createInternalRoutes } from '../../src/routes/internal'
import { ScheduleService } from '../../src/services/schedules'
import { NotificationService } from '../../src/services/notification'
import { SettingsService } from '../../src/services/settings'
import { createOpenCodeClient } from '../../src/services/opencode/client'
import { ENV } from '@opencode-manager/shared/config/env'

describe('buildSchedulesSkill', () => {
  it('uses ENV.SERVER.PORT in the internal base URL', () => {
    const skill = buildSchedulesSkill('https://example.com:443/api/internal')
    expect(skill).toContain(`http://localhost:${ENV.SERVER.PORT}/api/internal`)
    expect(skill).not.toContain(':443')
  })
})

describe('buildReposSkill', () => {
  it('uses ENV.SERVER.PORT in the internal base URL', () => {
    const skill = buildReposSkill('https://example.com:443/api/internal')
    expect(skill).toContain(`http://localhost:${ENV.SERVER.PORT}/api/internal`)
    expect(skill).not.toContain(':443')
  })

  it('contains GET /repos endpoint documentation', () => {
    const skill = buildReposSkill('http://localhost:5003/api/internal')
    expect(skill).toContain('GET /repos')
  })

  it('contains Authorization Bearer header documentation', () => {
    const skill = buildReposSkill('http://localhost:5003/api/internal')
    expect(skill).toContain('Authorization: Bearer')
    expect(skill).toContain('.opencode/internal-token')
  })

  it('contains internal localhost URL', () => {
    const localApiBaseUrl = 'http://localhost:5003/api/internal'
    const skill = buildReposSkill('http://localhost:5003/api/internal')
    expect(skill).toContain(localApiBaseUrl)
  })
})

describe('buildSettingsSkill', () => {
  it('uses ENV.SERVER.PORT in the internal base URL', () => {
    const skill = buildSettingsSkill('https://example.com:443/api/internal')
    expect(skill).toContain(`http://localhost:${ENV.SERVER.PORT}/api/internal`)
    expect(skill).not.toContain(':443')
  })

  it('includes tts and stt in allowed non-secret preferences', () => {
    const skill = buildSettingsSkill('http://localhost:5003/api/internal')
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
    const skill = buildSettingsSkill('http://localhost:5003/api/internal')
    expect(skill).toContain('/assistant/reload')
    expect(skill).toContain('Always confirm with the user before reloading')
    expect(skill).toContain('5 requests per minute')
  })

  it('still lists apiKey and endpoint as forbidden', () => {
    const skill = buildSettingsSkill('http://localhost:5003/api/internal')
    expect(skill).toContain('tts.apiKey')
    expect(skill).toContain('tts.endpoint')
    expect(skill).toContain('stt.apiKey')
    expect(skill).toContain('stt.endpoint')
    expect(skill).toContain('DO NOT attempt to set')
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
  it('includes default_agent and agent.assistant with primary mode and no embedded persona', () => {
    const config = buildAssistantOpenCodeConfig()
    expect(config.default_agent).toBe('assistant')
    expect(config.agent?.assistant).toEqual({ mode: 'primary' })
    expect(config.agent?.assistant?.prompt).toBeUndefined()
    expect(config.agent?.assistant?.description).toBeUndefined()
    expect(config.agent?.assistant?.permission).toBeUndefined()
  })
})

describe('ensureAssistantMode', () => {
  let ws: Awaited<ReturnType<typeof createTempAssistantWorkspace>>
  let db: ReturnType<typeof createTestDb>
  const apiBaseUrl = 'http://example.test:5003/api/internal'
  const localApiBaseUrl = 'http://localhost:5003/api/internal'

  beforeEach(async () => {
    ws = await createTempAssistantWorkspace()
    db = createTestDb()
  })
  afterEach(async () => { await ws.cleanup() })

  it('creates AGENTS.md, opencode.json, internal-token, and SKILL.md on first run', async () => {
    await ensureAssistantMode(mockRepo, { db, apiBaseUrl })
    const agentsMd = await readFile(path.join(ws.assistantDir, 'AGENTS.md'), 'utf8')
    const opencodeJson = await readFile(path.join(ws.assistantDir, 'opencode.json'), 'utf8')
    const token = await readFile(path.join(ws.assistantDir, '.opencode/internal-token'), 'utf8')
    const skill = await readFile(path.join(ws.assistantDir, '.opencode/skills/schedule-management/SKILL.md'), 'utf8')
    const repoSkill = await readFile(path.join(ws.assistantDir, '.opencode/skills/repo-management/SKILL.md'), 'utf8')
    const assistantAgent = await readFile(path.join(ws.assistantDir, '.opencode/agents/assistant.md'), 'utf8')

    expect(agentsMd).toContain('.opencode/agents/assistant.md')
    expect(agentsMd).not.toContain('Self-Editing Rules')
    const parsedConfig = JSON.parse(opencodeJson)
    expect(parsedConfig.default_agent).toBe('assistant')
    expect(parsedConfig).not.toHaveProperty('mcp')
    expect(parsedConfig.agent?.assistant).toEqual({ mode: 'primary' })
    expect(parsedConfig.agent?.assistant?.prompt).toBeUndefined()
    expect(parsedConfig.agent?.assistant?.description).toBeUndefined()
    expect(parsedConfig.agent?.assistant?.permission).toBeUndefined()
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    expect(skill).toContain('Authorization: Bearer')
    expect(skill).toContain(localApiBaseUrl)
    expect(skill).not.toContain(apiBaseUrl)
    expect(repoSkill).toContain('GET /repos')
    expect(repoSkill).toContain('Authorization: Bearer')
    expect(repoSkill).toContain('.opencode/internal-token')
    expect(repoSkill).toContain(localApiBaseUrl)
    expect(assistantAgent).toContain('mode: primary')
    expect(assistantAgent).toContain('Default OpenCode Manager assistant workspace agent')
    expect(assistantAgent).not.toContain('v file')
  })

  it('does not rewrite the token file on a second run with the same db', async () => {
    await ensureAssistantMode(mockRepo, { db, apiBaseUrl })
    const tokenPath = path.join(ws.assistantDir, '.opencode/internal-token')
    const firstToken = await readFile(tokenPath, 'utf8')
    const firstStat = await stat(tokenPath)

    await new Promise(r => setTimeout(r, 10))

    const result = await ensureAssistantMode(mockRepo, { db, apiBaseUrl })
    const secondToken = await readFile(tokenPath, 'utf8')
    const secondStat = await stat(tokenPath)

    expect(secondToken).toBe(firstToken)
    expect(secondStat.mtimeMs).toBe(firstStat.mtimeMs)
    expect(result.internalToken?.created).toBe(false)
    expect(result.schedulesSkill?.created).toBe(false)
    expect(result.repoManagementSkill?.created).toBe(false)
  })

  it('writes all files needed before OpenCode assistant session launch', async () => {
    const result = await ensureAssistantMode(mockRepo, { db, apiBaseUrl })

    const opencodeJsonPath = path.join(ws.assistantDir, 'opencode.json')
    const agentsMdPath = path.join(ws.assistantDir, 'AGENTS.md')
    const schedulesSkillPath = path.join(ws.assistantDir, '.opencode/skills/schedule-management/SKILL.md')
    const notificationsSkillPath = path.join(ws.assistantDir, '.opencode/skills/notifications/SKILL.md')
    const settingsSkillPath = path.join(ws.assistantDir, '.opencode/skills/manager-settings/SKILL.md')
    const reposSkillPath = path.join(ws.assistantDir, '.opencode/skills/repo-management/SKILL.md')
    const assistantAgentPath = path.join(ws.assistantDir, '.opencode/agents/assistant.md')

    const opencodeJsonContent = await readFile(opencodeJsonPath, 'utf8')
    const opencodeJson = JSON.parse(opencodeJsonContent)

    expect(opencodeJson.default_agent).toBe('assistant')
    expect(opencodeJson.instructions).toEqual(['AGENTS.md'])
    expect(opencodeJson.permission).toEqual({
      read: 'allow',
      edit: 'allow',
      glob: 'allow',
      grep: 'allow',
      list: 'allow',
      bash: 'allow',
      external_directory: 'ask',
    })
    expect(opencodeJson.agent?.assistant).toEqual({ mode: 'primary' })
    expect(opencodeJson.agent?.assistant?.prompt).toBeUndefined()
    expect(opencodeJson.agent?.assistant?.description).toBeUndefined()
    expect(opencodeJson.agent?.assistant?.permission).toBeUndefined()

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

    const notificationsSkillContent = await readFile(notificationsSkillPath, 'utf8')
    expect(notificationsSkillContent).toContain('name: notifications')
    expect(notificationsSkillContent).toContain('Send push notifications')

    const settingsSkillContent = await readFile(settingsSkillPath, 'utf8')
    expect(settingsSkillContent).toContain('name: manager-settings')
    expect(settingsSkillContent).toContain('Read and modify')

    const reposSkillContent = await readFile(reposSkillPath, 'utf8')
    expect(reposSkillContent).toContain('name: repo-management')
    expect(reposSkillContent).toContain('List repos available')

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
    expect(result.defaultAgent?.name).toBe('assistant')
    expect(result.defaultAgent?.path).toBe(assistantAgentPath)
    expect(result.defaultAgent?.exists).toBe(true)
    expect(result.defaultAgent?.created).toBe(true)
  })

  it('reports repo management skill status from getAssistantModeStatus', async () => {
    await ensureAssistantMode(mockRepo, { db, apiBaseUrl })

    const status = await getAssistantModeStatus(mockRepo)

    expect(status.repoManagementSkill?.path).toBe(path.join(ws.assistantDir, '.opencode/skills/repo-management/SKILL.md'))
    expect(status.repoManagementSkill?.created).toBe(false)
  })

  it('preserves custom assistant agent content on subsequent ensureAssistantMode calls', async () => {
    await ensureAssistantMode(mockRepo, { db, apiBaseUrl })
    const assistantAgentPath = path.join(ws.assistantDir, '.opencode/agents/assistant.md')

    const customContent = '---\ndescription: Custom assistant\nmode: primary\n---\n\nCustom assistant instructions.'
    await writeFile(assistantAgentPath, customContent)

    const result2 = await ensureAssistantMode(mockRepo, { db, apiBaseUrl })

    const preservedContent = await readFile(assistantAgentPath, 'utf8')
    expect(preservedContent).toBe(customContent)
    expect(result2.defaultAgent?.created).toBe(false)
  })

  it('repairs existing assistant opencode config missing configured assistant agent', async () => {
    await ensureAssistantMode(mockRepo, { db, apiBaseUrl })
    const opencodeJsonPath = path.join(ws.assistantDir, 'opencode.json')
    await writeFile(opencodeJsonPath, JSON.stringify({
      model: 'provider/model',
      instructions: ['AGENTS.md'],
      default_agent: 'build',
      agent: {
        custom: { mode: 'primary', prompt: 'Custom agent' },
      },
      skills: { paths: ['.opencode/skills'] },
    }, null, 2))

    const result = await ensureAssistantMode(mockRepo, { db, apiBaseUrl })
    const repaired = JSON.parse(await readFile(opencodeJsonPath, 'utf8'))

    expect(repaired.default_agent).toBe('assistant')
    expect(repaired.agent.assistant).toEqual({ mode: 'primary', disable: false })
    expect(repaired.agent.assistant.prompt).toBeUndefined()
    expect(repaired.agent.custom.prompt).toBe('Custom agent')
    expect(repaired.model).toBe('provider/model')
    expect(repaired.skills.paths).toEqual(['.opencode/skills'])
    expect(result.files.opencodeJson?.created).toBe(true)
  })

  it('preserves custom assistant config while making it selectable', async () => {
    await ensureAssistantMode(mockRepo, { db, apiBaseUrl })
    const opencodeJsonPath = path.join(ws.assistantDir, 'opencode.json')
    await writeFile(opencodeJsonPath, JSON.stringify({
      default_agent: 'assistant',
      agent: {
        assistant: {
          mode: 'subagent',
          prompt: 'Custom assistant prompt',
          description: 'Custom assistant',
          permission: { bash: 'ask' },
        },
      },
    }, null, 2))

    const result = await ensureAssistantMode(mockRepo, { db, apiBaseUrl })
    const repaired = JSON.parse(await readFile(opencodeJsonPath, 'utf8'))

    expect(repaired.agent.assistant.prompt).toBe('Custom assistant prompt')
    expect(repaired.agent.assistant.description).toBe('Custom assistant')
    expect(repaired.agent.assistant.permission.bash).toBe('ask')
    expect(repaired.agent.assistant.mode).toBe('primary')
    expect(repaired.agent.assistant.disable).toBe(false)
    expect(result.files.opencodeJson?.created).toBe(true)
  })

  it('migrates generated legacy AGENTS.md and assistant.md to the new split', async () => {
    await ensureAssistantMode(mockRepo, { db, apiBaseUrl })

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
      permission: {
        read: 'allow',
        edit: 'allow',
        glob: 'allow',
        grep: 'allow',
        list: 'allow',
        bash: 'allow',
        external_directory: 'ask',
      },
      agent: {
        assistant: {
          description: 'Default OpenCode Manager assistant workspace agent',
          mode: 'primary',
          prompt: legacyAssistantPrompt,
          permission: {
            read: 'allow',
            edit: 'allow',
            glob: 'allow',
            grep: 'allow',
            list: 'allow',
            bash: 'allow',
            external_directory: 'ask',
          },
        },
      },
    }, null, 2))

    const result = await ensureAssistantMode(mockRepo, { db, apiBaseUrl })

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

    expect(updatedOpenCodeJson.agent.assistant.prompt).toBeUndefined()
    expect(updatedOpenCodeJson.agent.assistant.description).toBeUndefined()
    expect(updatedOpenCodeJson.agent.assistant.permission).toBeUndefined()
    expect(updatedOpenCodeJson.agent.assistant.mode).toBe('primary')

    expect(result.files.agentsMd?.created).toBe(true)
    expect(result.files.opencodeJson?.created).toBe(true)
    expect(result.defaultAgent?.created).toBe(true)
  })

  it('preserves custom AGENTS.md content on subsequent ensureAssistantMode calls', async () => {
    await ensureAssistantMode(mockRepo, { db, apiBaseUrl })
    const agentsMdPath = path.join(ws.assistantDir, 'AGENTS.md')

    const customContent = '# Custom Assistant Workspace\n\nThis is my custom AGENTS.md content.'
    await writeFile(agentsMdPath, customContent)

    const result = await ensureAssistantMode(mockRepo, { db, apiBaseUrl })

    const preservedContent = await readFile(agentsMdPath, 'utf8')
    expect(preservedContent).toBe(customContent)
    expect(result.files.agentsMd?.created).toBe(false)
  })

  it('warns when managed updates apply but customized legacy AGENTS.md is preserved', async () => {
    await ensureAssistantMode(mockRepo, { db, apiBaseUrl })
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

    const result = await ensureAssistantMode(mockRepo, { db, apiBaseUrl })

    const preservedAgentsMd = await readFile(agentsMdPath, 'utf8')
    expect(preservedAgentsMd).toContain('Self-Editing Rules')
    expect(result.files.agentsMd?.created).toBe(false)
    expect(result.defaultAgent?.created).toBe(true)
    expect(result.warnings?.[0]?.code).toBe('assistant-agents-md-preserved')
    expect(result.warnings?.[0]?.message).toContain('manually delete AGENTS.md')
  })

  it('overwrites custom AGENTS.md when overwriteAgentsMd is true', async () => {
    await ensureAssistantMode(mockRepo, { db, apiBaseUrl })
    const agentsMdPath = path.join(ws.assistantDir, 'AGENTS.md')

    const customContent = '# Custom Assistant Workspace\n\nThis is my custom AGENTS.md content.'
    await writeFile(agentsMdPath, customContent)

    const result = await ensureAssistantMode(mockRepo, { db, apiBaseUrl }, { overwriteAgentsMd: true })

    const updatedContent = await readFile(agentsMdPath, 'utf8')
    expect(updatedContent).toContain('Assistant Mode Workspace')
    expect(updatedContent).toContain('.opencode/agents/assistant.md')
    expect(updatedContent).not.toBe(customContent)
    expect(result.files.agentsMd?.created).toBe(true)
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

  it('token written by ensureAssistantMode authenticates a request to /api/internal/schedules/all', async () => {
    const apiBaseUrl = 'http://127.0.0.1:5003/api/internal'
    await ensureAssistantMode(mockRepo, { db, apiBaseUrl })

    const token = (await readFile(path.join(ws.assistantDir, '.opencode/internal-token'), 'utf8')).trim()

    const scheduleService = new ScheduleService(db, createOpenCodeClient())
    const notificationService = new NotificationService(db)
    const settingsService = new SettingsService(db)
    const app = new Hono()
    app.route('/api/internal', createInternalRoutes(db, scheduleService, notificationService, settingsService, createOpenCodeClient()))

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

describe('warmAssistantWorkspace', () => {
  let ws: Awaited<ReturnType<typeof createTempAssistantWorkspace>>
  let db: ReturnType<typeof createTestDb>
  const apiBaseUrl = 'http://localhost:5003/api/internal'

  beforeEach(async () => {
    ws = await createTempAssistantWorkspace()
    db = createTestDb()
  })
  afterEach(async () => { await ws.cleanup() })

  it('provisions the workspace and triggers a directory-scoped session request', async () => {
    const getJsonCalls: Array<{ path: string; directory?: string }> = []
    const client = {
      getJson: async (requestPath: string, opts?: { directory?: string }) => {
        getJsonCalls.push({ path: requestPath, directory: opts?.directory })
        return []
      },
    } as unknown as OpenCodeClient

    await warmAssistantWorkspace({ db, apiBaseUrl, openCodeClient: client })

    const opencodeJson = await readFile(path.join(ws.assistantDir, 'opencode.json'), 'utf8')
    expect(JSON.parse(opencodeJson).default_agent).toBe('assistant')
    expect(getJsonCalls).toHaveLength(1)
    expect(getJsonCalls[0]?.path).toBe('/session')
    expect(getJsonCalls[0]?.directory).toBe(ws.assistantDir)
  })

  it('does not throw and still provisions the workspace when the session request fails', async () => {
    const client = {
      getJson: async () => { throw new Error('opencode unavailable') },
    } as unknown as OpenCodeClient

    await expect(
      warmAssistantWorkspace({ db, apiBaseUrl, openCodeClient: client })
    ).resolves.toBeUndefined()

    const opencodeJson = await stat(path.join(ws.assistantDir, 'opencode.json'))
    expect(opencodeJson.isFile()).toBe(true)
  })
})
