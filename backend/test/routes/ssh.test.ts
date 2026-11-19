import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chmod, mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { z } from 'zod'
import type { Database } from 'bun:sqlite'
import { createSSHRoutes } from '../../src/routes/ssh'
import { GitAuthService } from '../../src/services/git-auth'
import { sseAggregator } from '../../src/services/sse-aggregator'
import { SSHHostKeyHandler } from '../../src/ipc/sshHostKeyHandler'
import { createTestDatabase } from '../helpers/test-database'
import { applyTestEnv, createTempWorkspace, type TempWorkspace } from '../helpers/test-env'
import { readJson } from '../helpers/read-json'

const RespondResponseSchema = z.object({ success: z.boolean(), error: z.string().optional() })
const StatusResponseSchema = z.object({
  success: z.boolean(),
  pendingCount: z.number().optional(),
  error: z.string().optional(),
})
const HostKeyRequestEventSchema = z.object({
  payload: z.object({
    properties: z.object({ requestId: z.string() }),
  }),
})

const PUBLIC_KEY = 'example.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITESTKEY'
const REPO_URL = 'git@example.com:repo.git'

describe('SSH routes', () => {
  let workspace: TempWorkspace
  let restorePath: () => void
  let db: Database
  let handler: SSHHostKeyHandler
  let gitAuthService: GitAuthService
  let app: ReturnType<typeof createSSHRoutes>

  function captureHostKeyRequests() {
    let captured: string | undefined
    const stop = sseAggregator.addClient('ssh-routes-test-capture', (_event, data) => {
      const parsed = HostKeyRequestEventSchema.safeParse(JSON.parse(data))
      if (parsed.success) captured = parsed.data.payload.properties.requestId
    }, () => {}, [])
    return { requestId: () => captured, stop }
  }

  async function createPendingRequest(): Promise<{ requestId: string; decision: Promise<boolean> }> {
    const capture = captureHostKeyRequests()
    const decision = handler.verifyHostKeyBeforeOperation(REPO_URL)
    try {
      await vi.waitFor(() => expect(capture.requestId()).toBeDefined())
    } finally {
      capture.stop()
    }
    const requestId = capture.requestId()
    if (requestId === undefined) throw new Error('expected a broadcast host key request')
    await vi.waitFor(() => expect(handler.getPendingCount()).toBe(1))
    return { requestId, decision }
  }

  function respond(body: Record<string, string>): Promise<Response> {
    return Promise.resolve(app.request('/host-key/respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }))
  }

  async function readKnownHosts(): Promise<string> {
    return readFile(join(workspace.path, 'config', 'known_hosts'), 'utf-8')
  }

  beforeEach(async () => {
    workspace = createTempWorkspace('ssh-routes-test-')
    const binDir = join(workspace.path, 'bin')
    await mkdir(binDir, { recursive: true })
    const keyscanPath = join(binDir, 'ssh-keyscan')
    await writeFile(keyscanPath, `#!/bin/sh\nprintf '${PUBLIC_KEY}\\n'\n`)
    await chmod(keyscanPath, 0o755)
    restorePath = applyTestEnv({ PATH: `${binDir}:${process.env.PATH ?? ''}` })

    db = createTestDatabase()
    handler = new SSHHostKeyHandler(db, 1_000)
    await handler.initialize()
    gitAuthService = new GitAuthService()
    gitAuthService.sshHostKeyHandler = handler
    app = createSSHRoutes(gitAuthService)
  })

  afterEach(() => {
    restorePath()
    db.close()
    workspace.restore()
    vi.restoreAllMocks()
  })

  describe('POST /host-key/respond', () => {
    it.each([
      ['accept', true],
      ['reject', false],
    ] as const)('records a pending request answered with %s', async (response, expectedDecision) => {
      const { requestId, decision } = await createPendingRequest()

      const res = await respond({ requestId, response })

      expect(res.status).toBe(200)
      await expect(readJson(res, RespondResponseSchema)).resolves.toEqual({ success: true })
      await expect(decision).resolves.toBe(expectedDecision)
      expect(handler.getPendingCount()).toBe(0)

      const knownHosts = await readKnownHosts()
      expect(knownHosts.includes(PUBLIC_KEY)).toBe(expectedDecision)
    })

    it('reports an unknown or expired request id', async () => {
      const res = await respond({ requestId: 'expired-123', response: 'accept' })

      expect(res.status).toBe(200)
      await expect(readJson(res, RespondResponseSchema)).resolves.toEqual({
        success: false,
        error: 'Request not found or expired',
      })
    })

    it.each([
      ['a missing requestId', { response: 'accept' }],
      ['a missing response', { requestId: 'test-123' }],
      ['an unknown response value', { requestId: 'test-123', response: 'maybe' }],
    ])('returns 400 for %s', async (_label, body) => {
      const res = await respond(body)

      expect(res.status).toBe(400)
      await expect(readJson(res, RespondResponseSchema)).resolves.toEqual({
        success: false,
        error: 'Invalid request body',
      })
      expect(handler.getPendingCount()).toBe(0)
    })
  })

  describe('GET /host-key/status', () => {
    it('reports zero pending requests', async () => {
      const res = await app.request('/host-key/status')

      expect(res.status).toBe(200)
      await expect(readJson(res, StatusResponseSchema)).resolves.toEqual({ success: true, pendingCount: 0 })
    })

    it('counts host key requests that are waiting for an answer', async () => {
      const { requestId, decision } = await createPendingRequest()

      const res = await app.request('/host-key/status')

      expect(res.status).toBe(200)
      await expect(readJson(res, StatusResponseSchema)).resolves.toEqual({ success: true, pendingCount: 1 })

      await respond({ requestId, response: 'reject' })
      await expect(decision).resolves.toBe(false)
    })
  })

  describe('missing host key handler', () => {
    it('reports 404 for both host key routes', async () => {
      const unconfiguredApp = createSSHRoutes(new GitAuthService())

      const respondRes = await unconfiguredApp.request('/host-key/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: 'test-123', response: 'accept' }),
      })
      const statusRes = await unconfiguredApp.request('/host-key/status')

      expect(respondRes.status).toBe(404)
      await expect(readJson(respondRes, RespondResponseSchema)).resolves.toEqual({
        success: false,
        error: 'SSH host key handler not found',
      })
      expect(statusRes.status).toBe(404)
      await expect(readJson(statusRes, StatusResponseSchema)).resolves.toEqual({
        success: false,
        error: 'SSH host key handler not found',
      })
    })
  })
})
