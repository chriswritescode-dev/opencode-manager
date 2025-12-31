import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { unlink, mkdir } from 'fs/promises'
import { AuthService } from '../../src/services/auth'

const readFile = vi.fn()
const writeFile = vi.fn()
const mkdirSpy = vi.fn()

vi.mock('fs', () => ({
  promises: {
    readFile,
    writeFile,
    mkdir: mkdirSpy,
  },
}))

vi.mock('@opencode-manager/shared/config/env', () => ({
  getAuthPath: () => '/test/auth.json',
  ENV: {
    WORKSPACE: {
      BASE_PATH: '/test/workspace',
      REPOS_DIR: 'repos',
      CONFIG_DIR: '.config/opencode',
      AUTH_FILE: '.opencode/state/opencode/auth.json',
    },
  },
  getWorkspacePath: () => '/test/workspace',
  getReposPath: () => '/test/repos',
  getConfigPath: () => '/test/config',
  getOpenCodeConfigFilePath: () => '/test/config/opencode.json',
  getAgentsMdPath: () => '/test/config/AGENTS.md',
  getDatabasePath: () => '/test/database.db',
}))

describe('AuthService', () => {
  let authService: AuthService

  beforeEach(() => {
    vi.clearAllMocks()
    authService = new AuthService()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('migration', () => {
    it('migrates old apiKey format to new api format on read', async () => {
      readFile.mockResolvedValue(JSON.stringify({
        minimax: {
          type: 'apiKey',
          apiKey: 'test-key-123',
        },
        anthropic: {
          type: 'oauth',
          refresh: 'refresh-token',
          access: 'access-token',
          expires: 1234567890,
        },
      }, null, 2))

      const result = await authService.getAll()

      expect(result).toEqual({
        minimax: {
          type: 'api',
          key: 'test-key-123',
        },
        anthropic: {
          type: 'oauth',
          refresh: 'refresh-token',
          access: 'access-token',
          expires: 1234567890,
        },
      })

      expect(writeFile).toHaveBeenCalledWith(
        '/test/auth.json',
        JSON.stringify({
          minimax: {
            type: 'api',
            key: 'test-key-123',
          },
          anthropic: {
            type: 'oauth',
            refresh: 'refresh-token',
            access: 'access-token',
            expires: 1234567890,
          },
        }, null, 2),
        { mode: 384 }
      )
    })

    it('does not migrate when format is already correct', async () => {
      readFile.mockResolvedValue(JSON.stringify({
        minimax: {
          type: 'api',
          key: 'test-key-123',
        },
        anthropic: {
          type: 'oauth',
          refresh: 'refresh-token',
          access: 'access-token',
          expires: 1234567890,
        },
      }, null, 2))

      const result = await authService.getAll()

      expect(result).toEqual({
        minimax: {
          type: 'api',
          key: 'test-key-123',
        },
        anthropic: {
          type: 'oauth',
          refresh: 'refresh-token',
          access: 'access-token',
          expires: 1234567890,
        },
      })

      expect(writeFile).not.toHaveBeenCalled()
    })

    it('migrates multiple old format entries', async () => {
      readFile.mockResolvedValue(JSON.stringify({
        minimax: {
          type: 'apiKey',
          apiKey: 'minimax-key',
        },
        openai: {
          type: 'apiKey',
          apiKey: 'openai-key',
        },
        anthropic: {
          type: 'oauth',
          refresh: 'refresh-token',
          access: 'access-token',
          expires: 1234567890,
        },
      }, null, 2))

      const result = await authService.getAll()

      expect(result.minimax).toEqual({
        type: 'api',
        key: 'minimax-key',
      })
      expect(result.openai).toEqual({
        type: 'api',
        key: 'openai-key',
      })
      expect(result.anthropic).toEqual({
        type: 'oauth',
        refresh: 'refresh-token',
        access: 'access-token',
        expires: 1234567890,
      })

      expect(writeFile).toHaveBeenCalled()
    })
  })

  describe('set', () => {
    it('writes credentials in new api format', async () => {
      readFile.mockResolvedValue(JSON.stringify({}, null, 2))
      mkdirSpy.mockResolvedValue(undefined)

      await authService.set('minimax', 'test-key-123')

      const expectedData = JSON.stringify({
        minimax: {
          type: 'api',
          key: 'test-key-123',
        },
      }, null, 2)

      expect(writeFile).toHaveBeenCalledWith(
        '/test/auth.json',
        expectedData,
        { mode: 384 }
      )
    })

    it('appends new credentials to existing file', async () => {
      readFile.mockResolvedValue(JSON.stringify({
        anthropic: {
          type: 'oauth',
          refresh: 'refresh-token',
          access: 'access-token',
          expires: 1234567890,
        },
      }, null, 2))
      mkdirSpy.mockResolvedValue(undefined)

      await authService.set('minimax', 'test-key-123')

      const expectedData = JSON.stringify({
        anthropic: {
          type: 'oauth',
          refresh: 'refresh-token',
          access: 'access-token',
          expires: 1234567890,
        },
        minimax: {
          type: 'api',
          key: 'test-key-123',
        },
      }, null, 2)

      expect(writeFile).toHaveBeenCalledWith(
        '/test/auth.json',
        expectedData,
        { mode: 384 }
      )
    })

    it('updates existing credentials in new format', async () => {
      readFile.mockResolvedValue(JSON.stringify({
        minimax: {
          type: 'api',
          key: 'old-key',
        },
      }, null, 2))
      mkdirSpy.mockResolvedValue(undefined)

      await authService.set('minimax', 'new-key-456')

      const expectedData = JSON.stringify({
        minimax: {
          type: 'api',
          key: 'new-key-456',
        },
      }, null, 2)

      expect(writeFile).toHaveBeenCalledWith(
        '/test/auth.json',
        expectedData,
        { mode: 384 }
      )
    })
  })

  describe('getAll', () => {
    it('returns empty object when file does not exist', async () => {
      readFile.mockRejectedValue({ code: 'ENOENT' })

      const result = await authService.getAll()

      expect(result).toEqual({})
    })

    it('returns parsed credentials', async () => {
      readFile.mockResolvedValue(JSON.stringify({
        minimax: {
          type: 'api',
          key: 'test-key',
        },
      }, null, 2))

      const result = await authService.getAll()

      expect(result).toEqual({
        minimax: {
          type: 'api',
          key: 'test-key',
        },
      })
    })
  })

  describe('delete', () => {
    it('removes provider credentials', async () => {
      readFile.mockResolvedValue(JSON.stringify({
        minimax: {
          type: 'api',
          key: 'test-key',
        },
        anthropic: {
          type: 'oauth',
          refresh: 'refresh-token',
          access: 'access-token',
          expires: 1234567890,
        },
      }, null, 2))

      await authService.delete('minimax')

      const expectedData = JSON.stringify({
        anthropic: {
          type: 'oauth',
          refresh: 'refresh-token',
          access: 'access-token',
          expires: 1234567890,
        },
      }, null, 2)

      expect(writeFile).toHaveBeenCalledWith(
        '/test/auth.json',
        expectedData,
        { mode: 384 }
      )
    })
  })

  describe('list', () => {
    it('returns list of provider IDs', async () => {
      readFile.mockResolvedValue(JSON.stringify({
        minimax: {
          type: 'api',
          key: 'test-key',
        },
        anthropic: {
          type: 'oauth',
          refresh: 'refresh-token',
          access: 'access-token',
          expires: 1234567890,
        },
      }, null, 2))

      const result = await authService.list()

      expect(result).toEqual(['minimax', 'anthropic'])
    })
  })

  describe('has', () => {
    it('returns true when provider has credentials', async () => {
      readFile.mockResolvedValue(JSON.stringify({
        minimax: {
          type: 'api',
          key: 'test-key',
        },
      }, null, 2))

      const result = await authService.has('minimax')

      expect(result).toBe(true)
    })

    it('returns false when provider does not have credentials', async () => {
      readFile.mockResolvedValue(JSON.stringify({
        anthropic: {
          type: 'oauth',
          refresh: 'refresh-token',
          access: 'access-token',
          expires: 1234567890,
        },
      }, null, 2))

      const result = await authService.has('minimax')

      expect(result).toBe(false)
    })
  })
})