import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { GitCredential } from '../../src/utils/git-auth'
import type { IPCServer } from '../../src/ipc/ipcServer'
import type { Database } from 'bun:sqlite'

vi.mock('bun:sqlite', () => ({
  Database: vi.fn(),
}))

vi.mock('@opencode-manager/shared/config/env', () => ({
  ENV: {
    AUTH: {
      SECRET: 'test-secret-for-encryption'
    },
    OPENCODE: {
      PORT: 5551
    },
    SERVER: {
      PORT: 5003
    }
  },
  getReposPath: vi.fn(() => '/tmp/test-repos'),
  getWorkspacePath: vi.fn(() => '/tmp/test-workspace')
}))

vi.mock('@opencode-manager/shared/config', () => ({
  DEFAULTS: {
    SSE: {
      RECONNECT_DELAY_MS: 1000,
      MAX_RECONNECT_DELAY_MS: 30000,
      IDLE_GRACE_PERIOD_MS: 120000,
    },
  },
}))

vi.mock('eventsource', () => ({
  EventSource: vi.fn(),
}))

vi.mock('../../src/utils/ssh-key-manager', () => ({
  writeTemporarySSHKey: vi.fn().mockResolvedValue('/tmp/test-workspace/.ssh-keys/test-key'),
  cleanupSSHKey: vi.fn().mockResolvedValue(undefined),
  buildSSHCommand: vi.fn((keyPath: string, passphrase?: string, knownHostsPath?: string) => {
    const knownHostsOption = knownHostsPath 
      ? `-o UserKnownHostsFile="${knownHostsPath}" -o StrictHostKeyChecking=accept-new` 
      : '-o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/dev/null'
    const baseCommand = `ssh -i ${keyPath} -o IdentitiesOnly=yes -o PasswordAuthentication=no ${knownHostsOption}`
    if (passphrase) {
      return {
        command: `sshpass -e ${baseCommand}`,
        env: { SSHPASS: passphrase }
      }
    }
    return { command: baseCommand }
  }),
  buildSSHCommandWithKnownHosts: vi.fn((knownHostsPath: string) => 
    `ssh -o UserKnownHostsFile="${knownHostsPath}" -o StrictHostKeyChecking=accept-new -o PasswordAuthentication=no`
  ),
}))

import { GitAuthService } from '../../src/services/git-auth'
import { encryptSecret } from '../../src/utils/crypto'

vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}))

vi.mock('../ipc/ipcServer', () => ({
  IPCServer: vi.fn(),
}))

vi.mock('../ipc/askpassHandler', () => ({
  AskpassHandler: vi.fn().mockImplementation(() => ({
    getEnv: vi.fn().mockReturnValue({}),
  })),
}))

vi.mock('../../src/ipc/sshHostKeyHandler', () => ({
  SSHHostKeyHandler: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    getKnownHostsPath: vi.fn().mockReturnValue(null),
    getEnv: vi.fn().mockReturnValue({}),
  })),
}))

describe('GitAuthService with passphrase support', () => {
  let gitAuthService: GitAuthService
  let mockIpcServer: IPCServer
  let mockDatabase: Database

  beforeEach(() => {
    vi.clearAllMocks()
    gitAuthService = new GitAuthService()
    mockIpcServer = {
      registerHandler: vi.fn(),
    } as unknown as IPCServer
    mockDatabase = {} as Database
    gitAuthService.initialize(mockIpcServer, mockDatabase)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('setupSSHKey with passphrase', () => {
    it('decrypts and stores passphrase from credential', async () => {
      const privateKey = '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW\nQyNTUxOQAAACBmNkCQ0YDZiVJmHqMvK1PqjWxV4aRqK2Pm8RlV4aRqK2Pm8RlV4aRqK2Pm8RlV4\naRqK2Pm8RlV4aRqK2Pm8RlV4aRqK2Pm8RlV4aAAAAgBmNkCQ0YDZiVJmHqMvK1PqjWxV4aRqK2Pm8RlV4\naRqK2Pm8RlV4aRqK2Pm8RlV4aRqK2Pm8RlV4aAAAADHN0cmluZy1rZXktdGVzdAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4v\nMDEyMzQ1Njc4OTo7PD0+P0BBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWltcXV5fYGFiY2RlZmdoaWpr\nbG1ub3BxcnN0dXZ3eHl6e3x9fn+AgYKDhIWGh4iJiouMjY6PkJGSk5SVlpeYmZqbnJ2en6ChoqOkpaan\nqKmqq6ytrq+wsbKztLW2t7i5uru8vb6/wMHCw8TFxsfIycrLzM3Oz9DR0tPU1dbX2Nna29zd3t/g4eLj\n5OXm5+jp6uvs7e7v8PHy8/T19vf4+fr7/P3+/w==\n-----END OPENSSH PRIVATE KEY-----'
      const passphrase = 'my-secret-passphrase'
      
      const credential: GitCredential = {
        name: 'test-credential',
        host: 'github.com',
        type: 'ssh',
        sshPrivateKeyEncrypted: encryptSecret(privateKey),
        hasPassphrase: true,
        passphrase: encryptSecret(passphrase),
      }

      await gitAuthService['setupSSHKey'](credential)

      const sshPassphrase = gitAuthService['sshPassphrase']
      expect(sshPassphrase).toBe(passphrase)
    })

    it('handles credential without passphrase', async () => {
      const privateKey = '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW\nQyNTUxOQAAACBmNkCQ0YDZiVJmHqMvK1PqjWxV4aRqK2Pm8RlV4aRqK2Pm8RlV4aRqK2Pm8RlV4\naRqK2Pm8RlV4aRqK2Pm8RlV4aRqK2Pm8RlV4aAAAAgBmNkCQ0YDZiVJmHqMvK1PqjWxV4aRqK2Pm8RlV4\naRqK2Pm8RlV4aRqK2Pm8RlV4aRqK2Pm8RlV4aAAAADHN0cmluZy1rZXktdGVzdAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4v\nMDEyMzQ1Njc4OTo7PD0+P0BBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWltcXV5fYGFiY2RlZmdoaWpr\nbG1ub3BxcnN0dXZ3eHl6e3x9fn+AgYKDhIWGh4iJiouMjY6PkJGSk5SVlpeYmZqbnJ2en6ChoqOkpaan\nqKmqq6ytrq+wsbKztLW2t7i5uru8vb6/wMHCw8TFxsfIycrLzM3Oz9DR0tPU1dbX2Nna29zd3t/g4eLj\n5OXm5+jp6uvs7e7v8PHy8/T19vf4+fr7/P3+/w==\n-----END OPENSSH PRIVATE KEY-----'
      
      const credential: GitCredential = {
        name: 'test-credential',
        host: 'github.com',
        type: 'ssh',
        sshPrivateKeyEncrypted: encryptSecret(privateKey),
        hasPassphrase: false,
      }

      await gitAuthService['setupSSHKey'](credential)

      const sshPassphrase = gitAuthService['sshPassphrase']
      expect(sshPassphrase).toBeNull()
    })

    it('clears previous passphrase when setting up new credential', async () => {
      const privateKey1 = '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW\nQyNTUxOQAAACBmNkCQ0YDZiVJmHqMvK1PqjWxV4aRqK2Pm8RlV4aRqK2Pm8RlV4aRqK2Pm8RlV4\naRqK2Pm8RlV4aRqK2Pm8RlV4aRqK2Pm8RlV4aAAAAgBmNkCQ0YDZiVJmHqMvK1PqjWxV4aRqK2Pm8RlV4\naRqK2Pm8RlV4aRqK2Pm8RlV4aRqK2Pm8RlV4aAAAADHN0cmluZy1rZXktdGVzdAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4v\nMDEyMzQ1Njc4OTo7PD0+P0BBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWltcXV5fYGFiY2RlZmdoaWpr\nbG1ub3BxcnN0dXZ3eHl6e3x9fn+AgYKDhIWGh4iJiouMjY6PkJGSk5SVlpeYmZqbnJ2en6ChoqOkpaan\nqKmqq6ytrq+wsbKztLW2t7i5uru8vb6/wMHCw8TFxsfIycrLzM3Oz9DR0tPU1dbX2Nna29zd3t/g4eLj\n5OXm5+jp6uvs7e7v8PHy8/T19vf4+fr7/P3+/w==\n-----END OPENSSH PRIVATE KEY-----'
      const passphrase1 = 'passphrase1'
      const privateKey2 = '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW\nQyNTUxOQAAACBmNkCQ0YDZiVJmHqMvK1PqjWxV4aRqK2Pm8RlV4aRqK2Pm8RlV4aRqK2Pm8RlV4\naRqK2Pm8RlV4aRqK2Pm8RlV4aRqK2Pm8RlV4aAAAAgBmNkCQ0YDZiVJmHqMvK1PqjWxV4aRqK2Pm8RlV4\naRqK2Pm8RlV4aRqK2Pm8RlV4aRqK2Pm8RlV4aAAAADHN0cmluZy1rZXktdGVzdAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4v\nMDEyMzQ1Njc4OTo7PD0+PkJGSk5SVlpeYmZqbnJ2en6ChoqOkpaanqKmqq6ytrq+wsbKztLW2t7i5uru8vb6/wMHCw8TFxsfIycrLzM3Oz9DR0tPU1dbX2Nna29zd3t/g4eLj\n5OXm5+jp6uvs7e7v8PHy8/T19vf4+fr7/P3+/w==\n-----END OPENSSH PRIVATE KEY-----'
      const passphrase2 = 'passphrase2'

      const credential1: GitCredential = {
        name: 'test-credential-1',
        host: 'github.com',
        type: 'ssh',
        sshPrivateKeyEncrypted: encryptSecret(privateKey1),
        hasPassphrase: true,
        passphrase: encryptSecret(passphrase1),
      }

      const credential2: GitCredential = {
        name: 'test-credential-2',
        host: 'gitlab.com',
        type: 'ssh',
        sshPrivateKeyEncrypted: encryptSecret(privateKey2),
        hasPassphrase: true,
        passphrase: encryptSecret(passphrase2),
      }

      await gitAuthService['setupSSHKey'](credential1)
      expect(gitAuthService['sshPassphrase']).toBe(passphrase1)

      await gitAuthService['setupSSHKey'](credential2)
      expect(gitAuthService['sshPassphrase']).toBe(passphrase2)
    })

    it('handles decryption errors gracefully', async () => {
      const credential: GitCredential = {
        name: 'test-credential',
        host: 'github.com',
        type: 'ssh',
        sshPrivateKeyEncrypted: 'invalid-encrypted-data',
        hasPassphrase: true,
        passphrase: encryptSecret('passphrase'),
      }

      await expect(gitAuthService['setupSSHKey'](credential)).rejects.toThrow()
    })
  })

  describe('getSSHEnvironment', () => {
    it('includes sshpass command when passphrase is available', async () => {
      const privateKey = '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW\nQyNTUxOQAAACBmNkCQ0YDZiVJmHqMvK1PqjWxV4aRqK2Pm8RlV4aRqK2Pm8RlV4aRqK2Pm8RlV4\naRqK2Pm8RlV4aRqK2Pm8RlV4aRqK2Pm8RlV4aAAAAgBmNkCQ0YDZiVJmHqMvK1PqjWxV4aRqK2Pm8RlV4\naRqK2Pm8RlV4aRqK2Pm8RlV4aRqK2Pm8RlV4aAAAADHN0cmluZy1rZXktdGVzdAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4v\nMDEyMzQ1Njc4OTo7PD0+P0BBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWltcXV5fYGFiY2RlZmdoaWpr\nbG1ub3BxcnN0dXZ3eHl6e3x9fn+AgYKDhIWGh4iJiouMjY6PkJGSk5SVlpeYmZqbnJ2en6ChoqOkpaan\nqKmqq6ytrq+wsbKztLW2t7i5uru8vb6/wMHCw8TFxsfIycrLzM3Oz9DR0tPU1dbX2Nna29zd3t/g4eLj\n5OXm5+jp6uvs7e7v8PHy8/T19vf4+fr7/P3+/w==\n-----END OPENSSH PRIVATE KEY-----'
      const passphrase = 'my-passphrase'
      
      const credential: GitCredential = {
        name: 'test-credential',
        host: 'github.com',
        type: 'ssh',
        sshPrivateKeyEncrypted: encryptSecret(privateKey),
        hasPassphrase: true,
        passphrase: encryptSecret(passphrase),
      }

      await gitAuthService['setupSSHKey'](credential)
      const env = gitAuthService['getSSHEnvironment']()

      expect(env.GIT_SSH_COMMAND).toContain('sshpass -e')
      expect(env.SSHPASS).toBe(passphrase)
    })

    it('does not include sshpass when passphrase is not available', async () => {
      const privateKey = '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW\nQyNTUxOQAAACBmNkCQ0YDZiVJmHqMvK1PqjWxV4aRqK2Pm8RlV4aRqK2Pm8RlV4aRqK2Pm8RlV4\naRqK2Pm8RlV4aRqK2Pm8RlV4aRqK2Pm8RlV4aAAAAgBmNkCQ0YDZiVJmHqMvK1PqjWxV4aRqK2Pm8RlV4\naRqK2Pm8RlV4aRqK2Pm8RlV4aRqK2Pm8RlV4aAAAADHN0cmluZy1rZXktdGVzdAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4v\nMDEyMzQ1Njc4OTo7PD0+PkJGSk5SVlpeYmZqbnJ2en6ChoqOkpaanqKmqq6ytrq+wsbKztLW2t7i5uru8vb6/wMHCw8TFxsfIycrLzM3Oz9DR0tPU1dbX2Nna29zd3t/g4eLj\n5OXm5+jp6uvs7e7v8PHy8/T19vf4+fr7/P3+/w==\n-----END OPENSSH PRIVATE KEY-----'
      
      const credential: GitCredential = {
        name: 'test-credential',
        host: 'github.com',
        type: 'ssh',
        sshPrivateKeyEncrypted: encryptSecret(privateKey),
        hasPassphrase: false,
      }

      await gitAuthService['setupSSHKey'](credential)
      const env = gitAuthService['getSSHEnvironment']()

      expect(env.GIT_SSH_COMMAND).not.toContain('sshpass')
    })

    it('returns empty object when no SSH key is set up', () => {
      const env = gitAuthService['getSSHEnvironment']()
      expect(env).toEqual({})
    })
  })

  describe('cleanupSSHKey', () => {
    it('clears passphrase from memory', async () => {
      const privateKey = '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW\nQyNTUxOQAAACBmNkCQ0YDZiVJmHqMvK1PqjWxV4aRqK2Pm8RlV4aRqK2Pm8RlV4aRqK2Pm8RlV4\naRqK2Pm8RlV4aRqK2Pm8RlV4aRqK2Pm8RlV4aRqK2Pm8RlV4aRqK2Pm8RlV4aAAAAgBmNkCQ0YDZ\niVJmHqMvK1PqjWxV4aRqK2Pm8RlV4aRqK2Pm8RlV4aRqK2Pm8RlV4aRqK2Pm8RlV4aAAAADHN0cmlu\nZy1rZXktdGVzdAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4v\nMDEyMzQ1Njc4OTo7PD0+P0BBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWltcXV5fYGFiY2RlZmdoaWpr\nbG1ub3BxcnN0dXZ3eHl6e3x9fn+AgYKDhIWGh4iJiouMjY6PkJGSk5SVlpeYmZqbnJ2en6ChoqOkpaan\nqKmqq6ytrq+wsbKztLW2t7i5uru8vb6/wMHCw8TFxsfIycrLzM3Oz9DR0tPU1dbX2Nna29zd3t/g4eLj\n5OXm5+jp6uvs7e7v8PHy8/T19vf4+fr7/P3+/w==\n-----END OPENSSH PRIVATE KEY-----'
      const passphrase = 'my-passphrase'
      
      const credential: GitCredential = {
        name: 'test-credential',
        host: 'github.com',
        type: 'ssh',
        sshPrivateKeyEncrypted: encryptSecret(privateKey),
        hasPassphrase: true,
        passphrase: encryptSecret(passphrase),
      }

      await gitAuthService['setupSSHKey'](credential)
      expect(gitAuthService['sshPassphrase']).toBe(passphrase)

      await gitAuthService['cleanupSSHKey']()
      expect(gitAuthService['sshPassphrase']).toBeNull()
    })

    it('clears passphrase and key path together', async () => {
      const privateKey = '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW\nQyNTUxOQAAACBmNkCQ0YDZiVJmHqMvK1PqjWxV4aRqK2Pm8RlV4aRqK2Pm8RlV4aRqK2Pm8RlV4\naRqK2Pm8RlV4aRqK2Pm8RlV4aRqK2Pm8RlV4aAAAAgBmNkCQ0YDZiVJmHqMvK1PqjWxV4aRqK2Pm8RlV4\naRqK2Pm8RlV4aRqK2Pm8RlV4aRqK2Pm8RlV4aAAAADHN0cmluZy1rZXktdGVzdAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4v\nMDEyMzQ1Njc4OTo7PD0+P0BBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWltcXV5fYGFiY2RlZmdoaWpr\nbG1ub3BxcnN0dXZ3eHl6e3x9fn+AgYKDhIWGh4iJiouMjY6PkJGSk5SVlpeYmZqbnJ2en6ChoqOkpaan\nqKmqq6ytrq+wsbKztLW2t7i5uru8vb6/wMHCw8TFxsfIycrLzM3Oz9DR0tPU1dbX2Nna29zd3t/g4eLj\n5OXm5+jp6uvs7e7v8PHy8/T19vf4+fr7/P3+/w==\n-----END OPENSSH PRIVATE KEY-----'
      const passphrase = 'my-passphrase'
      
      const credential: GitCredential = {
        name: 'test-credential',
        host: 'github.com',
        type: 'ssh',
        sshPrivateKeyEncrypted: encryptSecret(privateKey),
        hasPassphrase: true,
        passphrase: encryptSecret(passphrase),
      }

      await gitAuthService['setupSSHKey'](credential)
      expect(gitAuthService['sshPassphrase']).toBe(passphrase)
      expect(gitAuthService['sshKeyPath']).toBeTruthy()

      await gitAuthService['cleanupSSHKey']()
      expect(gitAuthService['sshPassphrase']).toBeNull()
      expect(gitAuthService['sshKeyPath']).toBeNull()
    })
  })

  describe('integration with passphrase-protected keys', () => {
    it('properly handles full SSH key lifecycle with passphrase', async () => {
      const privateKey = '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW\nQyNTUxOQAAACBmNkCQ0YDZiVJmHqMvK1PqjWxV4aRqK2Pm8RlV4aRqK2Pm8RlV4aRqK2Pm8RlV4\naRqK2Pm8RlV4aRqK2Pm8RlV4aRqK2Pm8RlV4aAAAAgBmNkCQ0YDZiVJmHqMvK1PqjWxV4aRqK2Pm8RlV4\naRqK2Pm8RlV4aRqK2Pm8RlV4aRqK2Pm8RlV4aAAAADHN0cmluZy1rZXktdGVzdAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4v\nMDEyMzQ1Njc4OTo7PD0+P0BBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWltcXV5fYGFiY2RlZmdoaWpr\nbG1ub3BxcnN0dXZ3eHl6e3x9fn+AgYKDhIWGh4iJiouMjY6PkJGSk5SVlpeYmZqbnJ2en6ChoqOkpaan\nqKmqq6ytrq+wsbKztLW2t7i5uru8vb6/wMHCw8TFxsfIycrLzM3Oz9DR0tPU1dbX2Nna29zd3t/g4eLj\n5OXm5+jp6uvs7e7v8PHy8/T19vf4+fr7/P3+/w==\n-----END OPENSSH PRIVATE KEY-----'
      const passphrase = 'secure-passphrase-123'
      
      const credential: GitCredential = {
        name: 'production-ssh',
        host: 'github.com',
        type: 'ssh',
        sshPrivateKeyEncrypted: encryptSecret(privateKey),
        hasPassphrase: true,
        passphrase: encryptSecret(passphrase),
      }

      await gitAuthService['setupSSHKey'](credential)
      
      expect(gitAuthService['sshPassphrase']).toBe(passphrase)
      expect(gitAuthService['sshKeyPath']).toBeTruthy()

      const env = gitAuthService['getSSHEnvironment']()
      expect(env.GIT_SSH_COMMAND).toContain('sshpass -e')
      expect(env.SSHPASS).toBe(passphrase)

      await gitAuthService['cleanupSSHKey']()
      
      expect(gitAuthService['sshPassphrase']).toBeNull()
      expect(gitAuthService['sshKeyPath']).toBeNull()
    })

    it('handles switching between credentials with and without passphrases', async () => {
      const validKey1 = '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW\nQyNTUxOQAAACBmNkCQ0YDZiVJmHqMvK1PqjWxV4aRqK2Pm8RlV4aRqK2Pm8RlV4aRqK2Pm8RlV4\naRqK2Pm8RlV4aRqK2Pm8RlV4aRqK2Pm8RlV4aAAAAgBmNkCQ0YDZiVJmHqMvK1PqjWxV4aRqK2Pm8RlV4\naRqK2Pm8RlV4aRqK2Pm8RlV4aRqK2Pm8RlV4aAAAADHN0cmluZy1rZXktdGVzdAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4v\nMDEyMzQ1Njc4OTo7PD0+P0BBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWltcXV5fYGFiY2RlZmdoaWpr\nbG1ub3BxcnN0dXZ3eHl6e3x9fn+AgYKDhIWGh4iJiouMjY6PkJGSk5SVlpeYmZqbnJ2en6ChoqOkpaan\nqKmqq6ytrq+wsbKztLW2t7i5uru8vb6/wMHCw8TFxsfIycrLzM3Oz9DR0tPU1dbX2Nna29zd3t/g4eLj\n5OXm5+jp6uvs7e7v8PHy8/T19vf4+fr7/P3+/w==\n-----END OPENSSH PRIVATE KEY-----'
      const validKey2 = '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW\nQyNTUxOQAAACBmNkCQ0YDZiVJmHqMvK1PqjWxV4aRqK2Pm8RlV4aRqK2Pm8RlV4aRqK2Pm8RlV4\naRqK2Pm8RlV4aRqK2Pm8RlV4aRqK2Pm8RlV4aAAAAgBmNkCQ0YDZiVJmHqMvK1PqjWxV4aRqK2Pm8RlV4\naRqK2Pm8RlV4aRqK2Pm8RlV4aRqK2Pm8RlV4aAAAADHN0cmluZy1rZXktdGVzdAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4v\nMDEyMzQ1Njc4OTo7PD0+P0BBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWltcXV5fYGFiY2RlZmdoaWpr\nbG1ub3BxcnN0dXZ3eHl6e3x9fn+AgYKDhIWGh4iJiouMjY6PkJGSk5SVlpeYmZqbnJ2en6ChoqOkpaan\nqKmqq6ytrq+wsbKztLW2t7i5uru8vb6/wMHCw8TFxsfIycrLzM3Oz9DR0tPU1dbX2Nna29zd3t/g4eLj\n5OXm5+jp6uvs7e7v8PHy8/T19vf4+fr7/P3+/w==\n-----END OPENSSH PRIVATE KEY-----'
      
      const credentialWithPassphrase: GitCredential = {
        name: 'ssh-with-pass',
        host: 'github.com',
        type: 'ssh',
        sshPrivateKeyEncrypted: encryptSecret(validKey1),
        hasPassphrase: true,
        passphrase: encryptSecret('pass1'),
      }

      const credentialWithoutPassphrase: GitCredential = {
        name: 'ssh-no-pass',
        host: 'gitlab.com',
        type: 'ssh',
        sshPrivateKeyEncrypted: encryptSecret(validKey2),
        hasPassphrase: false,
      }

      await gitAuthService['setupSSHKey'](credentialWithPassphrase)
      const env1 = gitAuthService['getSSHEnvironment']()
      expect(env1.GIT_SSH_COMMAND).toContain('sshpass -e')
      expect(env1.SSHPASS).toBe('pass1')

      await gitAuthService['cleanupSSHKey']()

      await gitAuthService['setupSSHKey'](credentialWithoutPassphrase)
      const env2 = gitAuthService['getSSHEnvironment']()
      expect(env2.GIT_SSH_COMMAND).not.toContain('sshpass')
      expect(env2.SSHPASS).toBeUndefined()

      await gitAuthService['cleanupSSHKey']()
    })
  })
})
