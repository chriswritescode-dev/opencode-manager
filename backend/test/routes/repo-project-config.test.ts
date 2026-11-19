import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import { z } from 'zod'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Database } from 'bun:sqlite'
import type { OpenCodeApi } from '@opencode-manager/shared/opencode'
import { ProjectConfigResponseSchema, RepoProjectFileSchema, TerminalInfoSchema } from '@opencode-manager/shared/schemas'
import { createRepoProjectConfigRoutes } from '../../src/routes/repo-project-config'
import { ProjectConfigService } from '../../src/services/project-config'
import { createGitService } from '../../src/services/git/GitService'
import { TerminalService } from '../../src/services/terminal'
import { CredentialProvider } from '../../src/services/credential-provider'
import { createStubOpenCodeClient } from '../helpers/stub-opencode-client'
import { createStubRepoEnvService } from '../helpers/stub-repo-env-service'
import { createGitAuthService } from '../helpers/git-fixtures'
import { readJson } from '../helpers/read-json'
import { createTestDatabase, seedRepo } from '../helpers/test-database'
import { createTempWorkspace, type TempWorkspace } from '../helpers/test-env'

type PtyInfo = Awaited<ReturnType<OpenCodeApi['pty']['list']>>['data'][number]
type PtyCreateInput = Parameters<OpenCodeApi['pty']['create']>[0]

const ErrorEnvelopeSchema = z.object({ error: z.string() })
const CodedErrorSchema = z.object({
  error: z.string(),
  code: z.string(),
  details: z.object({ hash: z.string().nullable() }),
})
const RunActionResponseSchema = z.object({
  terminal: TerminalInfoSchema,
  alreadyRunning: z.boolean(),
  autoOpenUrl: z.boolean(),
  resolvedUrl: z.string().optional(),
})

type RepoProjectFileFixture = z.input<typeof RepoProjectFileSchema>

const jsonHeaders = { 'Content-Type': 'application/json' }
const UNTRUSTED_HASH = 'a'.repeat(64)

function buildPty(id: string, cwd: string): PtyInfo {
  return { id, title: 'Terminal', command: '/bin/sh', args: [], cwd, status: 'running', pid: 1 }
}

describe('repo project config routes', () => {
  let workspace: TempWorkspace
  let db: Database
  let repoId = 0
  let repoPath = ''
  let app: Hono
  let createdTerminal: PtyCreateInput | undefined

  function writeRepoProjectFile(directory: string, content: RepoProjectFileFixture): void {
    const configDir = path.join(directory, '.ocm')
    mkdirSync(configDir, { recursive: true })
    writeFileSync(path.join(configDir, 'project.json'), JSON.stringify(content))
  }

  beforeEach(() => {
    workspace = createTempWorkspace('ocm-project-config-routes-')
    db = createTestDatabase()
    const repo = seedRepo(db, { localPath: 'repo-a' })
    repoId = repo.id
    repoPath = repo.fullPath
    mkdirSync(repoPath, { recursive: true })
    createdTerminal = undefined

    const gitAuthService = createGitAuthService()
    const openCodeClient = createStubOpenCodeClient({
      api: {
        pty: {
          list: async (input) => ({ location: { directory: input?.location?.directory ?? '' }, data: [] }),
          create: vi.fn(async (input) => {
            createdTerminal = input
            const directory = input?.location?.directory ?? ''
            return {
              location: { directory },
              data: { ...buildPty('pty-1', directory), title: input?.title ?? 'Terminal' },
            }
          }),
        },
      },
    })
    const terminalService = new TerminalService(
      { client: openCodeClient, baseUrl: () => 'http://127.0.0.1:5551', includeLocalEnv: false },
      new CredentialProvider(db),
      createStubRepoEnvService(),
    )
    const projectConfigService = new ProjectConfigService(db, createGitService(gitAuthService), gitAuthService)
    app = new Hono()
    app.route('/', createRepoProjectConfigRoutes(db, gitAuthService, openCodeClient, projectConfigService, terminalService))
  })

  afterEach(() => {
    db.close()
    workspace.restore()
  })

  it('returns personal config for a ready repo', async () => {
    const res = await app.request(`/${repoId}/project-config`)
    const body = await readJson(res, ProjectConfigResponseSchema)

    expect(res.status).toBe(200)
    expect(body.actions).toEqual([])
    expect(body.worktreeSetup).toEqual([])
    expect(body.repoFile).toEqual({
      path: '.ocm/project.json',
      exists: false,
      trusted: false,
      hash: null,
      executable: null,
      warnings: [],
    })
  })

  it('returns 404 for an unknown repo', async () => {
    const res = await app.request('/999/project-config')
    const body = await readJson(res, ErrorEnvelopeSchema)

    expect(res.status).toBe(404)
    expect(body.error).toBe('Repo not found')
  })

  it('rejects the assistant repo id when assistant access is not allowed', async () => {
    const res = await app.request('/0/project-config')
    const body = await readJson(res, ErrorEnvelopeSchema)

    expect(res.status).toBe(404)
    expect(body.error).toBe('Repo not found')
  })

  it('returns 404 for a repo that is not ready', async () => {
    const cloning = seedRepo(db, { localPath: 'repo-cloning', cloneStatus: 'cloning' })

    const res = await app.request(`/${cloning.id}/project-config`)

    expect(res.status).toBe(404)
  })

  it('returns 400 for a non-numeric repo id', async () => {
    const res = await app.request('/abc/project-config')

    expect(res.status).toBe(400)
  })

  it('round-trips personal actions with the personal source', async () => {
    const action = { id: 'serve', name: 'Serve', command: 'pnpm dev', autoOpenUrl: false }

    const put = await app.request(`/${repoId}/project-config/actions`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ actions: [action] }),
    })
    const putBody = await readJson(put, ProjectConfigResponseSchema)
    expect(put.status).toBe(200)
    expect(putBody.actions).toEqual([{ ...action, source: 'personal' }])

    const get = await app.request(`/${repoId}/project-config`)
    const getBody = await readJson(get, ProjectConfigResponseSchema)
    expect(get.status).toBe(200)
    expect(getBody.actions).toEqual([{ ...action, source: 'personal' }])
  })

  it('round-trips personal worktree setup commands', async () => {
    const expected = [
      { command: 'pnpm install', source: 'personal' },
      { command: 'pnpm build', source: 'personal' },
    ]

    const put = await app.request(`/${repoId}/project-config/worktree-setup`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ commands: ['pnpm install', 'pnpm build'] }),
    })
    const putBody = await readJson(put, ProjectConfigResponseSchema)
    expect(put.status).toBe(200)
    expect(putBody.worktreeSetup).toEqual(expected)

    const get = await app.request(`/${repoId}/project-config`)
    const getBody = await readJson(get, ProjectConfigResponseSchema)
    expect(getBody.worktreeSetup).toEqual(expected)
  })

  it('returns 400 for schema violations on actions', async () => {
    const bodies = [
      '{}',
      JSON.stringify({ actions: 'nope' }),
      JSON.stringify({ actions: [{ id: 'has space', name: 'Serve', command: 'pnpm dev' }] }),
      JSON.stringify({ actions: [{ id: 'serve', name: '', command: 'pnpm dev' }] }),
      JSON.stringify({ actions: [{ id: 'serve', name: 'Serve', command: 'pnpm dev', icon: 'unknown' }] }),
    ]

    for (const body of bodies) {
      const res = await app.request(`/${repoId}/project-config/actions`, { method: 'PUT', headers: jsonHeaders, body })
      expect(res.status).toBe(400)
    }
  })

  it('returns 400 for schema violations on worktree setup', async () => {
    const bodies = ['{}', JSON.stringify({ commands: 'nope' }), JSON.stringify({ commands: [''] })]

    for (const body of bodies) {
      const res = await app.request(`/${repoId}/project-config/worktree-setup`, { method: 'PUT', headers: jsonHeaders, body })
      expect(res.status).toBe(400)
    }
  })

  it('returns 400 for a foreign directory', async () => {
    const res = await app.request(`/${repoId}/project-config?directory=/tmp/other`)
    const body = await readJson(res, ErrorEnvelopeSchema)

    expect(res.status).toBe(400)
    expect(body.error).toBe('Directory is not part of this repository')
  })

  it('returns 400 for an invalid trust request', async () => {
    const res = await app.request(`/${repoId}/project-config/trust`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ hash: 'not-a-hash' }),
    })

    expect(res.status).toBe(400)
  })

  it('returns 409 when trusting a stale hash', async () => {
    const res = await app.request(`/${repoId}/project-config/trust`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ hash: UNTRUSTED_HASH }),
    })

    expect(res.status).toBe(409)
    const body = await readJson(res, z.object({ code: z.string() }))
    expect(body.code).toBe('REPO_CONFIG_CHANGED')
  })

  it('returns the error code and details for an untrusted repository action', async () => {
    writeRepoProjectFile(repoPath, {
      version: 1,
      projectActions: [{ id: 'repo-serve', name: 'Serve', command: 'pnpm dev' }],
    })

    const res = await app.request(`/${repoId}/project-config/actions/repo-serve/run`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({}),
    })

    expect(res.status).toBe(409)
    const body = await readJson(res, CodedErrorSchema)
    expect(body.code).toBe('REPO_CONFIG_UNTRUSTED')
    expect(body.details.hash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('returns 400 for an invalid move request', async () => {
    const res = await app.request(`/${repoId}/project-config/move`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ kind: 'action', id: 'serve', to: 'nowhere' }),
    })

    expect(res.status).toBe(400)
  })

  it('returns 404 when moving an unknown item', async () => {
    const res = await app.request(`/${repoId}/project-config/move`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ kind: 'action', id: 'missing', to: 'repo' }),
    })

    expect(res.status).toBe(404)
  })

  it('moves a personal action into the repo file and returns it as trusted', async () => {
    const action = { id: 'serve', name: 'Serve', command: 'pnpm dev', autoOpenUrl: false }

    await app.request(`/${repoId}/project-config/actions`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ actions: [action] }),
    })

    const res = await app.request(`/${repoId}/project-config/move`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ kind: 'action', id: 'serve', to: 'repo' }),
    })
    const body = await readJson(res, ProjectConfigResponseSchema)

    expect(res.status).toBe(200)
    expect(body.repoFile.exists).toBe(true)
    expect(body.repoFile.trusted).toBe(true)
    expect(body.actions).toEqual([{ ...action, source: 'repo' }])
  })

  it('returns 409 when moving a setup command into a repository already at capacity', async () => {
    await app.request(`/${repoId}/project-config/worktree-setup`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ commands: ['personal-cmd'] }),
    })
    writeRepoProjectFile(repoPath, {
      version: 1,
      setupWorktree: Array.from({ length: 20 }, (_, index) => `repo-${index}`),
    })

    const res = await app.request(`/${repoId}/project-config/move`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ kind: 'setup', command: 'personal-cmd', to: 'repo' }),
    })
    const body = await readJson(res, z.object({ code: z.string() }))

    expect(res.status).toBe(409)
    expect(body.code).toBe('PROJECT_CONFIG_LIMIT_EXCEEDED')
  })

  it('runs a personal action and returns the response shape', async () => {
    const action = { id: 'serve', name: 'Serve', command: 'pnpm dev', autoOpenUrl: false }

    await app.request(`/${repoId}/project-config/actions`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ actions: [action] }),
    })

    const res = await app.request(`/${repoId}/project-config/actions/serve/run`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({}),
    })
    const body = await readJson(res, RunActionResponseSchema)

    expect(res.status).toBe(200)
    expect(body.alreadyRunning).toBe(false)
    expect(body.autoOpenUrl).toBe(false)
    expect(body.resolvedUrl).toBeUndefined()
    expect(body.terminal).toMatchObject({
      id: 'pty-1',
      title: 'Serve',
      kind: 'action',
      actionId: 'serve',
      status: 'running',
    })
    expect(createdTerminal?.location?.directory).toBe(repoPath)
    expect(createdTerminal?.title).toBe('ocm:action:serve:Serve')
    expect(createdTerminal?.command).toBe('/bin/sh')
    expect(createdTerminal?.args?.slice(-2)).toEqual(['-c', 'pnpm dev'])
  })

  it('returns 404 when running an unknown action', async () => {
    const res = await app.request(`/${repoId}/project-config/actions/missing/run`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({}),
    })

    expect(res.status).toBe(404)
  })
})
