import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('bun:sqlite', () => ({
  Database: vi.fn(),
}))

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

vi.mock('fs', () => ({
  promises: {
    mkdir: vi.fn(),
    access: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    stat: vi.fn(),
    chmod: vi.fn(),
    unlink: vi.fn(),
    rm: vi.fn(),
    readdir: vi.fn(),
  },
}))

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}))

vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}))

const createMockFetch = (response: Response) => {
  return vi.fn().mockResolvedValue(response) as unknown as typeof fetch
}

describe('proxy service', () => {
  describe('patchOpenCodeConfig', () => {
    const originalFetch = global.fetch

    beforeEach(() => {
      vi.clearAllMocks()
    })

    afterEach(() => {
      global.fetch = originalFetch
    })

    describe('when OpenCode returns 400 with structured errors', () => {
      it('should parse errors array and extract path and message', async () => {
        const mockResponse = {
          success: false,
          data: { command: { review: 'some value' } },
          errors: [
            { path: ['command', 'review'], message: 'Invalid command review field' },
            { path: ['agent', 'temperature'], message: 'Temperature must be between 0 and 2' }
          ]
        }

        global.fetch = createMockFetch({
          ok: false,
          status: 400,
          text: async () => JSON.stringify(mockResponse)
        } as Response)

        const { patchOpenCodeConfig } = await import('../../src/services/proxy')
        const result = await patchOpenCodeConfig({ command: { review: 'test' } })

        expect(result.success).toBe(false)
        expect(result.details).toHaveLength(2)
        expect(result.details?.[0]).toEqual({ path: 'command.review', message: 'Invalid command review field' })
        expect(result.details?.[1]).toEqual({ path: 'agent.temperature', message: 'Temperature must be between 0 and 2' })
        expect(result.error).toBe('command.review: Invalid command review field; agent.temperature: Temperature must be between 0 and 2')
      })

      it('should handle errors with string path format', async () => {
        const mockResponse = {
          success: false,
          data: {},
          errors: [
            { path: 'command.review', message: 'Invalid field' }
          ]
        }

        global.fetch = createMockFetch({
          ok: false,
          status: 400,
          text: async () => JSON.stringify(mockResponse)
        } as Response)

        const { patchOpenCodeConfig } = await import('../../src/services/proxy')
        const result = await patchOpenCodeConfig({ command: { review: 'test' } })

        expect(result.success).toBe(false)
        expect(result.details).toHaveLength(1)
        expect(result.details?.[0]).toEqual({ path: 'command.review', message: 'Invalid field' })
      })

      it('should handle errors with missing path (defaults to root)', async () => {
        const mockResponse = {
          success: false,
          data: {},
          errors: [
            { message: 'Configuration is invalid' }
          ]
        }

        global.fetch = createMockFetch({
          ok: false,
          status: 400,
          text: async () => JSON.stringify(mockResponse)
        } as Response)

        const { patchOpenCodeConfig } = await import('../../src/services/proxy')
        const result = await patchOpenCodeConfig({})

        expect(result.success).toBe(false)
        expect(result.details).toHaveLength(1)
        expect(result.details?.[0]).toEqual({ path: 'root', message: 'Configuration is invalid' })
      })

      it('should parse nested data.issues from runtime validation payloads', async () => {
        const mockResponse = {
          success: false,
          data: {
            issues: [
              { path: ['command', 'review'], message: 'Invalid review command' },
              { path: ['provider', 'openai', 'models'], message: 'Expected object' }
            ]
          }
        }

        global.fetch = createMockFetch({
          ok: false,
          status: 400,
          text: async () => JSON.stringify(mockResponse)
        } as Response)

        const { patchOpenCodeConfig } = await import('../../src/services/proxy')
        const result = await patchOpenCodeConfig({ command: { review: 'test' } })

        expect(result.success).toBe(false)
        expect(result.details).toEqual([
          { path: 'command.review', message: 'Invalid review command' },
          { path: 'provider.openai.models', message: 'Expected object' }
        ])
        expect(result.error).toBe('command.review: Invalid review command; provider.openai.models: Expected object')
      })
    })

    describe('when OpenCode returns 400 with only data (no errors)', () => {
      it('should not use data as error message source', async () => {
        const mockResponse = {
          success: false,
          data: { command: { review: 'some long value that should not be the error message' } }
        }

        global.fetch = createMockFetch({
          ok: false,
          status: 400,
          text: async () => JSON.stringify(mockResponse)
        } as Response)

        const { patchOpenCodeConfig } = await import('../../src/services/proxy')
        const result = await patchOpenCodeConfig({ command: { review: 'test' } })

        expect(result.success).toBe(false)
        expect(result.error).not.toContain('some long value')
        expect(result.details).toEqual([])
      })
    })

    describe('when OpenCode returns 400 with unstructured text', () => {
      it('should create bounded fallback message without giant config blobs', async () => {
        const longConfig = 'x'.repeat(1000)
        global.fetch = createMockFetch({
          ok: false,
          status: 400,
          text: async () => longConfig
        } as Response)

        const { patchOpenCodeConfig } = await import('../../src/services/proxy')
        const result = await patchOpenCodeConfig({ config: longConfig })

        expect(result.success).toBe(false)
        expect(result.error?.length).toBeLessThan(400)
        expect(result.details).toEqual([])
      })

      it('should handle JSON parse errors gracefully', async () => {
        global.fetch = createMockFetch({
          ok: false,
          status: 400,
          text: async () => 'not valid json at all'
        } as Response)

        const { patchOpenCodeConfig } = await import('../../src/services/proxy')
        const result = await patchOpenCodeConfig({})

        expect(result.success).toBe(false)
        expect(result.error).toContain('Parse error')
      })
    })

    describe('retry logic with removable paths', () => {
      it('should retry after removing a valid nested path like command.review', async () => {
        const errorResponse = {
          success: false,
          data: {},
          errors: [
            { path: ['command', 'review'], message: 'Invalid field' }
          ]
        }

        let callCount = 0
        global.fetch = vi.fn().mockImplementation(async () => {
          callCount++
          if (callCount === 1) {
            return {
              ok: false,
              status: 400,
              text: async () => JSON.stringify(errorResponse)
            } as unknown as Response
          }
          return {
            ok: true,
            text: async () => '{}'
          } as unknown as Response
        }) as unknown as typeof fetch

        const { patchOpenCodeConfig } = await import('../../src/services/proxy')
        const result = await patchOpenCodeConfig({
          command: { review: 'test', other: 'value' },
          agent: { name: 'test' }
        })

        expect(result.success).toBe(true)
        expect(result.removedFields).toContain('command.review')
        expect(result.details).toHaveLength(1)
      })

      it('should not retry if any path is non-removable (root level)', async () => {
        const errorResponse = {
          success: false,
          data: {},
          errors: [
            { path: ['root'], message: 'Invalid configuration' }
          ]
        }

        global.fetch = createMockFetch({
          ok: false,
          status: 400,
          text: async () => JSON.stringify(errorResponse)
        } as Response)

        const { patchOpenCodeConfig } = await import('../../src/services/proxy')
        const result = await patchOpenCodeConfig({ invalid: 'config' })

        expect(result.success).toBe(false)
        expect(result.removedFields).toEqual(undefined)
        expect(result.error).toContain('Invalid configuration')
      })

      it('should not retry if any path exceeds depth limit', async () => {
        const errorResponse = {
          success: false,
          data: {},
          errors: [
            { path: ['a', 'b', 'c', 'd'], message: 'Too deep' }
          ]
        }

        global.fetch = createMockFetch({
          ok: false,
          status: 400,
          text: async () => JSON.stringify(errorResponse)
        } as Response)

        const { patchOpenCodeConfig } = await import('../../src/services/proxy')
        const result = await patchOpenCodeConfig({ a: { b: { c: { d: 'value' } } } })

        expect(result.success).toBe(false)
        expect(result.removedFields).toEqual(undefined)
      })
    })

    describe('retry failure handling', () => {
      it('should return retry-specific details when retry fails with structured errors', async () => {
        const initialError = {
          success: false,
          data: {},
          errors: [
            { path: ['command', 'review'], message: 'Initial error' }
          ]
        }

        const retryError = {
          success: false,
          data: {},
          errors: [
            { path: ['agent'], message: 'Retry error - agent invalid' }
          ]
        }

        let callCount = 0
        global.fetch = vi.fn().mockImplementation(async () => {
          callCount++
          if (callCount === 1) {
            return {
              ok: false,
              status: 400,
              text: async () => JSON.stringify(initialError)
            } as unknown as Response
          }
          return {
            ok: false,
            status: 400,
            text: async () => JSON.stringify(retryError)
          } as unknown as Response
        }) as unknown as typeof fetch

        const { patchOpenCodeConfig } = await import('../../src/services/proxy')
        const result = await patchOpenCodeConfig({ command: { review: 'test' } })

        expect(result.success).toBe(false)
        expect(result.removedFields).toContain('command.review')
        expect(result.details).toHaveLength(1)
        expect(result.details?.[0]?.message).toBe('Retry error - agent invalid')
        expect(result.error).toContain('Retry error')
      })

      it('should fall back to initial details if retry response is unstructured', async () => {
        const initialError = {
          success: false,
          data: {},
          errors: [
            { path: ['command', 'review'], message: 'Initial error' }
          ]
        }

        let callCount = 0
        global.fetch = vi.fn().mockImplementation(async () => {
          callCount++
          if (callCount === 1) {
            return {
              ok: false,
              status: 400,
              text: async () => JSON.stringify(initialError)
            } as unknown as Response
          }
          return {
            ok: false,
            status: 500,
            text: async () => 'Internal Server Error'
          } as unknown as Response
        }) as unknown as typeof fetch

        const { patchOpenCodeConfig } = await import('../../src/services/proxy')
        const result = await patchOpenCodeConfig({ command: { review: 'test' } })

        expect(result.success).toBe(false)
        expect(result.removedFields).toContain('command.review')
        expect(result.details?.[0]?.message).toBe('Initial error')
      })
    })

    describe('path deduplication', () => {
      it('should deduplicate paths before removal', async () => {
        const errorResponse = {
          success: false,
          data: {},
          errors: [
            { path: ['command', 'review'], message: 'Error 1' },
            { path: ['command', 'review'], message: 'Error 2' }
          ]
        }

        let callCount = 0
        global.fetch = vi.fn().mockImplementation(async () => {
          callCount++
          if (callCount === 1) {
            return {
              ok: false,
              status: 400,
              text: async () => JSON.stringify(errorResponse)
            } as unknown as Response
          }
          return {
            ok: true,
            text: async () => '{}'
          } as unknown as Response
        }) as unknown as typeof fetch

        const { patchOpenCodeConfig } = await import('../../src/services/proxy')
        const result = await patchOpenCodeConfig({ command: { review: 'test' } })

        expect(result.success).toBe(true)
        expect(result.removedFields).toHaveLength(1)
        expect(result.removedFields?.[0]).toBe('command.review')
      })
    })

    describe('successful patch without errors', () => {
      it('should return success without details', async () => {
        global.fetch = createMockFetch({
          ok: true,
          text: async () => '{}'
        } as Response)

        const { patchOpenCodeConfig } = await import('../../src/services/proxy')
        const result = await patchOpenCodeConfig({ command: { review: 'test' } })

        expect(result.success).toBe(true)
        expect(result.error).toBeUndefined()
        expect(result.details).toBeUndefined()
        expect(result.removedFields).toBeUndefined()
      })
    })
  })
})
