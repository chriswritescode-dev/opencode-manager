import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import { Database } from 'bun:sqlite'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { migrate } from '../db/migration-runner'
import { allMigrations } from '../db/migrations'
import { createSettingsRoutes } from './settings'
import { opencodeServerManager } from '../services/opencode-single-server'
import type { GitAuthService } from '../services/git-auth'
import type { OpenCodeSupervisor } from '../services/opencode-supervisor'
import { createStubOpenCodeClient } from '../../test/helpers/stub-opencode-client'
import type { OpenCodeRestartCoordinator, ResumableSession } from '../services/opencode-restart-coordinator'
import { setOpenCodeRestartCoordinator } from '../services/opencode-restart'

interface TestUserPreferenceRow {
  preferences: string
  updated_at: number
}

interface TestMigrationRow {
  version: number
  name: string
  applied_at: number
}

interface StatementResult {
  get?: (..._params: unknown[]) => TestUserPreferenceRow | TestMigrationRow | { count: number } | { name: string } | { user_id: string; preferences: string } | undefined
  run?: (..._params: unknown[]) => { changes: number }
  all?: () => Array<unknown>
}

class InMemoryDatabase {
  private userPreferences = new Map<string, TestUserPreferenceRow>()
  private schemaMigrations = new Map<number, { name: string; applied_at: number }>()

  private normalizeSql(sql: string): string {
    return sql.trim().toLowerCase().replace(/\s+/g, ' ')
  }

  private getMigrationRows(): TestMigrationRow[] {
    return [...this.schemaMigrations.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([version, value]) => ({
        version,
        name: value.name,
        applied_at: value.applied_at,
      }))
  }

  private setUserPreference(userId: string, preferences: string, updatedAt: number): void {
    this.userPreferences.set(userId, { preferences, updated_at: updatedAt })
  }

  private createStatement(sql: string): StatementResult {
    const normalizedSql = this.normalizeSql(sql)

    if (normalizedSql === 'select version from schema_migrations order by version') {
      return {
        all: () => this.getMigrationRows(),
      }
    }

    if (normalizedSql.startsWith('insert into schema_migrations')) {
      return {
        run: (...params: unknown[]) => {
          const [version, name, appliedAt] = params as [number, string, number]
          this.schemaMigrations.set(version, { name, applied_at: appliedAt })
          return { changes: 1 }
        },
      }
    }

    if (normalizedSql === 'select preferences, updated_at from user_preferences where user_id = ?') {
      return {
        get: (...params: unknown[]) => {
          const userId = params[0]
          if (typeof userId !== 'string') {
            return undefined
          }
          return this.userPreferences.get(userId)
        },
      }
    }

    if (normalizedSql.startsWith('insert into user_preferences')) {
      return {
        run: (...params: unknown[]) => {
          const [userId, preferences, updatedAt] = params as [string, string, number]
          this.setUserPreference(userId, preferences, updatedAt)
          return { changes: 1 }
        },
      }
    }

    if (normalizedSql.startsWith('delete from user_preferences where user_id = ?')) {
      return {
        run: (...params: unknown[]) => {
          const userId = params[0]
          if (typeof userId !== 'string') {
            return { changes: 0 }
          }
          const hadRow = this.userPreferences.delete(userId)
          return { changes: hadRow ? 1 : 0 }
        },
      }
    }

    if (normalizedSql.startsWith('select user_id, preferences from user_preferences')) {
      return {
        all: () => [...this.userPreferences.entries()].map(([user_id, row]) => ({
          user_id,
          preferences: row.preferences,
        })),
      }
    }

    if (normalizedSql.startsWith('pragma table_info(') || normalizedSql.includes('select name from sqlite_master')) {
      return {
        all: () => [],
        get: () => undefined,
      }
    }

    if (normalizedSql.startsWith('select count(*) as count')) {
      return {
        get: () => ({ count: 0 }),
      }
    }

    if (
      normalizedSql.startsWith('create table') ||
      normalizedSql.startsWith('create index') ||
      normalizedSql.startsWith('drop table') ||
      normalizedSql.startsWith('drop index')
    ) {
      return {
        run: () => ({ changes: 0 }),
      }
    }

    if (
      normalizedSql.startsWith('begin transaction') ||
      normalizedSql.startsWith('commit') ||
      normalizedSql.startsWith('rollback')
    ) {
      return {
        run: () => ({ changes: 0 }),
      }
    }

    return {
      get: () => undefined,
      run: () => ({ changes: 0 }),
      all: () => [],
    }
  }

  query(sql: string): StatementResult {
    return this.createStatement(sql)
  }

  prepare(sql: string): StatementResult {
    return this.createStatement(sql)
  }

  run(sql: string, ...params: unknown[]): { changes: number } {
    const statement = this.createStatement(sql)
    return statement.run ? statement.run(...params) : { changes: 0 }
  }

  close() {
    this.userPreferences.clear()
    this.schemaMigrations.clear()
  }
}

vi.mock('bun:sqlite', () => ({
  Database: class {
    private db = new InMemoryDatabase()

    query(sql: string) {
      return this.db.query(sql)
    }

    prepare(sql: string) {
      return this.db.prepare(sql)
    }

    run(sql: string, ...params: unknown[]) {
      return this.db.run(sql, ...params)
    }

    close() {
      return this.db.close()
    }

    exec(sql: string) {
      return this.db.run(sql)
    }
  },
}))

const mockGitAuthService = {
  getGitEnvironment: () => ({}),
} as unknown as GitAuthService

function createTestDb(): Database {
  const db = new Database(':memory:')
  migrate(db, allMigrations)
  return db
}

function createTestApp(db: Database, openCodeSupervisor?: OpenCodeSupervisor): Hono {
  const app = new Hono()
  app.route('/settings', createSettingsRoutes(db, mockGitAuthService, createStubOpenCodeClient(), openCodeSupervisor))
  return app
}

describe('settings routes — serverEnvVars', () => {
  let db: Database
  let app: Hono
  let originalWorkspacePath: string | undefined

  beforeEach(() => {
    db = createTestDb()
    app = createTestApp(db)
    originalWorkspacePath = process.env.WORKSPACE_PATH
    process.env.WORKSPACE_PATH = '/tmp/test-workspace-settings-routes'
  })

  afterEach(() => {
    if (originalWorkspacePath) {
      process.env.WORKSPACE_PATH = originalWorkspacePath
    } else {
      delete process.env.WORKSPACE_PATH
    }
    db.close()
  })

  it('GET / returns empty serverEnvVars by default', async () => {
    const res = await app.request('/settings')

    expect(res.status).toBe(200)
    const data = (await res.json()) as { preferences: { serverEnvVars?: Array<{ key: string; value: string }> } }
    expect(data.preferences.serverEnvVars).toEqual([])
  })

  it('PATCH / saves and returns serverEnvVars', async () => {
    const patchRes = await app.request('/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        preferences: {
          serverEnvVars: [
            {
              key: 'OPENCODE_EXPERIMENTAL_WORKSPACES',
              value: 'true',
            },
          ],
        },
      }),
    })

    expect(patchRes.status).toBe(200)
    const data = (await patchRes.json()) as { preferences: { serverEnvVars: Array<{ key: string; value: string }> } }
    expect(data.preferences.serverEnvVars).toEqual([
      {
        key: 'OPENCODE_EXPERIMENTAL_WORKSPACES',
        value: 'true',
      },
    ])
  })

  it('PATCH / persists serverEnvVars and returns on GET', async () => {
    await app.request('/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        preferences: {
          serverEnvVars: [{
            key: 'MY_FLAG',
            value: '1',
          }],
        },
      }),
    })

    const res = await app.request('/settings')
    const data = (await res.json()) as { preferences: { serverEnvVars: Array<{ key: string; value: string }> } }

    expect(data.preferences.serverEnvVars).toEqual([
      {
        key: 'MY_FLAG',
        value: '1',
      },
    ])
  })
})

describe('settings routes — OpenCode directory file upload', () => {
  let db: Database
  let app: Hono
  let originalWorkspacePath: string | undefined
  let workspacePath: string
  const restart = vi.fn(async () => undefined)
  let markRestartPendingSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    db = createTestDb()
    restart.mockClear()
    markRestartPendingSpy = vi.spyOn(opencodeServerManager, 'markRestartPending').mockImplementation(() => undefined)
    originalWorkspacePath = process.env.WORKSPACE_PATH
    workspacePath = await mkdtemp(join(tmpdir(), 'ocm-command-upload-'))
    process.env.WORKSPACE_PATH = workspacePath
    app = createTestApp(db, { restart } as unknown as OpenCodeSupervisor)
  })

  afterEach(async () => {
    if (originalWorkspacePath) {
      process.env.WORKSPACE_PATH = originalWorkspacePath
    } else {
      delete process.env.WORKSPACE_PATH
    }
    await rm(workspacePath, { recursive: true, force: true })
    db.close()
    markRestartPendingSpy.mockRestore()
  })

  it('installs uploaded command markdown files into the OpenCode commands directory', async () => {
    const formData = new FormData()
    formData.append('kind', 'commands')
    formData.append('fileManifest', JSON.stringify([
      { fieldName: 'file0', relativePath: 'commands/git/commit.md' },
      { fieldName: 'file1', relativePath: 'commands/.DS_Store' },
    ]))
    formData.append('file0', new File(['commit body'], 'commit.md', { type: 'text/markdown' }))

    const res = await app.request('/settings/opencode-directory-files/install', {
      method: 'POST',
      body: formData,
    })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      kind: 'commands',
      filesInstalled: ['git/commit.md'],
      restartRequired: true,
    })
    await expect(readFile(join(workspacePath, '.config/opencode/commands/git/commit.md'), 'utf8')).resolves.toBe('commit body')
    expect(restart).not.toHaveBeenCalled()
    expect(markRestartPendingSpy).toHaveBeenCalledTimes(1)
  })

  it('lists uploaded command and agent directory files', async () => {
    await mkdir(join(workspacePath, '.config/opencode/commands/git'), { recursive: true })
    await mkdir(join(workspacePath, '.config/opencode/agents/team'), { recursive: true })
    await writeFile(join(workspacePath, '.config/opencode/commands/git/commit.md'), 'commit body')
    await writeFile(join(workspacePath, '.config/opencode/commands/git/.DS_Store'), 'metadata')
    await writeFile(join(workspacePath, '.config/opencode/agents/team/planner.md'), 'planner body')

    const commandsRes = await app.request('/settings/opencode-directory-files?kind=commands')
    const agentsRes = await app.request('/settings/opencode-directory-files?kind=agents')

    expect(commandsRes.status).toBe(200)
    expect(agentsRes.status).toBe(200)
    await expect(commandsRes.json()).resolves.toEqual([
      { kind: 'commands', name: 'commit', relativePath: 'git/commit.md' },
    ])
    await expect(agentsRes.json()).resolves.toEqual([
      { kind: 'agents', name: 'planner', relativePath: 'team/planner.md' },
    ])
  })
})

describe('settings routes — opencode model discovery', () => {
  let db: Database
  let app: Hono
  let originalFetch: typeof globalThis.fetch
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    db = createTestDb()
    app = createTestApp(db)
    originalFetch = globalThis.fetch
    fetchMock = vi.fn()
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    db.close()
  })

  it('returns 400 when baseUrl is missing', async () => {
    const res = await app.request('/settings/opencode-discover-models')
    expect(res.status).toBe(400)
  })

  it('returns 400 when baseUrl is invalid', async () => {
    const res = await app.request('/settings/opencode-discover-models?baseUrl=not-a-url')
    expect(res.status).toBe(400)
  })

  it('returns 400 when baseUrl is not http/https', async () => {
    const res = await app.request('/settings/opencode-discover-models?baseUrl=ftp://example.com')
    expect(res.status).toBe(400)
  })

  it('discovers models from the endpoint', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ id: 'gpt-4o' }, { id: 'gpt-3.5-turbo' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const res = await app.request('/settings/opencode-discover-models?baseUrl=http://localhost:1234&refresh=true')
    expect(res.status).toBe(200)
    const data = (await res.json()) as { models: string[]; cached: boolean }
    expect(data.models).toEqual(['gpt-4o', 'gpt-3.5-turbo'])
    expect(data.cached).toBe(false)
  })

  it('returns cached models on subsequent requests without re-fetching', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ id: 'llama-3' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const firstRes = await app.request('/settings/opencode-discover-models?baseUrl=http://localhost:5678&refresh=true')
    const firstData = (await firstRes.json()) as { models: string[]; cached: boolean }
    expect(firstData.models).toEqual(['llama-3'])
    expect(firstData.cached).toBe(false)

    const secondRes = await app.request('/settings/opencode-discover-models?baseUrl=http://localhost:5678')
    const secondData = (await secondRes.json()) as { models: string[]; cached: boolean }
    expect(secondData.models).toEqual(['llama-3'])
    expect(secondData.cached).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('returns empty models when endpoint is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('connection refused'))

    const res = await app.request('/settings/opencode-discover-models?baseUrl=http://localhost:9999&refresh=true')
    expect(res.status).toBe(200)
    const data = (await res.json()) as { models: string[] }
    expect(data.models).toEqual([])
  })
})

describe('settings routes — restart coordinator wiring', () => {
  let db: Database
  let app: Hono

  beforeEach(() => {
    db = createTestDb()
  })

  afterEach(() => {
    db.close()
    setOpenCodeRestartCoordinator(null)
  })

  it('GET /opencode-active-sessions returns count and sessions from coordinator', async () => {
    const fakeCoordinator = {
      captureResumableSessions: vi.fn(() => [{
        sessionID: 's1',
        directory: '/a',
      } satisfies ResumableSession]),
      abortSessions: vi.fn(),
      resumeSessions: vi.fn(),
      runWithResume: vi.fn(),
    } as unknown as OpenCodeRestartCoordinator
    setOpenCodeRestartCoordinator(fakeCoordinator)

    app = createTestApp(db)
    const res = await app.request('/settings/opencode-active-sessions')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { count: number; sessions: ResumableSession[] }
    expect(body.count).toBe(1)
    expect(body.sessions).toEqual([{ sessionID: 's1', directory: '/a' }])
    expect(fakeCoordinator.captureResumableSessions).toHaveBeenCalledTimes(1)
  })

  it('GET /opencode-active-sessions returns empty when no coordinator', async () => {
    setOpenCodeRestartCoordinator(null)
    app = createTestApp(db)
    const res = await app.request('/settings/opencode-active-sessions')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { count: number; sessions: ResumableSession[] }
    expect(body.count).toBe(0)
    expect(body.sessions).toEqual([])
  })

  it('POST /opencode-restart routes through coordinator.runWithResume and returns resumedSessions', async () => {
    const runWithResume = vi.fn().mockResolvedValue({ healthy: true, resumedSessionIDs: ['s1'] })
    const fakeCoordinator = {
      captureResumableSessions: vi.fn(() => []),
      abortSessions: vi.fn(),
      resumeSessions: vi.fn(),
      runWithResume,
    } as unknown as OpenCodeRestartCoordinator
    setOpenCodeRestartCoordinator(fakeCoordinator)

    app = createTestApp(db)
    const res = await app.request('/settings/opencode-restart', { method: 'POST' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { success: boolean; resumedSessions: string[] }
    expect(body.success).toBe(true)
    expect(body.resumedSessions).toEqual(['s1'])
    expect(runWithResume).toHaveBeenCalledTimes(1)
  })
})
