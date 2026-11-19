import { describe, expect, it } from 'vitest'
import type { OpenCodeServerTestResult } from '@opencode-manager/shared/schemas'
import { makeOpenCodeServer } from '@/test/fixtures/api'
import { createFetchFake, type FetchRoute } from '@/test/fetchFake'
import {
  createOpenCodeServer,
  deleteOpenCodeServer,
  listOpenCodeServers,
  testOpenCodeServer,
  testOpenCodeServerById,
  updateOpenCodeServer,
} from './opencodeServers'

const server = makeOpenCodeServer({
  id: 'srv_1',
  name: 'Kitchen',
  baseUrl: 'https://kitchen.example.com',
  username: 'opencode',
})

const testResult: OpenCodeServerTestResult = {
  ok: true,
  version: '2.0.15',
  versionSupported: true,
  error: null,
}

function installRoutes(routes: FetchRoute[]): ReturnType<typeof createFetchFake> {
  const fetchFake = createFetchFake(routes)
  fetchFake.install()
  return fetchFake
}

describe('opencodeServers', () => {
  it('lists servers from the { servers } envelope', async () => {
    const fetchFake = installRoutes([
      { method: 'GET', path: '/api/opencode-servers', respond: () => ({ json: { servers: [server] } }) },
    ])

    await expect(listOpenCodeServers()).resolves.toEqual([server])
    expect(fetchFake.lastRequest('GET', '/api/opencode-servers')?.path).toBe('/api/opencode-servers')
  })

  it('creates a server and returns the test result', async () => {
    const input = {
      name: 'Kitchen',
      baseUrl: 'https://kitchen.example.com',
      username: 'opencode',
      password: 'secret',
      enabled: true,
    }
    const fetchFake = installRoutes([
      {
        method: 'POST',
        path: '/api/opencode-servers',
        respond: () => ({ status: 201, json: { server, test: testResult } }),
      },
    ])

    await expect(createOpenCodeServer(input)).resolves.toEqual({ server, test: testResult })
    expect(fetchFake.lastRequest('POST', '/api/opencode-servers')?.body).toEqual(input)
  })

  it('unwraps the { server } envelope on PATCH', async () => {
    const fetchFake = installRoutes([
      {
        method: 'PATCH',
        path: '/api/opencode-servers/srv_1',
        respond: () => ({ json: { server: { ...server, name: 'Office' } } }),
      },
    ])

    await expect(updateOpenCodeServer('srv_1', { name: 'Office' })).resolves.toEqual({
      ...server,
      name: 'Office',
    })
    expect(fetchFake.lastRequest('PATCH', '/api/opencode-servers/srv_1')?.body).toEqual({ name: 'Office' })
  })

  it('clears a password by sending null', async () => {
    const fetchFake = installRoutes([
      {
        method: 'PATCH',
        path: '/api/opencode-servers/srv_1',
        respond: () => ({ json: { server: { ...server, hasPassword: false } } }),
      },
    ])

    await updateOpenCodeServer('srv_1', { password: null })
    expect(fetchFake.lastRequest('PATCH', '/api/opencode-servers/srv_1')?.body).toEqual({ password: null })
  })

  it('deletes a server with DELETE and accepts the empty 204 response', async () => {
    const fetchFake = installRoutes([
      { method: 'DELETE', path: '/api/opencode-servers/srv_1', respond: () => ({ status: 204 }) },
    ])

    await expect(deleteOpenCodeServer('srv_1')).resolves.toBeUndefined()
    expect(fetchFake.findRequests('DELETE', '/api/opencode-servers/srv_1')).toHaveLength(1)
  })

  it('tests unsaved values with POST /test', async () => {
    const input = { baseUrl: 'https://kitchen.example.com', username: 'opencode', password: 'secret' }
    const fetchFake = installRoutes([
      { method: 'POST', path: '/api/opencode-servers/test', respond: () => ({ json: testResult }) },
    ])

    await expect(testOpenCodeServer(input)).resolves.toEqual(testResult)
    expect(fetchFake.lastRequest('POST', '/api/opencode-servers/test')?.body).toEqual(input)
  })

  it('tests a saved server with POST /:id/test', async () => {
    const fetchFake = installRoutes([
      { method: 'POST', path: '/api/opencode-servers/srv_1/test', respond: () => ({ json: testResult }) },
    ])

    await expect(testOpenCodeServerById('srv_1')).resolves.toEqual(testResult)
    expect(fetchFake.findRequests('POST', '/api/opencode-servers/srv_1/test')).toHaveLength(1)
  })

  it('surfaces backend error messages', async () => {
    installRoutes([
      {
        method: 'POST',
        path: '/api/opencode-servers/srv_1/test',
        respond: () => ({ status: 502, json: { error: 'Server unreachable' } }),
      },
    ])

    await expect(testOpenCodeServerById('srv_1')).rejects.toThrow('Server unreachable')
  })
})
