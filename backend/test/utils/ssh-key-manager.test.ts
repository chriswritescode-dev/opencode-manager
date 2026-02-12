import { describe, it, expect } from 'vitest'
import * as fs from 'fs/promises'
import { join } from 'path'
import { parseSSHHost, normalizeHostPort, parseHostPort, writeTemporarySSHKey, cleanupSSHKey, cleanupAllSSHKeys } from '../../src/utils/ssh-key-manager'
import { getWorkspacePath } from '@opencode-manager/shared/config/env'

describe('SSH Host Parsing', () => {
  it('should parse git@host:path format', () => {
    const result = parseSSHHost('git@github.com:user/repo.git')
    expect(result.user).toBe('git')
    expect(result.host).toBe('github.com')
    expect(result.port).toBe('22')
  })

  it('should parse ssh:// format', () => {
    const result = parseSSHHost('ssh://git@gitlab.com/user/repo.git')
    expect(result.user).toBe('git')
    expect(result.host).toBe('gitlab.com')
    expect(result.port).toBe('22')
  })

  it('should parse ssh:// with custom port', () => {
    const result = parseSSHHost('ssh://git@git.example.com:2222/user/repo.git')
    expect(result.user).toBe('git')
    expect(result.host).toBe('git.example.com')
    expect(result.port).toBe('2222')
  })

  it('should parse git@host:port:path format', () => {
    const result = parseSSHHost('git@github.com:22:user/repo.git')
    expect(result.user).toBe('git')
    expect(result.host).toBe('github.com')
    expect(result.port).toBe('22')
  })

  it('should normalize host:port for non-standard ports', () => {
    expect(normalizeHostPort('github.com', '2222')).toBe('github.com:2222')
    expect(normalizeHostPort('github.com', '22')).toBe('github.com')
    expect(normalizeHostPort('github.com', undefined)).toBe('github.com')
  })

  it('should parse host:port strings', () => {
    expect(parseHostPort('github.com:2222')).toEqual({ host: 'github.com', port: '2222' })
    expect(parseHostPort('github.com')).toEqual({ host: 'github.com', port: '22' })
  })
})

describe('SSH Key Validation', () => {
  describe('RSA Keys', () => {
    const rsaKey = `-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEAzR8u8I5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5
-----END RSA PRIVATE KEY-----`

    it('should accept RSA private key', async () => {
      const keyPath = await writeTemporarySSHKey(rsaKey, 'test-rsa')
      expect(keyPath).toBeTruthy()
      
      const stats = await fs.stat(keyPath)
      const mode = stats.mode & 0o777
      expect(mode).toBe(0o600)
      
      await cleanupSSHKey(keyPath)
    })

    it('should accept RSA public key', async () => {
      const rsaPublicKey = 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQDRHw== test@host'
      const keyPath = await writeTemporarySSHKey(rsaPublicKey, 'test-rsa-pub')
      expect(keyPath).toBeTruthy()
      await cleanupSSHKey(keyPath)
    })
  })

  describe('ED25519 Keys', () => {
    const ed25519Key = `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW
-----END OPENSSH PRIVATE KEY-----`

    it('should accept ED25519 private key', async () => {
      const keyPath = await writeTemporarySSHKey(ed25519Key, 'test-ed25519')
      expect(keyPath).toBeTruthy()
      await cleanupSSHKey(keyPath)
    })

    it('should accept ED25519 public key', async () => {
      const ed25519PublicKey = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIQQ/test@test.com'
      const keyPath = await writeTemporarySSHKey(ed25519PublicKey, 'test-ed25519-pub')
      expect(keyPath).toBeTruthy()
      await cleanupSSHKey(keyPath)
    })
  })

  describe('ECDSA Keys', () => {
    const ecdsaKey = `-----BEGIN EC PRIVATE KEY-----
MHcCAQEEIP5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5
-----END EC PRIVATE KEY-----`

    it('should accept ECDSA private key', async () => {
      const keyPath = await writeTemporarySSHKey(ecdsaKey, 'test-ecdsa')
      expect(keyPath).toBeTruthy()
      await cleanupSSHKey(keyPath)
    })

    it('should accept ECDSA public key', async () => {
      const ecdsaPublicKey = 'ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBEM/test@test.com'
      const keyPath = await writeTemporarySSHKey(ecdsaPublicKey, 'test-ecdsa-pub')
      expect(keyPath).toBeTruthy()
      await cleanupSSHKey(keyPath)
    })
  })

  it('should reject invalid key format', async () => {
    const invalidKey = 'not a valid ssh key'
    await expect(writeTemporarySSHKey(invalidKey, 'test-invalid')).rejects.toThrow('Invalid SSH key format')
  })

  it('should reject empty key', async () => {
    const emptyKey = ''
    await expect(writeTemporarySSHKey(emptyKey, 'test-empty')).rejects.toThrow('Invalid SSH key format')
  })

  it('should set correct permissions on key file', async () => {
    const validKey = 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQDRHw== test@host'
    const keyPath = await writeTemporarySSHKey(validKey, 'test-perms')
    
    const stats = await fs.stat(keyPath)
    const mode = stats.mode & 0o777
    expect(mode).toBe(0o600)
    
    await cleanupSSHKey(keyPath)
  })
})

describe('SSH Key Cleanup', () => {
  it('should clean up individual key', async () => {
    const key = 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQDRHw== test@host'
    const keyPath = await writeTemporarySSHKey(key, 'test-cleanup')
    
    await cleanupSSHKey(keyPath)
    
    await expect(fs.access(keyPath)).rejects.toThrow()
  })

  it('should clean up all keys', async () => {
    const key1 = 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQDRHw== test1@host'
    const key2 = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIQQ/test2@test.com'
    
    await writeTemporarySSHKey(key1, 'test-cleanup-1')
    await writeTemporarySSHKey(key2, 'test-cleanup-2')
    
    await cleanupAllSSHKeys()
  })

   it('should handle cleanup of non-existent file gracefully', async () => {
     const nonExistentPath = '/tmp/non-existent-ssh-key-12345'
     
     await cleanupSSHKey(nonExistentPath)
   })

   it('should handle cleanup of already cleaned up file gracefully', async () => {
     const key = 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQDRHw== test@host'
     const keyPath = await writeTemporarySSHKey(key, 'test-double-cleanup')
     
     await cleanupSSHKey(keyPath)
     await cleanupSSHKey(keyPath)
   })
 })
