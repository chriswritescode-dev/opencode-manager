import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import path from 'path'
import { readFile, stat, writeFile } from 'fs/promises'
import { Hono } from 'hono'
import { ensureAssistantMode, getAssistantModeStatus, buildSchedulesSkill, buildReposSkill, buildAssistantDefaultAgentMd, buildAssistantOpenCodeConfig } from '../../src/services/assistant-mode'
import { createTempAssistantWorkspace, createTestDb, mockRepo } from '../helpers/assistant-workspace'
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

  it('does not contain v file', () => {
    const content = buildAssistantDefaultAgentMd()
    expect(content).not.toContain('v file')
  })
})

describe('buildAssistantOpenCodeConfig', () => {
  it('includes default_agent and agent.assistant with primary mode', () => {
    const config = buildAssistantOpenCodeConfig()
    expect(config.default_agent).toBe('assistant')
    expect(config.agent?.assistant?.mode).toBe('primary')
    expect(config.agent?.assistant?.prompt).toContain('default Assistant Mode agent')
    expect(config.agent?.assistant?.permission?.read).toBe('allow')
    expect(config.agent?.assistant?.permission?.external_directory).toBe('ask')
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

    expect(agentsMd).toContain('schedule-management')
    expect(agentsMd).toContain('repo-management')
    const parsedConfig = JSON.parse(opencodeJson)
    expect(parsedConfig.default_agent).toBe('assistant')
    expect(parsedConfig).not.toHaveProperty('mcp')
    expect(parsedConfig.agent?.assistant?.mode).toBe('primary')
    expect(parsedConfig.agent?.assistant?.prompt).toContain('default Assistant Mode agent')
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
    expect(opencodeJson.agent?.assistant?.description).toBe('Default OpenCode Manager assistant workspace agent')
    expect(opencodeJson.agent?.assistant?.mode).toBe('primary')
    expect(opencodeJson.agent?.assistant?.prompt).toContain('This workspace is the shared assistant workspace')
    expect(opencodeJson.agent?.assistant?.permission).toEqual({
      read: 'allow',
      edit: 'allow',
      glob: 'allow',
      grep: 'allow',
      list: 'allow',
      bash: 'allow',
      external_directory: 'ask',
    })

    const agentsMdContent = await readFile(agentsMdPath, 'utf8')
    expect(agentsMdContent).toContain('Assistant Mode Instructions')
    expect(agentsMdContent).toContain('Self-Editing Rules')
    expect(agentsMdContent).toContain('Schedule Management')
    expect(agentsMdContent).toContain('Notifications')
    expect(agentsMdContent).toContain('Settings Management')
    expect(agentsMdContent).toContain('Repo Management')

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
    expect(repaired.agent.assistant.mode).toBe('primary')
    expect(repaired.agent.assistant.prompt).toContain('default Assistant Mode agent')
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
    app.route('/api/internal', createInternalRoutes(db, scheduleService, notificationService, settingsService))

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
