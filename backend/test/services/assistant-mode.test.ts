import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import path from 'path'
import { readFile, stat } from 'fs/promises'
import { Hono } from 'hono'
import { ensureAssistantMode, buildSchedulesSkill } from '../../src/services/assistant-mode'
import { createTempAssistantWorkspace, createTestDb, mockRepo } from '../helpers/assistant-workspace'
import { createInternalRoutes } from '../../src/routes/internal'
import { ScheduleService } from '../../src/services/schedules'
import { createOpenCodeClient } from '../../src/services/opencode/client'
import { ENV } from '@opencode-manager/shared/config/env'

describe('buildSchedulesSkill', () => {
  it('uses ENV.SERVER.PORT in the internal base URL', () => {
    const skill = buildSchedulesSkill('https://example.com:443/api/internal')
    expect(skill).toContain(`http://localhost:${ENV.SERVER.PORT}/api/internal`)
    expect(skill).not.toContain(':443')
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

    expect(agentsMd).toContain('schedule-management')
    expect(JSON.parse(opencodeJson)).not.toHaveProperty('mcp')
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    expect(skill).toContain('Authorization: Bearer')
    expect(skill).toContain(localApiBaseUrl)
    expect(skill).not.toContain(apiBaseUrl)
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
    const app = new Hono()
    app.route('/api/internal', createInternalRoutes(db, scheduleService))

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
