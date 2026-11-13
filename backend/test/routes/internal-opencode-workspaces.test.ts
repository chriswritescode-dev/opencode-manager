import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { z } from 'zod'
import { getOrCreateInternalToken } from '../../src/services/internal-token'
import { createInternalTestApp } from '../helpers/internal-test-app'
import { createTestDatabase, seedRepo } from '../helpers/test-database'
import { readJson } from '../helpers/read-json'

const WorkspaceSchema = z.object({
  repoId: z.number(),
  name: z.string(),
  branch: z.string().nullable(),
  cloneStatus: z.string(),
  directory: z.string(),
  originUrl: z.string().nullable(),
  projectId: z.string().nullable(),
  isWorktree: z.boolean(),
  extra: z.object({
    repoId: z.number(),
    localPath: z.string(),
    fullPath: z.string(),
  }),
})

const WorkspacesResponseSchema = z.object({ workspaces: z.array(WorkspaceSchema) })

describe('internal-opencode-workspaces routes', () => {
  let db: ReturnType<typeof createTestDatabase>
  let app: Hono
  let token: string

  function authHeaders() {
    return { authorization: `Bearer ${token}` }
  }

  beforeEach(() => {
    db = createTestDatabase()
    token = getOrCreateInternalToken(db)
    app = new Hono()
    app.route('/api/internal', createInternalTestApp(db))
  })

  afterEach(() => {
    db.close()
  })

  it('GET /api/internal/opencode-workspaces returns 401 without bearer token', async () => {
    const res = await app.request('/api/internal/opencode-workspaces')

    expect(res.status).toBe(401)
  })

  it('GET /api/internal/opencode-workspaces only returns ready repos', async () => {
    seedRepo(db, { localPath: 'ready-repo', cloneStatus: 'ready' })
    seedRepo(db, { localPath: 'cloning-repo', cloneStatus: 'cloning' })
    seedRepo(db, { localPath: 'error-repo', cloneStatus: 'error' })

    const res = await app.request('/api/internal/opencode-workspaces', { headers: authHeaders() })
    const body = await readJson(res, WorkspacesResponseSchema)

    expect(res.status).toBe(200)
    expect(body.workspaces.map((workspace) => workspace.cloneStatus)).toEqual(['ready'])
    expect(body.workspaces[0]?.repoId).toBeGreaterThan(0)
  })

  it('GET /api/internal/opencode-workspaces returns the workspace structure', async () => {
    const repo = seedRepo(db, { localPath: 'test-repo', cloneStatus: 'ready' })
    const worktree = seedRepo(db, { localPath: 'worktree-repo', cloneStatus: 'ready', isWorktree: true })

    const res = await app.request('/api/internal/opencode-workspaces', { headers: authHeaders() })
    const body = await readJson(res, WorkspacesResponseSchema)

    expect(res.status).toBe(200)
    expect(body.workspaces).toHaveLength(2)

    const workspace = body.workspaces.find((entry) => entry.repoId === repo.id)
    expect(workspace).toEqual({
      repoId: repo.id,
      name: 'test-repo',
      branch: null,
      cloneStatus: 'ready',
      directory: repo.fullPath,
      originUrl: null,
      projectId: null,
      isWorktree: false,
      extra: { repoId: repo.id, localPath: 'test-repo', fullPath: repo.fullPath },
    })

    const worktreeWorkspace = body.workspaces.find((entry) => entry.repoId === worktree.id)
    expect(worktreeWorkspace?.isWorktree).toBe(true)
    expect(worktreeWorkspace?.directory).toBe(worktree.fullPath)
  })
})
