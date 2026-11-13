import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs/promises'
import { join } from 'node:path'
import type { TempWorkspace } from '../helpers/test-env'
import { createTempWorkspace } from '../helpers/test-env'
import {
  cleanupAllSSHKeys,
  cleanupSSHKey,
  normalizeHostPort,
  parseHostPort,
  parseSSHHost,
  writeTemporarySSHKey,
} from '../../src/utils/ssh-key-manager'

let workspace: TempWorkspace

beforeEach(() => {
  workspace = createTempWorkspace('ocm-ssh-key-test-')
})

afterEach(() => {
  workspace.restore()
})

describe('parseSSHHost', () => {
  it.each([
    ['git@github.com:user/repo.git', { user: 'git', host: 'github.com', port: '22' }],
    ['ssh://git@gitlab.com/user/repo.git', { user: 'git', host: 'gitlab.com', port: '22' }],
    ['ssh://git@git.example.com:2222/user/repo.git', { user: 'git', host: 'git.example.com', port: '2222' }],
    ['git@github.com:22:user/repo.git', { user: 'git', host: 'github.com', port: '22' }],
  ])('parses %s', (input, expected) => {
    expect(parseSSHHost(input)).toEqual(expected)
  })

  it('normalizes host:port for non-standard ports', () => {
    expect(normalizeHostPort('github.com', '2222')).toBe('github.com:2222')
    expect(normalizeHostPort('github.com', '22')).toBe('github.com')
    expect(normalizeHostPort('github.com', undefined)).toBe('github.com')
  })

  it('parses host:port strings', () => {
    expect(parseHostPort('github.com:2222')).toEqual({ host: 'github.com', port: '2222' })
    expect(parseHostPort('github.com')).toEqual({ host: 'github.com', port: '22' })
  })
})

const VALID_KEYS = [
  ['RSA private', '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEAzR8u8I5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5\n-----END RSA PRIVATE KEY-----'],
  ['RSA public', 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQDRHw== test@host'],
  ['ED25519 private', '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW\n-----END OPENSSH PRIVATE KEY-----'],
  ['ED25519 public', 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIQQ/test@test.com'],
  ['ECDSA private', '-----BEGIN EC PRIVATE KEY-----\nMHcCAQEEIP5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z\n-----END EC PRIVATE KEY-----'],
  ['ECDSA public', 'ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBEM/test@test.com'],
] as const

describe('writeTemporarySSHKey', () => {
  it.each(VALID_KEYS)('accepts a %s key', async (_label, key) => {
    const keyPath = await writeTemporarySSHKey(key, 'test-key')

    expect(keyPath.startsWith(join(workspace.path, '.ssh-keys'))).toBe(true)
    await expect(fs.readFile(keyPath, 'utf-8')).resolves.toContain(key.split('\n')[0])
  })

  it('writes the key with owner-only permissions', async () => {
    const keyPath = await writeTemporarySSHKey(VALID_KEYS[1][1], 'test-perms')

    const stats = await fs.stat(keyPath)
    expect(stats.mode & 0o777).toBe(0o600)
  })

  it.each([
    ['an invalid key', 'not a valid ssh key'],
    ['an empty key', ''],
  ])('rejects %s', async (_label, key) => {
    await expect(writeTemporarySSHKey(key, 'test-invalid')).rejects.toThrow('Invalid SSH key format')
  })

  it('removes the file it wrote when the key is invalid', async () => {
    await expect(writeTemporarySSHKey('not a valid ssh key', 'test-invalid')).rejects.toThrow()
    await expect(fs.readdir(join(workspace.path, '.ssh-keys'))).resolves.toEqual([])
  })
})

describe('SSH key cleanup', () => {
  it('removes an individual key', async () => {
    const keyPath = await writeTemporarySSHKey(VALID_KEYS[1][1], 'test-cleanup')

    await cleanupSSHKey(keyPath)

    await expect(fs.access(keyPath)).rejects.toThrow()
  })

  it('removes every key it wrote', async () => {
    const first = await writeTemporarySSHKey(VALID_KEYS[3][1], 'test-cleanup-1')
    const second = await writeTemporarySSHKey(VALID_KEYS[4][1], 'test-cleanup-2')

    await cleanupAllSSHKeys()

    await expect(fs.access(first)).rejects.toThrow()
    await expect(fs.access(second)).rejects.toThrow()
  })

  it('tolerates a missing file', async () => {
    await expect(cleanupSSHKey(join(workspace.path, 'missing-key'))).resolves.toBeUndefined()
  })

  it('tolerates cleaning up the same key twice', async () => {
    const keyPath = await writeTemporarySSHKey(VALID_KEYS[1][1], 'test-double-cleanup')

    await cleanupSSHKey(keyPath)

    await expect(cleanupSSHKey(keyPath)).resolves.toBeUndefined()
  })
})
