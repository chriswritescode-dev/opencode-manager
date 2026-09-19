import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as http from 'http'
import * as fs from 'fs/promises'
import { randomUUID } from 'crypto'
import { createIPCServer } from '../../src/ipc/ipcServer'
import type { IPCServer } from '../../src/ipc/ipcServer'

interface IPCResponse {
  status: number
  body: string
}

function sendRequest(socketPath: string, path: string, body?: string): Promise<IPCResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath, path, method: 'POST' }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') })
      })
    })
    req.on('error', reject)
    if (body !== undefined) {
      req.write(body)
    }
    req.end()
  })
}

describe('IPCServer', () => {
  const originalXdgRuntimeDir = process.env['XDG_RUNTIME_DIR']
  const servers: IPCServer[] = []

  const startServer = async (context: string = randomUUID()): Promise<IPCServer> => {
    const server = await createIPCServer(context)
    servers.push(server)
    return server
  }

  beforeEach(() => {
    delete process.env['XDG_RUNTIME_DIR']
  })

  afterEach(async () => {
    for (const server of servers.splice(0)) {
      await server.dispose()
      await fs.unlink(server.ipcHandlePath).catch(() => {})
    }
    if (originalXdgRuntimeDir === undefined) {
      delete process.env['XDG_RUNTIME_DIR']
    } else {
      process.env['XDG_RUNTIME_DIR'] = originalXdgRuntimeDir
    }
  })

  it('registers and retrieves handlers by name', async () => {
    const server = await startServer()
    const handler = { handle: vi.fn(async () => 'ok') }

    server.registerHandler('askpass', handler)

    expect(server.getHandler('askpass')).toBe(handler)
    expect(server.getHandler('missing')).toBeUndefined()
  })

  it('exposes the socket path through getEnv', async () => {
    const server = await startServer()

    expect(server.getEnv()).toEqual({ VSCODE_GIT_IPC_HANDLE: server.ipcHandlePath })
  })

  it('creates a random socket path when no context is given', async () => {
    const server = await startServer(randomUUID())
    const randomServer = await createIPCServer()
    servers.push(randomServer)

    expect(randomServer.ipcHandlePath).toContain('opencode-git-')
    expect(randomServer.ipcHandlePath).not.toBe(server.ipcHandlePath)
  })

  it('returns the handler result as JSON with status 200', async () => {
    const server = await startServer()
    server.registerHandler('askpass', { handle: async (request) => ({ request, value: 7 }) })

    const response = await sendRequest(server.ipcHandlePath, '/askpass', JSON.stringify({ user: 'alice' }))

    expect(response.status).toBe(200)
    expect(JSON.parse(response.body)).toEqual({ request: { user: 'alice' }, value: 7 })
  })

  it('returns 404 with an error body for an unknown path', async () => {
    const server = await startServer()

    const response = await sendRequest(server.ipcHandlePath, '/unknown', '{}')

    expect(response.status).toBe(404)
    expect(JSON.parse(response.body)).toEqual({ error: 'Handler not found' })
  })

  it('returns 400 when the request body is empty', async () => {
    const server = await startServer()
    server.registerHandler('askpass', { handle: async () => 'ok' })

    const response = await sendRequest(server.ipcHandlePath, '/askpass')

    expect(response.status).toBe(400)
    expect(JSON.parse(response.body)).toEqual({ error: 'Empty request body' })
  })

  it('returns 500 when the handler throws', async () => {
    const server = await startServer()
    server.registerHandler('askpass', {
      handle: async () => {
        throw new Error('handler exploded')
      },
    })

    const response = await sendRequest(server.ipcHandlePath, '/askpass', '{}')

    expect(response.status).toBe(500)
    expect(JSON.parse(response.body)).toEqual({ error: 'Internal server error' })
  })

  it('returns 500 when the request body is not valid JSON', async () => {
    const server = await startServer()
    server.registerHandler('askpass', { handle: async () => 'ok' })

    const response = await sendRequest(server.ipcHandlePath, '/askpass', 'not-json')

    expect(response.status).toBe(500)
    expect(JSON.parse(response.body)).toEqual({ error: 'Internal server error' })
  })

  it('closes the server on dispose', async () => {
    const server = await startServer()

    await server.dispose()

    await expect(sendRequest(server.ipcHandlePath, '/askpass', '{}')).rejects.toBeDefined()
  })
})
