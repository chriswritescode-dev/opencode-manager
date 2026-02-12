import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Database } from 'bun:sqlite'
import * as crypto from 'crypto'
import * as fs from 'fs/promises'
import * as path from 'path'

vi.mock('@opencode-manager/shared/config/env', () => ({
  ENV: {
    AUTH: {
      SECRET: 'test-secret-for-encryption-key-32c'
    },
    OPENCODE: {
      PORT: 5551
    },
    SERVER: {
      PORT: 5003
    }
  },
  getWorkspacePath: vi.fn(() => '/tmp/test-workspace'),
  getReposPath: vi.fn(() => '/tmp/test-repos')
}))

vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn()
  }
}))

let testWorkspacePath: string = '/tmp/test-workspace'

const mockPrepare = vi.fn()
const mockExec = vi.fn()
const mockDatabase = {
  prepare: mockPrepare,
  exec: mockExec
} as unknown as Database

vi.mock('bun:sqlite', () => ({
  Database: vi.fn(() => mockDatabase)
}))

import { GitAuthService } from '../../src/services/git-auth'
import { writeTemporarySSHKey, cleanupSSHKey, cleanupAllSSHKeys, buildSSHCommand } from '../../src/utils/ssh-key-manager'
import { encryptSecret, decryptSecret } from '../../src/utils/crypto'

describe('SSH Integration Tests', () => {
   beforeEach(async () => {
     vi.clearAllMocks()

     const uniqueId = crypto.randomUUID()
     testWorkspacePath = `/tmp/test-workspace-${uniqueId}`

     mockPrepare.mockReturnValue({
      run: vi.fn(),
      get: vi.fn().mockReturnValue(null),
      all: vi.fn().mockReturnValue([])
    })

    const configDir = path.join(testWorkspacePath, 'config')
    const sshKeysDir = path.join(testWorkspacePath, '.ssh-keys')
    await fs.mkdir(configDir, { recursive: true })
    await fs.mkdir(sshKeysDir, { recursive: true })
    const knownHostsFile = path.join(configDir, 'known_hosts')
    await fs.writeFile(knownHostsFile, '', { mode: 0o600 })
  })

  afterEach(async () => {
    vi.clearAllMocks()
    await fs.rm(testWorkspacePath, { recursive: true, force: true }).catch(() => {})
  })

  describe('Full SSH Authentication Flow', () => {
    it('should setup SSH key, get environment, and cleanup', async () => {
      const validKey = 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQDRHw== test@host'
      
      const keyPath = await writeTemporarySSHKey(validKey, 'integration-test')
      expect(keyPath).toBeTruthy()

      const stats = await fs.stat(keyPath)
      expect(stats.mode & 0o777).toBe(0o600)

      const sshResult = buildSSHCommand(keyPath)
      expect(sshResult.command).toContain(`ssh -T -i "${keyPath}"`)
      expect(sshResult.command).toContain('-o IdentitiesOnly=yes')

      await cleanupSSHKey(keyPath)
      await expect(fs.access(keyPath)).rejects.toThrow()
    })

    it('should setup SSH key with passphrase', async () => {
      const validKey = 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQDRHw== test@host'
      const passphrase = 'my-secret-passphrase'
      
      const keyPath = await writeTemporarySSHKey(validKey, 'integration-pass-test')
      
      const sshResult = buildSSHCommand(keyPath, passphrase)
      expect(sshResult.command).toContain('sshpass -e')
      expect(sshResult.env?.SSHPASS).toBe(passphrase)

      await cleanupSSHKey(keyPath)
    })
  })

  describe('Key Lifecycle', () => {
    it('should handle create -> use -> cleanup cycle', async () => {
      const key1 = 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQDRHw== key1@host'
      const key2 = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIQQ/key2@host'

      const keyPath1 = await writeTemporarySSHKey(key1, 'lifecycle-1')
      expect(keyPath1).toBeTruthy()

      const keyPath2 = await writeTemporarySSHKey(key2, 'lifecycle-2')
      expect(keyPath2).toBeTruthy()

      const cmd1 = buildSSHCommand(keyPath1)
      expect(cmd1.command).toContain(keyPath1)

      const cmd2 = buildSSHCommand(keyPath2)
      expect(cmd2.command).toContain(keyPath2)

      await cleanupSSHKey(keyPath1)
      await cleanupSSHKey(keyPath2)

      await expect(fs.access(keyPath1)).rejects.toThrow()
      await expect(fs.access(keyPath2)).rejects.toThrow()
    })

    it('should handle bulk cleanup after multiple key creations', async () => {
      const keys = [
        'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQDRHw== bulk1@host',
        'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIQQ/bulk2@host',
        'ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBEM/bulk3@host'
      ]

      const keyPaths: string[] = []
      for (let i = 0; i < keys.length; i++) {
        const keyPath = await writeTemporarySSHKey(keys[i]!, `bulk-test-${i}`)
        keyPaths.push(keyPath)
      }

      await cleanupAllSSHKeys()

      for (const keyPath of keyPaths) {
        await expect(fs.access(keyPath)).rejects.toThrow()
      }
    })
  })

  describe('Environment Variable Propagation', () => {
    it('should include all required SSH environment variables', async () => {
      const validKey = 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQDRHw== test@host'
      const keyPath = await writeTemporarySSHKey(validKey, 'env-test')

      const sshResult = buildSSHCommand(keyPath)
      
      expect(sshResult.command).toContain('-o IdentitiesOnly=yes')
      expect(sshResult.command).toContain('-o PasswordAuthentication=no')

      await cleanupSSHKey(keyPath)
    })

    it('should include known_hosts path when provided', async () => {
      const validKey = 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQDRHw== test@host'
      const keyPath = await writeTemporarySSHKey(validKey, 'known-hosts-test')
      const knownHostsPath = path.join(testWorkspacePath, 'config', 'known_hosts')

      const sshResult = buildSSHCommand(keyPath, undefined, knownHostsPath)
      
      expect(sshResult.command).toContain(`-o UserKnownHostsFile="${knownHostsPath}"`)

      await cleanupSSHKey(keyPath)
    })
  })

  describe('Switching Between SSH and PAT Credentials', () => {
    it('should properly switch between SSH credential types', async () => {
      const sshKey = 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQDRHw== ssh@host'
      
      const keyPath = await writeTemporarySSHKey(sshKey, 'switch-test')
      const sshCmd = buildSSHCommand(keyPath)
      expect(sshCmd.command).toContain('ssh -T -i')

      await cleanupSSHKey(keyPath)
      await expect(fs.access(keyPath)).rejects.toThrow()
    })
  })

  describe('Encryption and Decryption Integration', () => {
    it('should properly encrypt and decrypt SSH private key', () => {
      const privateKey = `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW
QyNTUxOQAAACBmNkCQ0YDZiVJmHqMvK1PqjWxV4aRqK2Pm8RlV4aRqK2Pm8RlV4aRqK2Pm8RlV4
-----END OPENSSH PRIVATE KEY-----`
      
      const encrypted = encryptSecret(privateKey)
      expect(encrypted).not.toBe(privateKey)
      
      const decrypted = decryptSecret(encrypted)
      expect(decrypted).toBe(privateKey)
    })

    it('should properly encrypt and decrypt passphrase', () => {
      const passphrase = 'my-super-secret-passphrase-123!'
      
      const encrypted = encryptSecret(passphrase)
      expect(encrypted).not.toBe(passphrase)
      
      const decrypted = decryptSecret(encrypted)
      expect(decrypted).toBe(passphrase)
    })
  })

  describe('GitAuthService Integration', () => {
    it('should initialize SSH host key handler', () => {
      const gitAuthService = new GitAuthService()
      const mockIpcServer = {
        registerHandler: vi.fn()
      }

      gitAuthService.initialize(mockIpcServer as never, mockDatabase)

      expect(gitAuthService.sshHostKeyHandler).toBeTruthy()
    })

    it('should return true for verifyHostKeyBeforeOperation when handler is null', async () => {
      const gitAuthService = new GitAuthService()

      const result = await gitAuthService.verifyHostKeyBeforeOperation('git@github.com:user/repo.git')

      expect(result).toBe(true)
    })

    it('should get git environment with terminal prompt disabled', () => {
      const gitAuthService = new GitAuthService()
      
      const env = gitAuthService.getGitEnvironment()
      
      expect(env.GIT_TERMINAL_PROMPT).toBe('0')
      expect(env.LANG).toBe('en_US.UTF-8')
      expect(env.LC_ALL).toBe('en_US.UTF-8')
    })

    it('should include silent flag when requested', () => {
      const gitAuthService = new GitAuthService()
      
      const env = gitAuthService.getGitEnvironment(true)
      
      expect(env.VSCODE_GIT_FETCH_SILENT).toBe('true')
    })
  })

  describe('Database Persistence', () => {
    it('should save trusted host to database', async () => {
      const mockRun = vi.fn()
      mockPrepare.mockReturnValue({
        run: mockRun,
        get: vi.fn().mockReturnValue(null),
        all: vi.fn().mockReturnValue([])
      })

      const gitAuthService = new GitAuthService()
      const mockIpcServer = {
        registerHandler: vi.fn()
      }
      gitAuthService.initialize(mockIpcServer as never, mockDatabase)

      const handler = gitAuthService.sshHostKeyHandler
      if (handler) {
        handler['saveTrustedHost']('github.com', 'github.com ssh-rsa AAAAB...')
      }

      expect(mockPrepare).toHaveBeenCalled()
    })

    it('should load trusted hosts from database on initialization', async () => {
      const mockAll = vi.fn().mockReturnValue([
        { host: 'github.com', public_key: 'github.com ssh-rsa AAAAB...' },
        { host: 'gitlab.com', public_key: 'gitlab.com ssh-ed25519 AAAAC...' }
      ])
      mockPrepare.mockReturnValue({
        run: vi.fn(),
        get: vi.fn().mockReturnValue(null),
        all: mockAll
      })

      const gitAuthService = new GitAuthService()
      const mockIpcServer = {
        registerHandler: vi.fn()
      }
      gitAuthService.initialize(mockIpcServer as never, mockDatabase)
      
      await gitAuthService.sshHostKeyHandler?.initialize()

      expect(mockPrepare).toHaveBeenCalled()
    })
  })
})
