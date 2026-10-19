import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'
import { LOCAL_OPENCODE_SERVER_ID } from '@opencode-manager/shared/schemas'
import {
  createOpenCodeServerTerminalRoutes,
  type ServerTerminalServiceResolver,
} from '../../src/routes/opencode-server-terminals'
import { TerminalService } from '../../src/services/terminal'
import { OpenCodeServerNotFoundError } from '../../src/services/opencode-server-registry'
import type { OpenCodeClient } from '../../src/services/opencode/client'
import type { CredentialProvider } from '../../src/services/credential-provider'

const DIRECTORY = '/home/me/app'
const SERVER_ID = 'srv_kitchen'
const UNKNOWN_SERVER_ID = 'srv_missing'
const jsonHeaders = { 'Content-Type': 'application/json' }

function createPty(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pty-1',
    title: 'Terminal',
    command: 'sh',
    args: [],
    cwd: DIRECTORY,
    status: 'running' as const,
    pid: 1,
    ...overrides,
  }
}

function createRemoteClient(terminals: Array<Record<string, unknown>> = [createPty()]) {
  const list = vi.fn(async ({ location }: { location: { directory: string } }) => ({
    location,
    data: terminals,
  }))
  const create = vi.fn(async (input: { location: { directory: string }; title: string; env: Record<string, string> }) => ({
    location: input.location,
    data: createPty({ id: 'pty-new', title: input.title }),
  }))
  const update = vi.fn(async () => ({ location: { directory: DIRECTORY }, data: createPty() }))
  const remove = vi.fn(async () => undefined)
  const client = { api: { pty: { list, create, update, remove } } } as unknown as OpenCodeClient
  return { client, list, create, update, remove }
}

function createService(includeLocalCredentials = false, terminals?: Array<Record<string, unknown>>) {
  const remote = createRemoteClient(terminals)
  const credentialProvider = {
    getGhCliEnv: vi.fn(() => ({ GH_TOKEN: 'local-token' })),
  } as unknown as CredentialProvider
  const service = new TerminalService(
    { client: remote.client, baseUrl: () => 'https://remote.internal', includeLocalCredentials },
    credentialProvider,
  )
  return { service, credentialProvider, ...remote }
}

function createResolver(service: TerminalService): ServerTerminalServiceResolver {
  return (serverId) => {
    if (serverId === UNKNOWN_SERVER_ID) throw new OpenCodeServerNotFoundError(serverId)
    return service
  }
}

function createApp(service: TerminalService): Hono {
  const app = new Hono()
  app.route('/', createOpenCodeServerTerminalRoutes(createResolver(service)))
  return app
}

describe('OpenCode Server Terminal Routes', () => {
  describe('GET /:serverId/terminals', () => {
    it('lists the terminals of the remote directory', async () => {
      const { service, list } = createService()
      const res = await createApp(service).request(
        `/${SERVER_ID}/terminals?directory=${encodeURIComponent(DIRECTORY)}`,
      )

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({
        terminals: [{ id: 'pty-1', title: 'Terminal', kind: 'shell', cwd: DIRECTORY, status: 'running' }],
      })
      expect(list).toHaveBeenCalledWith({ location: { directory: DIRECTORY } })
    })

    it('rejects the local server', async () => {
      const { service } = createService()
      const res = await createApp(service).request(
        `/${LOCAL_OPENCODE_SERVER_ID}/terminals?directory=${encodeURIComponent(DIRECTORY)}`,
      )

      expect(res.status).toBe(400)
    })

    it('returns 404 for an unknown server', async () => {
      const { service } = createService()
      const res = await createApp(service).request(
        `/${UNKNOWN_SERVER_ID}/terminals?directory=${encodeURIComponent(DIRECTORY)}`,
      )

      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ error: `OpenCode server not found: ${UNKNOWN_SERVER_ID}` })
    })

    it('requires an absolute directory', async () => {
      const { service } = createService()
      const app = createApp(service)

      for (const path of [`/${SERVER_ID}/terminals`, `/${SERVER_ID}/terminals?directory=relative/path`]) {
        const res = await app.request(path)
        expect(res.status).toBe(400)
      }
    })
  })

  describe('POST /:serverId/terminals', () => {
    it('creates a shell without local credentials', async () => {
      const { service, create, credentialProvider } = createService()
      const res = await createApp(service).request(`/${SERVER_ID}/terminals`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ directory: DIRECTORY, title: 'Remote shell' }),
      })

      expect(res.status).toBe(200)
      expect(credentialProvider.getGhCliEnv).not.toHaveBeenCalled()
      expect(create).toHaveBeenCalledWith({
        location: { directory: DIRECTORY },
        title: 'Remote shell',
        env: {},
      })
      expect(await res.json()).toEqual({
        id: 'pty-new',
        title: 'Remote shell',
        kind: 'shell',
        cwd: DIRECTORY,
        status: 'running',
      })
    })

    it('defaults the title and rejects a missing directory', async () => {
      const { service, create } = createService()
      const app = createApp(service)

      const created = await app.request(`/${SERVER_ID}/terminals`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ directory: DIRECTORY }),
      })
      expect(created.status).toBe(200)
      expect(create).toHaveBeenCalledWith(expect.objectContaining({ title: 'Terminal' }))

      const missing = await app.request(`/${SERVER_ID}/terminals`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({}),
      })
      expect(missing.status).toBe(400)
    })
  })

  describe('PATCH /:serverId/terminals/:ptyID', () => {
    it('resizes a terminal of the remote server', async () => {
      const { service, update } = createService()
      const res = await createApp(service).request(`/${SERVER_ID}/terminals/pty-1`, {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({ directory: DIRECTORY, cols: 120, rows: 40 }),
      })

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ success: true })
      expect(update).toHaveBeenCalledWith({
        ptyID: 'pty-1',
        location: { directory: DIRECTORY },
        size: { cols: 120, rows: 40 },
      })
    })

    it('returns 404 for an unknown PTY id', async () => {
      const { service } = createService(false, [])
      const res = await createApp(service).request(`/${SERVER_ID}/terminals/missing`, {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({ directory: DIRECTORY, cols: 80, rows: 24 }),
      })

      expect(res.status).toBe(404)
    })
  })

  describe('DELETE /:serverId/terminals/:ptyID', () => {
    it('removes a terminal of the remote server', async () => {
      const { service, remove } = createService()
      const res = await createApp(service).request(
        `/${SERVER_ID}/terminals/pty-1?directory=${encodeURIComponent(DIRECTORY)}`,
        { method: 'DELETE' },
      )

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ success: true })
      expect(remove).toHaveBeenCalledWith({ ptyID: 'pty-1', location: { directory: DIRECTORY } })
    })

    it('returns 404 for an unknown PTY id', async () => {
      const { service } = createService(false, [])
      const res = await createApp(service).request(
        `/${SERVER_ID}/terminals/missing?directory=${encodeURIComponent(DIRECTORY)}`,
        { method: 'DELETE' },
      )

      expect(res.status).toBe(404)
    })
  })
})
