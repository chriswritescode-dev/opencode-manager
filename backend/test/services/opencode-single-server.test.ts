import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest'

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

import { promises as fs } from 'fs'
import { execSync } from 'child_process'

vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}))

const mkdirMock = fs.mkdir as any
const accessMock = fs.access as any
const execSyncMock = execSync as any

// Reset singleton before any tests run to clear any polluted state from previous test files
beforeAll(async () => {
  const { OpenCodeServerManager } = await import('../../src/services/opencode-single-server')
  OpenCodeServerManager.resetInstance()
})

describe('OpenCodeServerManager - reinitializeBinDirectory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.WORKSPACE_PATH = '/test/workspace'
  })

  afterEach(() => {
    vi.clearAllMocks()
    delete process.env.WORKSPACE_PATH
  })

  describe('Success Cases', () => {
    it('should create directory and initialize when package.json does not exist', async () => {
      const { opencodeServerManager } = await import('../../src/services/opencode-single-server')
      const { logger } = await import('../../src/utils/logger')
      
      const enoentError = new Error('File not found') as NodeJS.ErrnoException
      enoentError.code = 'ENOENT'
      accessMock.mockRejectedValue(enoentError)
      execSyncMock.mockReturnValue(Buffer.from('Success'))

      await opencodeServerManager.reinitializeBinDirectory()

      expect(mkdirMock).toHaveBeenCalledWith(
        '/test/workspace/.opencode/state/opencode/bin',
        { recursive: true }
      )
      expect(execSyncMock).toHaveBeenCalledWith(
        'bun init -y',
        expect.objectContaining({
          cwd: '/test/workspace/.opencode/state/opencode/bin',
          stdio: 'inherit',
          timeout: 30000
        })
      )
      expect(logger.info).toHaveBeenCalledWith('Reinitializing OpenCode bin directory')
      expect(logger.info).toHaveBeenCalledWith('OpenCode bin directory initialized successfully')
    })

    it('should skip initialization when package.json already exists', async () => {
      const { opencodeServerManager } = await import('../../src/services/opencode-single-server')
      const { logger } = await import('../../src/utils/logger')
      
      accessMock.mockResolvedValue(undefined)

      await opencodeServerManager.reinitializeBinDirectory()

      expect(mkdirMock).toHaveBeenCalledWith(
        '/test/workspace/.opencode/state/opencode/bin',
        { recursive: true }
      )
      expect(execSyncMock).not.toHaveBeenCalled()
      expect(logger.info).toHaveBeenCalledWith('Reinitializing OpenCode bin directory')
    })

    it('should log reinitialization message', async () => {
      const { opencodeServerManager } = await import('../../src/services/opencode-single-server')
      const { logger } = await import('../../src/utils/logger')
      
      accessMock.mockResolvedValue(undefined)

      await opencodeServerManager.reinitializeBinDirectory()

      expect(logger.info).toHaveBeenCalledWith('Reinitializing OpenCode bin directory')
    })
  })

  describe('Error Handling', () => {
    it('should handle bun init failure gracefully', async () => {
      const { opencodeServerManager } = await import('../../src/services/opencode-single-server')
      const { logger } = await import('../../src/utils/logger')
      
      const enoentError = new Error('Not found') as NodeJS.ErrnoException
      enoentError.code = 'ENOENT'
      accessMock.mockRejectedValue(enoentError)
      execSyncMock.mockImplementation(() => {
        throw new Error('bun init failed')
      })

      await opencodeServerManager.reinitializeBinDirectory()

      expect(logger.error).toHaveBeenCalledWith('bun init failed:', expect.any(Error))
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to initialize OpenCode bin directory:',
        expect.any(Error)
      )
    })

    it('should handle directory creation failure gracefully', async () => {
      const { opencodeServerManager } = await import('../../src/services/opencode-single-server')
      const { logger } = await import('../../src/utils/logger')
      
      mkdirMock.mockRejectedValue(new Error('Permission denied'))

      await opencodeServerManager.reinitializeBinDirectory()

      expect(logger.error).toHaveBeenCalledWith(
        'Failed to initialize OpenCode bin directory:',
        expect.any(Error)
      )
    })
  })

  describe('Edge Cases', () => {
    it('should handle fs.access throwing non-ENOENT error gracefully', async () => {
      const { opencodeServerManager } = await import('../../src/services/opencode-single-server')
      const { logger } = await import('../../src/utils/logger')
      
      mkdirMock.mockResolvedValue(undefined)
      accessMock.mockRejectedValue(new Error('Permission denied'))

      await opencodeServerManager.reinitializeBinDirectory()

      expect(execSyncMock).not.toHaveBeenCalled()
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to initialize OpenCode bin directory:',
        expect.any(Error)
      )
    })

    it('should handle timeout during bun init', async () => {
      const { opencodeServerManager } = await import('../../src/services/opencode-single-server')
      const { logger } = await import('../../src/utils/logger')
      
      mkdirMock.mockResolvedValue(undefined)
      const enoentError = new Error('Not found') as NodeJS.ErrnoException
      enoentError.code = 'ENOENT'
      accessMock.mockRejectedValue(enoentError)
      execSyncMock.mockImplementation(() => {
        const error = new Error('Command timed out')
        error.name = 'ETIMEDOUT'
        throw error
      })

      await opencodeServerManager.reinitializeBinDirectory()

      expect(logger.error).toHaveBeenCalledWith('bun init failed:', expect.any(Error))
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to initialize OpenCode bin directory:',
        expect.any(Error)
      )
    })
  })
})
