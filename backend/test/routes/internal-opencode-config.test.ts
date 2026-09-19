import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { Hono } from 'hono'
import { Database } from 'bun:sqlite'
import { readFile } from 'fs/promises'
import path from 'path'
import { createInternalRoutes } from '../../src/routes/internal'
import { ScheduleService } from '../../src/services/schedules'
import { NotificationService } from '../../src/services/notification'
import { SettingsService } from '../../src/services/settings'
import { createOpenCodeClient } from '../../src/services/opencode/client'
import { allMigrations } from '../../src/db/migrations'
import { getOrCreateInternalToken } from '../../src/services/internal-token'
import { migrate } from '../../src/db/migration-runner'
import { OPENCODE_CONFIG_SEED, writeOpenCodeConfigFile } from '../../src/services/opencode-config-file'
import { createTempAssistantWorkspace } from '../helpers/assistant-workspace'
import type { ScheduleWorktreeManager } from '../../src/services/schedule-worktree'

describe('internal/opencode-config routes', () => {
  let db: Database
  let app: Hono
  let token: string
  let ws: Awaited<ReturnType<typeof createTempAssistantWorkspace>>

  beforeEach(async () => {
    ws = await createTempAssistantWorkspace()
    db = new Database(':memory:')
    migrate(db, allMigrations)
    const openCodeClient = createOpenCodeClient()
    const stubWorktreeManager = { prepare: () => Promise.resolve(null), finalize: () => Promise.resolve({ commitHash: null }) } as unknown as ScheduleWorktreeManager
    const scheduleService = new ScheduleService(db, openCodeClient, stubWorktreeManager)
    const notificationService = new NotificationService(db)
    const settingsService = new SettingsService(db)
    app = new Hono()
    app.route('/api/internal', createInternalRoutes(db, scheduleService, notificationService, settingsService, openCodeClient))
    token = getOrCreateInternalToken(db)
  })

  afterEach(async () => {
    await ws.cleanup()
  })

  it('GET /api/internal/opencode-config returns 401 without bearer token', async () => {
    const res = await app.request('/api/internal/opencode-config')
    expect(res.status).toBe(401)
  })

  it('GET /api/internal/opencode-config returns 404 when no config file exists', async () => {
    const res = await app.request('/api/internal/opencode-config', {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(404)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('No OpenCode config file found')
  })

  it('GET /api/internal/opencode-config returns the on-disk config state', async () => {
    await writeOpenCodeConfigFile(OPENCODE_CONFIG_SEED)

    const res = await app.request('/api/internal/opencode-config', {
      headers: { authorization: `Bearer ${token}` },
    })

    expect(res.status).toBe(200)
    const body = await res.json() as {
      path: string
      content: Record<string, unknown>
      rawContent: string
      isValid: boolean
      updatedAt: number
    }
    expect(body.path).toBe(path.join(ws.workspacePath, '.config/opencode/opencode.json'))
    expect(body.rawContent).toBe(OPENCODE_CONFIG_SEED)
    expect(body.content).toEqual({ $schema: 'https://opencode.ai/config.json' })
    expect(body.isValid).toBe(true)
    expect(body.updatedAt).toBeGreaterThan(0)
  })

  it('PUT /api/internal/opencode-config writes the file and reports restartRequired for a plugin change', async () => {
    await writeOpenCodeConfigFile(OPENCODE_CONFIG_SEED)

    const res = await app.request('/api/internal/opencode-config', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ content: { $schema: 'https://opencode.ai/config.json', plugin: ['x'] } }),
    })

    expect(res.status).toBe(200)
    const body = await res.json() as { restartRequired?: boolean; content: Record<string, unknown> }
    expect(body.restartRequired).toBe(true)
    expect(body.content).toEqual({ $schema: 'https://opencode.ai/config.json', plugin: ['x'] })

    const onDisk = await readFile(path.join(ws.workspacePath, '.config/opencode/opencode.json'), 'utf8')
    expect(JSON.parse(onDisk).plugin).toEqual(['x'])
  })

  it('PUT /api/internal/opencode-config returns 400 for an invalid JSON body', async () => {
    const res = await app.request('/api/internal/opencode-config', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: '{',
    })

    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('Invalid JSON')
  })
})
