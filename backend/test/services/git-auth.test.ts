import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import type { Database } from 'bun:sqlite'
import type { GitCredential } from '@opencode-manager/shared'
import { GitAuthService } from '../../src/services/git-auth'
import { encryptSecret } from '../../src/utils/crypto'
import { createTestDatabase } from '../helpers/test-database'

const PRIVATE_KEY = `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW
QyNTUxOQAAACBmNkCQ0YDZiVJmHqMvK1PqjWxV4aRqK2Pm8RlV4aRqK2Pm8RlV4aRqK2Pm8RlV4
aRqK2Pm8RlV4aRqK2Pm8RlV4aRqK2Pm8RlV4aAAAAgBmNkCQ0YDZiVJmHqMvK1PqjWxV4aRqK2Pm8RlV4
aRqK2Pm8RlV4aRqK2Pm8RlV4aRqK2Pm8RlV4aAAAADHN0cmluZy1rZXktdGVzdAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4v
MDEyMzQ1Njc4OTo7PD0+P0BBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWltcXV5fYGFiY2RlZmdoaWpr
bG1ub3BxcnN0dXZ3eHl6e3x9fn+AgYKDhIWGh4iJiouMjY6PkJGSk5SVlpeYmZqbnJ2en6ChoqOkpaan
qKmqq6ytrq+wsbKztLW2t7i5uru8vb6/wMHCw8TFxsfIycrLzM3Oz9DR0tPU1dbX2Nna29zd3t/g4eLj
5OXm5+jp6uvs7e7v8PHy8/T19vf4+fr7/P3+/w==
-----END OPENSSH PRIVATE KEY-----`

function sshCredential(overrides: Partial<GitCredential> = {}): GitCredential {
  return {
    name: 'test-credential',
    host: 'github.com',
    type: 'ssh',
    sshPrivateKeyEncrypted: encryptSecret(PRIVATE_KEY),
    ...overrides,
  }
}

function keyPathFrom(command: string | undefined): string | null {
  const match = command?.match(/-i "([^"]+)"/)
  return match?.[1] ?? null
}

describe('GitAuthService SSH key setup', () => {
  let db: Database
  let service: GitAuthService

  beforeEach(async () => {
    db = createTestDatabase()
    service = new GitAuthService()
    await service.initialize(undefined, db)
  })

  afterEach(async () => {
    await service.cleanupSSHKey()
    db.close()
  })

  it('writes the decrypted key and builds an sshpass command when the credential has a passphrase', async () => {
    const passphrase = 'my-secret-passphrase'

    await service.setupSSHKey(sshCredential({ hasPassphrase: true, passphrase: encryptSecret(passphrase) }))

    const env = service.getSSHEnvironment()
    const keyPath = keyPathFrom(env.GIT_SSH_COMMAND)
    expect(keyPath).not.toBeNull()
    expect(existsSync(keyPath!)).toBe(true)
    expect(env.GIT_SSH_COMMAND).toContain('sshpass -e')
    expect(env.SSHPASS).toBe(passphrase)
  })

  it('writes the key without sshpass when the credential has no passphrase', async () => {
    await service.setupSSHKey(sshCredential({ hasPassphrase: false }))

    const env = service.getSSHEnvironment()
    expect(keyPathFrom(env.GIT_SSH_COMMAND)).not.toBeNull()
    expect(env.GIT_SSH_COMMAND).not.toContain('sshpass')
    expect(env.SSHPASS).toBeUndefined()
  })

  it('switches to the passphrase of the newest credential', async () => {
    await service.setupSSHKey(sshCredential({
      name: 'ssh-with-pass',
      hasPassphrase: true,
      passphrase: encryptSecret('pass1'),
    }))
    expect(service.getSSHEnvironment().SSHPASS).toBe('pass1')

    await service.setupSSHKey(sshCredential({
      name: 'ssh-no-pass',
      hasPassphrase: false,
    }))
    expect(service.getSSHEnvironment().GIT_SSH_COMMAND).not.toContain('sshpass')

    await service.setupSSHKey(sshCredential({
      name: 'ssh-with-pass-2',
      hasPassphrase: true,
      passphrase: encryptSecret('pass2'),
    }))
    expect(service.getSSHEnvironment().SSHPASS).toBe('pass2')
  })

  it('rejects a credential whose encrypted key cannot be decrypted', async () => {
    await expect(service.setupSSHKey(sshCredential({ sshPrivateKeyEncrypted: 'invalid-encrypted-data' }))).rejects.toThrow()
  })

  it('removes the key file and clears the environment on cleanup', async () => {
    await service.setupSSHKey(sshCredential({ hasPassphrase: true, passphrase: encryptSecret('my-passphrase') }))
    const keyPath = keyPathFrom(service.getSSHEnvironment().GIT_SSH_COMMAND)
    expect(keyPath).not.toBeNull()

    await service.cleanupSSHKey()

    expect(existsSync(keyPath!)).toBe(false)
    expect(keyPathFrom(service.getSSHEnvironment().GIT_SSH_COMMAND)).toBeNull()
    expect(service.getSSHEnvironment().SSHPASS).toBeUndefined()
  })

  it('ignores a PAT credential', async () => {
    await service.setupSSHKey({ name: 'pat', host: 'github.com', type: 'pat', token: 'ghp_token' })

    expect(keyPathFrom(service.getSSHEnvironment().GIT_SSH_COMMAND)).toBeNull()
  })

  it('returns no key command before a key is set up', () => {
    expect(keyPathFrom(service.getSSHEnvironment().GIT_SSH_COMMAND)).toBeNull()
  })
})
