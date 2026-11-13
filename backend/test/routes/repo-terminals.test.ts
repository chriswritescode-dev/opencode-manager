import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { Hono } from 'hono'
import { z } from 'zod'
import { TerminalInfoSchema } from '@opencode-manager/shared/schemas'
import type { OpenCodeApi } from '@opencode-manager/shared/opencode'
import type { Database } from 'bun:sqlite'
import { createRepoTerminalRoutes } from '../../src/routes/repo-terminals'
import { TerminalService } from '../../src/services/terminal'
import { CredentialProvider } from '../../src/services/credential-provider'
import { createStubOpenCodeClient } from '../helpers/stub-opencode-client'
import { createStubRepoEnvService } from '../helpers/stub-repo-env-service'
import { createGitAuthService } from '../helpers/git-fixtures'
import { readJson } from '../helpers/read-json'
import { createTestDatabase, seedRepo } from '../helpers/test-database'
import { createTempWorkspace, type TempWorkspace } from '../helpers/test-env'

type PtyInfo = Awaited<ReturnType<OpenCodeApi['pty']['list']>>['data'][number]
type PtyApiOverrides = Partial<OpenCodeApi['pty']>

const TerminalsEnvelopeSchema = z.object({ terminals: z.array(TerminalInfoSchema) })
const ErrorEnvelopeSchema = z.object({ error: z.string() })
const SuccessEnvelopeSchema = z.object({ success: z.boolean() })

const jsonHeaders = { 'Content-Type': 'application/json' }

function buildPty(overrides: Partial<PtyInfo> = {}): PtyInfo {
  return {
    id: 'pty-1',
    title: 'Terminal',
    command: '/bin/sh',
    args: [],
    cwd: '/repo',
    status: 'running',
    pid: 4242,
    ...overrides,
  }
}

describe('repo terminal routes', () => {
  let workspace: TempWorkspace
  let db: Database
  let repoFullPath: string
  let repoId = 0
  let foreignDirectory: string

  function createApp(ptyOverrides: PtyApiOverrides = {}): Hono {
    const client = createStubOpenCodeClient({
      api: {
        pty: {
          list: async (input) => ({ location: { directory: input?.location?.directory ?? '/repo' }, data: [buildPty()] }),
          create: async (input) => ({ location: { directory: input?.location?.directory ?? '/repo' }, data: buildPty({ title: input?.title ?? 'Terminal' }) }),
          update: async (input) => ({ location: { directory: input?.location?.directory ?? '/repo' }, data: buildPty() }),
          remove: async () => undefined,
          ...ptyOverrides,
        },
      },
    })
    const service = new TerminalService(
      { client, baseUrl: () => 'http://127.0.0.1:5551', includeLocalEnv: false },
      new CredentialProvider(db),
      createStubRepoEnvService(),
    )
    const app = new Hono()
    app.route('/', createRepoTerminalRoutes(db, createGitAuthService(), client, service))
    return app
  }

  beforeEach(() => {
    workspace = createTempWorkspace('ocm-terminal-routes-')
    db = createTestDatabase()
    const repo = seedRepo(db, { localPath: 'repo' })
    repoId = repo.id
    repoFullPath = repo.fullPath
    mkdirSync(repoFullPath, { recursive: true })
    foreignDirectory = path.join(workspace.path, 'other')
    mkdirSync(foreignDirectory, { recursive: true })
  })

  afterEach(() => {
    db.close()
    workspace.restore()
  })

  describe('GET /:id/terminals', () => {
    it('returns the terminals for the resolved directory', async () => {
      const res = await createApp().request(`/${repoId}/terminals`)
      const body = await readJson(res, TerminalsEnvelopeSchema)

      expect(res.status).toBe(200)
      expect(body.terminals).toEqual([{ id: 'pty-1', title: 'Terminal', kind: 'shell', cwd: '/repo', status: 'running' }])
    })

    it('returns 400 for a non-numeric repo id', async () => {
      const res = await createApp().request('/abc/terminals')
      expect(res.status).toBe(400)
    })

    it('resolves the assistant repo when assistant access is allowed', async () => {
      const res = await createApp().request('/0/terminals')
      const body = await readJson(res, TerminalsEnvelopeSchema)

      expect(res.status).toBe(200)
      expect(body.terminals).toHaveLength(1)
    })

    it('returns 404 for an unknown repo', async () => {
      const res = await createApp().request('/999/terminals')
      const body = await readJson(res, ErrorEnvelopeSchema)

      expect(res.status).toBe(404)
      expect(body.error).toBe('Repo not found')
    })

    it('returns 400 for a foreign directory', async () => {
      const res = await createApp().request(`/${repoId}/terminals?directory=${encodeURIComponent(foreignDirectory)}`)
      const body = await readJson(res, ErrorEnvelopeSchema)

      expect(res.status).toBe(400)
      expect(body.error).toBe('Directory is not part of this repository')
    })

    it('returns 502 when the terminal service fails', async () => {
      const res = await createApp({
        list: async () => {
          throw Object.assign(new Error('upstream failed'), { _tag: 'UnknownError' })
        },
      }).request(`/${repoId}/terminals`)

      expect(res.status).toBe(502)
    })
  })

  describe('POST /:id/terminals', () => {
    it('creates a shell with the default name', async () => {
      const res = await createApp().request(`/${repoId}/terminals`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({}),
      })
      const body = await readJson(res, TerminalInfoSchema)

      expect(res.status).toBe(200)
      expect(body).toMatchObject({ id: 'pty-1', title: 'Terminal', kind: 'shell' })
    })

    it('creates a shell with the requested title', async () => {
      const res = await createApp().request(`/${repoId}/terminals`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ title: 'My shell' }),
      })
      const body = await readJson(res, TerminalInfoSchema)

      expect(res.status).toBe(200)
      expect(body.title).toBe('My shell')
    })

    it('returns 400 for an invalid body', async () => {
      const res = await createApp().request(`/${repoId}/terminals`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ title: 'a'.repeat(81) }),
      })

      expect(res.status).toBe(400)
    })

    it('returns 404 for an unknown repo', async () => {
      const res = await createApp().request('/999/terminals', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({}),
      })

      expect(res.status).toBe(404)
    })
  })

  describe('PATCH /:id/terminals/:ptyID', () => {
    it('resizes a known terminal', async () => {
      let receivedSize: { cols: number; rows: number } | null = null
      const res = await createApp({
        update: async (input) => {
          receivedSize = { cols: input?.size?.cols ?? 0, rows: input?.size?.rows ?? 0 }
          return { location: { directory: input?.location?.directory ?? '/repo' }, data: buildPty() }
        },
      }).request(`/${repoId}/terminals/pty-1`, {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({ directory: repoFullPath, cols: 80, rows: 24 }),
      })
      const body = await readJson(res, SuccessEnvelopeSchema)

      expect(res.status).toBe(200)
      expect(body.success).toBe(true)
      expect(receivedSize).toEqual({ cols: 80, rows: 24 })
    })

    it('returns 400 for invalid resize bounds', async () => {
      const app = createApp()

      for (const body of ['{"cols":0,"rows":24}', '{"cols":80}', '{"cols":80,"rows":501}', '{"cols":1.5,"rows":24}']) {
        const res = await app.request(`/${repoId}/terminals/pty-1`, { method: 'PATCH', headers: jsonHeaders, body })
        expect(res.status).toBe(400)
      }
    })

    it('returns 404 for an unknown PTY id', async () => {
      const res = await createApp({ list: async (input) => ({ location: { directory: input?.location?.directory ?? '/repo' }, data: [] }) })
        .request(`/${repoId}/terminals/missing`, {
          method: 'PATCH',
          headers: jsonHeaders,
          body: JSON.stringify({ cols: 80, rows: 24 }),
        })

      expect(res.status).toBe(404)
    })

    it('returns 400 for a foreign directory', async () => {
      const res = await createApp().request(`/${repoId}/terminals/pty-1`, {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({ directory: foreignDirectory, cols: 80, rows: 24 }),
      })

      expect(res.status).toBe(400)
    })
  })

  describe('DELETE /:id/terminals/:ptyID', () => {
    it('removes a known terminal', async () => {
      let removedPtyId = ''
      const res = await createApp({
        remove: async (input) => {
          removedPtyId = input.ptyID
        },
      }).request(`/${repoId}/terminals/pty-1?directory=${encodeURIComponent(repoFullPath)}`, { method: 'DELETE' })
      const body = await readJson(res, SuccessEnvelopeSchema)

      expect(res.status).toBe(200)
      expect(body.success).toBe(true)
      expect(removedPtyId).toBe('pty-1')
    })

    it('returns 404 for an unknown PTY id', async () => {
      const res = await createApp({ list: async (input) => ({ location: { directory: input?.location?.directory ?? '/repo' }, data: [] }) })
        .request(`/${repoId}/terminals/missing`, { method: 'DELETE' })

      expect(res.status).toBe(404)
    })
  })
})
