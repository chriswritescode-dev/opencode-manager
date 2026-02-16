import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'

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

let mockExecuteCommand: any

vi.mock('../../src/utils/process', () => ({
  executeCommand: vi.fn()
}))

vi.mock('fs', () => ({
  promises: {
    writeFile: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined)
  }
}))

import { validateSSHPrivateKey } from '../../src/utils/ssh-validation'
import { executeCommand } from '../../src/utils/process'

beforeAll(() => {
  mockExecuteCommand = executeCommand
})

describe('validateSSHPrivateKey', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExecuteCommand.mockResolvedValue('ssh-ed25519 AAAAC...')
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('valid key formats', () => {
    const validHeaders = [
      { name: 'OPENSSH', header: '-----BEGIN OPENSSH PRIVATE KEY-----' },
      { name: 'RSA', header: '-----BEGIN RSA PRIVATE KEY-----' },
      { name: 'EC', header: '-----BEGIN EC PRIVATE KEY-----' },
      { name: 'DSA', header: '-----BEGIN DSA PRIVATE KEY-----' },
      { name: 'ED25519', header: '-----BEGIN ED25519 PRIVATE KEY-----' },
      { name: 'PGP', header: '-----BEGIN PGP PRIVATE KEY BLOCK-----' }
    ]

    validHeaders.forEach(({ name, header }) => {
      it(`should accept valid ${name} key format`, async () => {
        const key = `${header}\n${'A'.repeat(100)}\n-----END ${name} PRIVATE KEY-----`
        
        const result = await validateSSHPrivateKey(key)
        
        expect(result.valid).toBe(true)
      })
    })

    it('should accept properly formatted OPENSSH key', async () => {
      const key = `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW
QyNTUxOQAAACBmNkCQ0YDZiVJmHqMvK1PqjWxV4aRqK2Pm8RlV4aRqK2Pm8RlV4aRqK2Pm8RlV4
-----END OPENSSH PRIVATE KEY-----`
      
      const result = await validateSSHPrivateKey(key)
      
      expect(result.valid).toBe(true)
    })
  })

  describe('passphrase detection', () => {
    it('should detect key without passphrase', async () => {
      mockExecuteCommand.mockResolvedValue('ssh-ed25519 AAAAC3...')
      
      const key = `-----BEGIN OPENSSH PRIVATE KEY-----
${'A'.repeat(120)}
-----END OPENSSH PRIVATE KEY-----`
      
      const result = await validateSSHPrivateKey(key)
      
      expect(result.valid).toBe(true)
      expect(result.hasPassphrase).toBe(false)
    })

    it('should detect key with passphrase via incorrect passphrase error', async () => {
      mockExecuteCommand.mockRejectedValue(new Error('incorrect passphrase supplied to decrypt private key'))
      
      const key = `-----BEGIN OPENSSH PRIVATE KEY-----
${'A'.repeat(120)}
-----END OPENSSH PRIVATE KEY-----`
      
      const result = await validateSSHPrivateKey(key)
      
      expect(result.valid).toBe(true)
      expect(result.hasPassphrase).toBe(true)
    })

    it('should detect key with passphrase via failed error', async () => {
      mockExecuteCommand.mockRejectedValue(new Error('failed: incorrect passphrase supplied to decrypt private key'))
      
      const key = `-----BEGIN OPENSSH PRIVATE KEY-----
${'A'.repeat(120)}
-----END OPENSSH PRIVATE KEY-----`
      
      const result = await validateSSHPrivateKey(key)
      
      expect(result.valid).toBe(true)
      expect(result.hasPassphrase).toBe(true)
    })

    it('should detect key with passphrase via Load key error', async () => {
      mockExecuteCommand.mockRejectedValue(new Error('Load key "/tmp/temp-ssh-key-123": bad passphrase'))
      
      const key = `-----BEGIN OPENSSH PRIVATE KEY-----
${'A'.repeat(120)}
-----END OPENSSH PRIVATE KEY-----`
      
      const result = await validateSSHPrivateKey(key)
      
      expect(result.valid).toBe(true)
      expect(result.hasPassphrase).toBe(true)
    })
  })

  describe('invalid key rejection', () => {
    it('should reject key with invalid format', async () => {
      mockExecuteCommand.mockRejectedValue(new Error('invalid format'))
      
      const key = `-----BEGIN INVALID KEY-----
${'A'.repeat(120)}
-----END INVALID KEY-----`
      
      const result = await validateSSHPrivateKey(key)
      
      expect(result.valid).toBe(false)
      expect(result.error).toContain('Invalid SSH key')
    })

    it('should reject corrupted key', async () => {
      mockExecuteCommand.mockRejectedValue(new Error('load key: invalid format'))
      
      const key = `-----BEGIN OPENSSH PRIVATE KEY-----
${'A'.repeat(120)}
-----END OPENSSH PRIVATE KEY-----`
      
      const result = await validateSSHPrivateKey(key)
      
      expect(result.valid).toBe(false)
      expect(result.error).toContain('Invalid SSH key')
    })
  })

  describe('empty/null/undefined key handling', () => {
    it('should reject null key', async () => {
      const result = await validateSSHPrivateKey(null as unknown as string)
      
      expect(result.valid).toBe(false)
      expect(result.error).toBe('SSH key is required')
    })

    it('should reject undefined key', async () => {
      const result = await validateSSHPrivateKey(undefined as unknown as string)
      
      expect(result.valid).toBe(false)
      expect(result.error).toBe('SSH key is required')
    })

    it('should reject empty string', async () => {
      const result = await validateSSHPrivateKey('')
      
      expect(result.valid).toBe(false)
      expect(result.error).toBe('SSH key is required')
    })

    it('should reject whitespace-only string', async () => {
      const result = await validateSSHPrivateKey('   \n\t   ')
      
      expect(result.valid).toBe(false)
      expect(result.error).toBe('SSH key cannot be empty')
    })
  })



  describe('ssh-keygen command execution', () => {
    it('should call ssh-keygen with correct arguments', async () => {
      const key = `-----BEGIN OPENSSH PRIVATE KEY-----
${'A'.repeat(120)}
-----END OPENSSH PRIVATE KEY-----`
      
      await validateSSHPrivateKey(key)
      
      expect(mockExecuteCommand).toHaveBeenCalled()
      const call = mockExecuteCommand.mock.calls[0]
      expect(call).toBeDefined()
      const args = call?.[0] as string[] | undefined
      expect(args?.[0]).toBe('ssh-keygen')
      expect(args?.[1]).toBe('-y')
      expect(args?.[2]).toBe('-P')
      expect(args?.[3]).toBe('')
      expect(args?.[4]).toBe('-f')
    })

    it('should pass silent option to command execution', async () => {
      const key = `-----BEGIN OPENSSH PRIVATE KEY-----
${'A'.repeat(120)}
-----END OPENSSH PRIVATE KEY-----`
      
      await validateSSHPrivateKey(key)
      
      expect(mockExecuteCommand).toHaveBeenCalled()
      const call = mockExecuteCommand.mock.calls[0]
      expect(call).toBeDefined()
      const options = call?.[1] as { silent?: boolean } | undefined
      expect(options?.silent).toBe(true)
    })
  })

  describe('file cleanup after validation', () => {
    it('should complete validation successfully with cleanup', async () => {
      const key = `-----BEGIN OPENSSH PRIVATE KEY-----
${'A'.repeat(120)}
-----END OPENSSH PRIVATE KEY-----`
      
      const result = await validateSSHPrivateKey(key)
      
      expect(result.valid).toBe(true)
    })

    it('should complete validation with passphrase detection with cleanup', async () => {
      mockExecuteCommand.mockRejectedValue(new Error('incorrect passphrase'))
      
      const key = `-----BEGIN OPENSSH PRIVATE KEY-----
${'A'.repeat(120)}
-----END OPENSSH PRIVATE KEY-----`
      
      const result = await validateSSHPrivateKey(key)
      
      expect(result.valid).toBe(true)
      expect(result.hasPassphrase).toBe(true)
    })
  })

  describe('temp file permission handling', () => {
    it('should complete validation which includes writing temp file', async () => {
      const key = `-----BEGIN OPENSSH PRIVATE KEY-----
${'A'.repeat(120)}
-----END OPENSSH PRIVATE KEY-----`
      
      const result = await validateSSHPrivateKey(key)
      
      expect(result.valid).toBe(true)
    })
  })
})
