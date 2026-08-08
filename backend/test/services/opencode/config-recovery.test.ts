/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@opencode-manager/shared/config/env', () => ({
  getWorkspacePath: vi.fn(() => '/test/workspace'),
  getOpenCodeConfigFilePath: vi.fn(() => '/test/workspace/.config/opencode.json'),
  getReposPath: vi.fn(() => '/test/workspace/repos'),
  getAgentsMdPath: vi.fn(() => '/test/workspace/AGENTS.md'),
  getDatabasePath: vi.fn(() => ':memory:'),
  getConfigPath: vi.fn(() => '/test/workspace/config'),
  ENV: {
    SERVER: { PORT: 5003, HOST: '0.0.0.0', NODE_ENV: 'test' },
    AUTH: { TRUSTED_ORIGINS: 'http://localhost:5173', SECRET: 'test-secret-for-encryption-key-32c' },
    WORKSPACE: { BASE_PATH: '/test/workspace', REPOS_DIR: 'repos', CONFIG_DIR: 'config', AUTH_FILE: 'auth.json' },
    OPENCODE: { PORT: 5551, HOST: '127.0.0.1' },
    DATABASE: { PATH: ':memory:' },
    FILE_LIMITS: {
      MAX_SIZE_BYTES: 1024 * 1024,
      MAX_UPLOAD_SIZE_BYTES: 10 * 1024 * 1024,
    },
  },
  FILE_LIMITS: {
    MAX_SIZE_BYTES: 1024 * 1024,
    MAX_UPLOAD_SIZE_BYTES: 10 * 1024 * 1024,
  },
}))

vi.mock('../../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}))

import { patchConfigWithRecovery } from '../../../src/services/opencode/config-recovery'
import type { OpenCodeClient, ForwardRequest } from '../../../src/services/opencode/client'

function createStubClient(
  responses: Array<{ status: number; text: string }>,
  capturedRequests?: ForwardRequest[],
): OpenCodeClient {
  let callIndex = 0
  return {
     
    async forward(req: ForwardRequest) {
      capturedRequests?.push(req)
      const response = responses[callIndex++] ?? responses[responses.length - 1]!
      return new Response(response.text, {
        status: response.status,
        headers: { 'Content-Type': 'application/json' },
      })
    },
     
    async forwardRaw(_request: Request) {
      throw new Error('not used')
    },
     
    async getJson<T>(_path: string) {
      throw new Error('not used')
    },
     
    async postJson<T>(_path: string, _body: unknown) {
      throw new Error('not used')
    },
     
    async setProviderAuth(_providerId: string, _apiKey: string) {
      throw new Error('not used')
    },
     
    async deleteProviderAuth(_providerId: string) {
      throw new Error('not used')
    },
     
    async startMcpAuth(_serverName: string, _directory?: string) {
      throw new Error('not used')
    },
     
    async authenticateMcp(_serverName: string, _directory?: string) {
      throw new Error('not used')
    },
  }
}

describe('patchConfigWithRecovery', () => {
  it('should return success on 200 response with single forward call', async () => {
    const config = { agent: { name: 'test' } }
    const captured: ForwardRequest[] = []
    const client = createStubClient([
      { status: 200, text: '{}' },
    ], captured)

    const result = await patchConfigWithRecovery(client, config)

    expect(result.success).toBe(true)
    expect(result.appliedConfig).toBe(config)
    expect(result.error).toBeUndefined()
    expect(captured).toHaveLength(1)
  })

  it('should recover by removing command.review on 400 with structured errors', async () => {
    const errorResponse = {
      success: false,
      data: { command: { review: 'some value' } },
      errors: [
        { path: ['command', 'review'], message: 'Invalid command review field' },
      ],
    }

    const captured: ForwardRequest[] = []
    const client = createStubClient([
      { status: 400, text: JSON.stringify(errorResponse) },
      { status: 200, text: '{}' },
    ], captured)

    const config = { command: { review: 'test', other: 'value' }, agent: { name: 'test' } }
    const result = await patchConfigWithRecovery(client, config)

    expect(result.success).toBe(true)
    expect(result.removedFields).toContain('command.review')
    expect(result.details).toHaveLength(1)
    expect(captured).toHaveLength(2)

    const retryBody = JSON.parse(captured[1]!.body!) as { command?: { review?: unknown; other?: unknown }; agent?: unknown }
    expect(retryBody.command?.review).toBeUndefined()
    expect(retryBody.command?.other).toBe('value')
    expect(retryBody.agent).toEqual({ name: 'test' })

    expect(result.appliedConfig).toBeDefined()
    expect((result.appliedConfig as { command?: { review?: unknown } }).command?.review).toBeUndefined()
  })

  it('should recover from ConfigInvalidError data.issues shape', async () => {
    const errorResponse = {
      name: 'ConfigInvalidError',
      data: {
        issues: [
          { path: ['command', 'review'], message: 'Invalid review' },
        ],
      },
    }

    const captured: ForwardRequest[] = []
    const client = createStubClient([
      { status: 400, text: JSON.stringify(errorResponse) },
      { status: 200, text: '{}' },
    ], captured)

    const config = { command: { review: 'test' } }
    const result = await patchConfigWithRecovery(client, config)

    expect(result.success).toBe(true)
    expect(result.removedFields).toContain('command.review')
    expect(captured).toHaveLength(2)

    const retryBody = JSON.parse(captured[1]!.body!) as { command?: { review?: unknown } }
    expect(retryBody.command?.review).toBeUndefined()

    expect((result.appliedConfig as { command?: { review?: unknown } }).command?.review).toBeUndefined()
  })

  it('should NOT retry if path depth > 3', async () => {
    const errorResponse = {
      success: false,
      data: {},
      errors: [
        { path: ['a', 'b', 'c', 'd'], message: 'Too deep' },
      ],
    }

    const captured: ForwardRequest[] = []
    const client = createStubClient([
      { status: 400, text: JSON.stringify(errorResponse) },
    ], captured)

    const config = { a: { b: { c: { d: 'value' } } } }
    const result = await patchConfigWithRecovery(client, config)

    expect(result.success).toBe(false)
    expect(result.removedFields).toBeUndefined()
    expect(captured).toHaveLength(1)
    expect(result.details).toHaveLength(1)
    expect(result.details?.[0]?.message).toBe('Too deep')
  })

  it('should NOT retry if path is root', async () => {
    const errorResponse = {
      success: false,
      data: {},
      errors: [
        { path: ['root'], message: 'Invalid configuration' },
      ],
    }

    const captured: ForwardRequest[] = []
    const client = createStubClient([
      { status: 400, text: JSON.stringify(errorResponse) },
    ], captured)

    const config = { invalid: 'config' }
    const result = await patchConfigWithRecovery(client, config)

    expect(result.success).toBe(false)
    expect(result.removedFields).toBeUndefined()
    expect(captured).toHaveLength(1)
    expect(result.details).toHaveLength(1)
    expect(result.details?.[0]?.path).toBe('root')
  })

  it('should return retry errors when retry also fails', async () => {
    const initialError = {
      success: false,
      data: {},
      errors: [
        { path: ['command', 'review'], message: 'Initial error' },
      ],
    }

    const retryError = {
      success: false,
      data: {},
      errors: [
        { path: ['agent'], message: 'Retry error - agent invalid' },
      ],
    }

    let callCount = 0
    const client: OpenCodeClient = {
      async forward(_req: ForwardRequest) {
        callCount++
        if (callCount === 1) {
          return new Response(JSON.stringify(initialError), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        return new Response(JSON.stringify(retryError), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      },
      async forwardRaw(_request: Request) {
        throw new Error('not used')
      },
      async getJson<T>(_path: string) {
        throw new Error('not used')
      },
      async postJson<T>(_path: string, _body: unknown) {
        throw new Error('not used')
      },
      async setProviderAuth(providerId: string, apiKey: string) {
        throw new Error('not used')
      },
      async deleteProviderAuth(providerId: string) {
        throw new Error('not used')
      },
      async startMcpAuth(serverName: string, directory?: string) {
        throw new Error('not used')
      },
      async authenticateMcp(serverName: string, directory?: string) {
        throw new Error('not used')
      },
    }

    const config = { command: { review: 'test' } }
    const result = await patchConfigWithRecovery(client, config)

    expect(result.success).toBe(false)
    expect(result.removedFields).toContain('command.review')
    expect(result.details).toHaveLength(1)
    expect(result.details?.[0]?.message).toBe('Retry error - agent invalid')
    expect(callCount).toBe(2)
  })

  it('should return error with Parse error on unparseable response', async () => {
    const captured: ForwardRequest[] = []
    const client = createStubClient([
      { status: 400, text: 'not valid json at all' },
    ], captured)

    const config = {}
    const result = await patchConfigWithRecovery(client, config)

    expect(result.success).toBe(false)
    expect(result.error).toContain('Parse error')
    expect(captured).toHaveLength(1)
  })

  it('should return error on 502 from client.forward', async () => {
    const error502Response = { error: 'Proxy request failed' }
    const captured: ForwardRequest[] = []
    const client = createStubClient([
      { status: 502, text: JSON.stringify(error502Response) },
    ], captured)

    const config = {}
    const result = await patchConfigWithRecovery(client, config)

    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
    expect(captured).toHaveLength(1)
  })
})
