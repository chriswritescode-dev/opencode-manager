import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Database } from 'bun:sqlite'
import * as crypto from 'crypto'
import * as fs from 'fs/promises'
import * as path from 'path'

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
  getWorkspacePath: vi.fn(() => '/tmp/test-workspace'),
  getReposPath: vi.fn(() => '/tmp/test-repos'),
}))

let testWorkspacePath: string = '/tmp/test-workspace'

const mockPrepare = vi.fn()
const mockExec = vi.fn()
const mockDatabase = {
  prepare: mockPrepare,
  exec: mockExec,
} as unknown as Database

vi.mock('bun:sqlite', () => ({
  Database: vi.fn(() => mockDatabase),
}))

import { SSHHostKeyHandler, createSSHHostKeyHandler } from '../../src/ipc/sshHostKeyHandler'

describe('SSHHostKeyHandler', () => {
  let handler: SSHHostKeyHandler
  let knownHostsPath: string

  beforeEach(async () => {
    vi.clearAllMocks()
    
    const uniqueId = crypto.randomUUID()
    testWorkspacePath = `/tmp/test-workspace-${uniqueId}`
    
    mockPrepare.mockReturnValue({
      run: vi.fn(),
      get: vi.fn().mockReturnValue(null),
      all: vi.fn().mockReturnValue([]),
    })
    
    const configDir = `${testWorkspacePath}/config`
    await fs.mkdir(configDir, { recursive: true })
    const knownHostsFile = path.join(configDir, 'known_hosts')
    await fs.writeFile(knownHostsFile, '', { mode: 0o600 })
    
    handler = createSSHHostKeyHandler(mockDatabase, 5000)
    await handler.initialize()
    knownHostsPath = handler.getKnownHostsPath()
  })

  afterEach(async () => {
    vi.clearAllMocks()
    await fs.rm(testWorkspacePath, { recursive: true, force: true }).catch(() => {})
  })

  describe('Public Key Retrieval', () => {
    it('should store public key instead of fingerprint', async () => {
      const host = 'test.example.com'
      const publicKey = `${host} ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIQQ/test@example.com`
      
      await handler['addToKnownHosts'](host, publicKey)
      
      const content = await fs.readFile(knownHostsPath, 'utf-8')
      expect(content).toContain(publicKey)
      expect(content).not.toContain('SHA256:')
    })

    it('should store public key in database', () => {
      const host = 'test.example.com'
      const publicKey = `${host} ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIQQ/test@example.com`
      
      const mockRun = vi.fn()
      mockPrepare.mockReturnValue({ run: mockRun })
      
      handler['saveTrustedHost'](host, publicKey)
      
      expect(mockPrepare).toHaveBeenCalled()
      expect(mockRun).toHaveBeenCalled()
    })
  })

  describe('Host:Port Handling', () => {
    it('should handle hosts with non-standard ports', async () => {
      const host = 'github.com:2222'
      const publicKey = `[github.com]:2222 ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQDRHw== test@host`
      
      await handler['addToKnownHosts'](host, publicKey)
      
      const content = await fs.readFile(knownHostsPath, 'utf-8')
      expect(content).toContain('[github.com]:2222')
    })

    it('should handle hosts with standard port 22', async () => {
      const host = 'github.com'
      const publicKey = `${host} ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQDRHw== test@host`
      
      await handler['addToKnownHosts'](host, publicKey)
      
      const content = await fs.readFile(knownHostsPath, 'utf-8')
      expect(content).toContain(`${host} ssh-rsa`)
      expect(content).not.toContain(':22')
    })
  })

  describe('Load from Database', () => {
    it('should load public keys from database to known_hosts', async () => {
      const host1 = 'github.com'
      const host2 = 'gitlab.com:2222'
      const publicKey1 = `${host1} ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQDRHw== test@host`
      const publicKey2 = `[gitlab.com]:2222 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIQQ/test@example.com`
      
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([
          { host: host1, public_key: publicKey1 },
          { host: host2, public_key: publicKey2 },
        ]),
      })
      
      await handler['loadFromDatabaseToKnownHosts']()
      
      const content = await fs.readFile(knownHostsPath, 'utf-8')
      expect(content).toContain(publicKey1)
      expect(content).toContain(publicKey2)
    })
  })

  describe('SSH Key Format Support', () => {
    const keyFormats = [
      {
        type: 'RSA public',
        key: 'github.com ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQDRHw== test@host'
      },
      {
        type: 'ED25519 public',
        key: 'github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIQQ/test@example.com'
      },
      {
        type: 'ECDSA public',
        key: 'github.com ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBEM/test@test.com'
      }
    ]

    keyFormats.forEach(({ type, key }) => {
      it(`should support ${type}`, async () => {
        await handler['addToKnownHosts']('testhost', key)
        
        const content = await fs.readFile(knownHostsPath, 'utf-8')
        const keyType = key.split(' ')[1]
        if (keyType) {
          expect(content).toContain(keyType)
        }
      })
    })
  })

  describe('Known Hosts File Format', () => {
    it('should write proper known_hosts format', async () => {
      const host = 'github.com'
      const keyType = 'ssh-rsa'
      const keyData = 'AAAAB3NzaC1yc2EAAAADAQABAAABAQDRHw=='
      const publicKey = `${host} ${keyType} ${keyData}`
      
      await handler['addToKnownHosts'](host, publicKey)
      
      const content = await fs.readFile(knownHostsPath, 'utf-8')
      const lines = content.trim().split('\n')
      
      expect(lines.length).toBe(1)
      const firstLine = lines[0]
      if (firstLine) {
        const parts = firstLine.split(' ')
        expect(parts.length).toBeGreaterThanOrEqual(3)
        expect(parts[0]).toBe(host)
        expect(parts[1]).toBe(keyType)
        expect(parts[2]).toBe(keyData)
      }
    })

    it('should handle bracketed host notation for non-standard ports', async () => {
      const host = 'github.com:2222'
      const publicKey = '[github.com]:2222 ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQDRHw== test@host'
      
      await handler['addToKnownHosts'](host, publicKey)
      
      const content = await fs.readFile(knownHostsPath, 'utf-8')
      expect(content).toContain('[github.com]:2222')
    })
  })

  describe('getEnv', () => {
    it('should return known hosts path in environment', () => {
      const env = handler.getEnv()
      expect(env.KNOWN_HOSTS_PATH).toBe(knownHostsPath)
    })
  })

  describe('verifyHostKeyBeforeOperation', () => {
    it('should return true immediately for trusted host in DB', async () => {
      mockPrepare.mockReturnValue({
        run: vi.fn(),
        get: vi.fn().mockReturnValue({ key_type: 'ssh-rsa', public_key: 'github.com ssh-rsa AAAAB...' }),
        all: vi.fn().mockReturnValue([])
      })

      const result = await handler.verifyHostKeyBeforeOperation('git@github.com:user/repo.git')

      expect(result).toBe(true)
    })

    it('should return false on ssh-keyscan command failure', async () => {
      mockPrepare.mockReturnValue({
        run: vi.fn(),
        get: vi.fn().mockReturnValue(null),
        all: vi.fn().mockReturnValue([])
      })

      const result = await handler.verifyHostKeyBeforeOperation('git@invalid-host.example:user/repo.git')

      expect(result).toBe(false)
    })
  })

  describe('respond', () => {
    it('should return error for non-existent request', async () => {
      const result = await handler.respond({
        requestId: 'non-existent-id',
        response: 'accept'
      })

      expect(result.success).toBe(false)
      expect(result.error).toBe('Request not found or expired')
    })
  })

  describe('getPendingCount', () => {
    it('should return 0 when no pending requests', () => {
      const count = handler.getPendingCount()
      expect(count).toBe(0)
    })
  })

  describe('Error Scenarios', () => {
    it('should handle database query failures gracefully in getTrustedHost', () => {
      mockPrepare.mockImplementation(() => {
        throw new Error('Database connection failed')
      })

      const result = handler['getTrustedHost']('github.com')

      expect(result).toBeNull()
    })

    it('should handle database save failures gracefully', () => {
      const mockRun = vi.fn().mockImplementation(() => {
        throw new Error('Database write failed')
      })
      mockPrepare.mockReturnValue({
        run: mockRun,
        get: vi.fn().mockReturnValue(null),
        all: vi.fn().mockReturnValue([])
      })

      expect(() => {
        handler['saveTrustedHost']('github.com', 'github.com ssh-rsa AAAAB...')
      }).not.toThrow()
    })

    it('should handle known_hosts file write failures gracefully', async () => {
      const originalPath = handler['knownHostsPath']
      handler['knownHostsPath'] = '/nonexistent/path/known_hosts'

      await expect(handler['addToKnownHosts']('github.com', 'github.com ssh-rsa AAAAB...')).resolves.toBeUndefined()

      handler['knownHostsPath'] = originalPath
    })
  })
})
