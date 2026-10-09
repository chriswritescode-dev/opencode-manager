import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import type { Repo } from '@opencode-manager/shared/types'
import { createRepoTerminalRoutes } from '../../src/routes/repo-terminals'
import { TerminalNotFoundError } from '../../src/services/terminal'
import type { TerminalService } from '../../src/services/terminal'
import type { GitAuthService } from '../../src/services/git-auth'
import type { OpenCodeClient } from '../../src/services/opencode/client'
import { createStubOpenCodeClient } from '../helpers/stub-opencode-client'

vi.mock('../../src/services/repo', () => ({
  resolveRepoOrAssistant: vi.fn(),
  resolveRepoWorkingDirectory: vi.fn(),
  listRepoSiblings: vi.fn(),
}))

import { resolveRepoOrAssistant, resolveRepoWorkingDirectory, listRepoSiblings } from '../../src/services/repo'

const database = {} as Database
const gitAuthService = { getGitEnvironment: vi.fn(() => ({})) } as unknown as GitAuthService
const openCodeClient: OpenCodeClient = createStubOpenCodeClient()

const readyRepo = { id: 1, fullPath: '/tmp/repo', cloneStatus: 'ready' } as Repo
const assistantRepo = { id: 0, fullPath: '/tmp/repo', cloneStatus: 'ready' } as Repo

const shellTerminal = {
  id: 'pty-1',
  title: 'Terminal',
  kind: 'shell',
  cwd: '/tmp/repo',
  status: 'running',
} as const

function createService(overrides: Partial<TerminalService> = {}): TerminalService {
  return {
    list: vi.fn(async () => []),
    create: vi.fn(async () => shellTerminal),
    requireTerminal: vi.fn(async () => shellTerminal),
    resize: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    removeAll: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as TerminalService
}

function createApp(service: TerminalService): Hono {
  const app = new Hono()
  app.route('/', createRepoTerminalRoutes(database, gitAuthService, openCodeClient, service))
  return app
}

const jsonHeaders = { 'Content-Type': 'application/json' }

describe('Repo Terminal Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(resolveRepoOrAssistant).mockImplementation((_db, id) =>
      id === 1 ? readyRepo : id === 0 ? assistantRepo : null,
    )
    vi.mocked(resolveRepoWorkingDirectory).mockImplementation(async (_repo, directory) => {
      if (directory === undefined || directory === '/tmp/repo') return '/tmp/repo'
      return null
    })
    vi.mocked(listRepoSiblings).mockResolvedValue([])
  })

  describe('GET /:id/terminals', () => {
    it('returns the terminals for the resolved directory', async () => {
      const terminals = [{ ...shellTerminal }]
      const list = vi.fn(async () => terminals)
      const res = await createApp(createService({ list })).request('/1/terminals')

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ terminals })
      expect(list).toHaveBeenCalledWith('/tmp/repo')
    })

    it('returns 400 for a non-numeric repo id', async () => {
      const res = await createApp(createService()).request('/abc/terminals')
      expect(res.status).toBe(400)
    })

    it('resolves the assistant repo when assistant access is allowed', async () => {
      const terminals = [{ ...shellTerminal }]
      const list = vi.fn(async () => terminals)
      const res = await createApp(createService({ list })).request('/0/terminals')

      expect(res.status).toBe(200)
      expect(list).toHaveBeenCalledWith('/tmp/repo')
    })

    it('returns 404 for an unknown repo', async () => {
      vi.mocked(resolveRepoOrAssistant).mockReturnValue(null)
      const res = await createApp(createService()).request('/2/terminals')

      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ error: 'Repo not found' })
    })

    it('returns 400 for a foreign directory', async () => {
      const res = await createApp(createService()).request('/1/terminals?directory=/tmp/other')

      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'Directory is not part of this repository' })
    })

    it('returns 502 when the terminal service fails', async () => {
      const list = vi.fn(async () => {
        throw Object.assign(new Error('upstream failed'), { _tag: 'UnknownError' })
      })
      const res = await createApp(createService({ list })).request('/1/terminals')

      expect(res.status).toBe(502)
    })
  })

  describe('POST /:id/terminals', () => {
    it('creates a shell with the default name', async () => {
      const create = vi.fn(async () => shellTerminal)
      const res = await createApp(createService({ create })).request('/1/terminals', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({}),
      })

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual(shellTerminal)
      expect(create).toHaveBeenCalledWith('/tmp/repo', { kind: 'shell', name: 'Terminal' })
    })

    it('creates a shell with the requested title and directory', async () => {
      const create = vi.fn(async () => shellTerminal)
      const res = await createApp(createService({ create })).request('/1/terminals', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ directory: '/tmp/repo', title: 'My shell' }),
      })

      expect(res.status).toBe(200)
      expect(create).toHaveBeenCalledWith('/tmp/repo', { kind: 'shell', name: 'My shell' })
    })

    it('returns 400 for an invalid body', async () => {
      const create = vi.fn(async () => shellTerminal)
      const res = await createApp(createService({ create })).request('/1/terminals', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ title: 'a'.repeat(81) }),
      })

      expect(res.status).toBe(400)
      expect(create).not.toHaveBeenCalled()
    })

    it('returns 404 for an unknown repo', async () => {
      vi.mocked(resolveRepoOrAssistant).mockReturnValue(null)
      const res = await createApp(createService()).request('/2/terminals', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({}),
      })

      expect(res.status).toBe(404)
    })
  })

  describe('PATCH /:id/terminals/:ptyID', () => {
    it('resizes a known terminal', async () => {
      const requireTerminal = vi.fn(async () => shellTerminal)
      const resize = vi.fn(async () => undefined)
      const res = await createApp(createService({ requireTerminal, resize })).request('/1/terminals/pty-1', {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({ directory: '/tmp/repo', cols: 80, rows: 24 }),
      })

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ success: true })
      expect(requireTerminal).toHaveBeenCalledWith('/tmp/repo', 'pty-1')
      expect(resize).toHaveBeenCalledWith('/tmp/repo', 'pty-1', { cols: 80, rows: 24 })
    })

    it('returns 400 for invalid resize bounds', async () => {
      const requireTerminal = vi.fn(async () => shellTerminal)
      const app = createApp(createService({ requireTerminal }))

      for (const body of ['{"cols":0,"rows":24}', '{"cols":80}', '{"cols":80,"rows":501}', '{"cols":1.5,"rows":24}']) {
        const res = await app.request('/1/terminals/pty-1', { method: 'PATCH', headers: jsonHeaders, body })
        expect(res.status).toBe(400)
      }

      expect(requireTerminal).not.toHaveBeenCalled()
    })

    it('returns 404 for an unknown PTY id', async () => {
      const requireTerminal = vi.fn(async () => {
        throw new TerminalNotFoundError('missing')
      })
      const res = await createApp(createService({ requireTerminal })).request('/1/terminals/missing', {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({ cols: 80, rows: 24 }),
      })

      expect(res.status).toBe(404)
    })

    it('returns 400 for a foreign directory', async () => {
      const res = await createApp(createService()).request('/1/terminals/pty-1', {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({ directory: '/tmp/other', cols: 80, rows: 24 }),
      })

      expect(res.status).toBe(400)
    })
  })

  describe('DELETE /:id/terminals/:ptyID', () => {
    it('removes a known terminal', async () => {
      const requireTerminal = vi.fn(async () => shellTerminal)
      const remove = vi.fn(async () => undefined)
      const res = await createApp(createService({ requireTerminal, remove })).request('/1/terminals/pty-1?directory=/tmp/repo', {
        method: 'DELETE',
      })

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ success: true })
      expect(requireTerminal).toHaveBeenCalledWith('/tmp/repo', 'pty-1')
      expect(remove).toHaveBeenCalledWith('/tmp/repo', 'pty-1')
    })

    it('returns 404 for an unknown PTY id', async () => {
      const requireTerminal = vi.fn(async () => {
        throw new TerminalNotFoundError('missing')
      })
      const res = await createApp(createService({ requireTerminal })).request('/1/terminals/missing', {
        method: 'DELETE',
      })

      expect(res.status).toBe(404)
    })
  })
})
