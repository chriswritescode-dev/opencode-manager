import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'bun:sqlite'
import * as fs from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { GitCredential } from '@opencode-manager/shared'
import type { TempWorkspace } from '../helpers/test-env'
import { createTempWorkspace } from '../helpers/test-env'
import { createTestDatabase } from '../helpers/test-database'
import { createIPCServer } from '../../src/ipc/ipcServer'
import type { IPCServer } from '../../src/ipc/ipcServer'
import { GitAuthService } from '../../src/services/git-auth'
import { encryptSecret } from '../../src/utils/crypto'

const SSH_KEY = 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQDRHw== test@host'

let workspace: TempWorkspace
let db: Database
let ipcServer: IPCServer

function encryptedKeyCredential(passphrase?: string): GitCredential {
  const credential: GitCredential = {
    name: 'deploy',
    host: 'github.com',
    type: 'ssh',
    sshPrivateKeyEncrypted: encryptSecret(SSH_KEY),
  }
  if (passphrase !== undefined) {
    credential.passphrase = encryptSecret(passphrase)
  }
  return credential
}

function sshKeyPathFromCommand(command: string | undefined): string {
  const match = command?.match(/-i "([^"]+)"/)
  if (!match?.[1]) throw new Error(`no ssh key path in command: ${command ?? '(none)'}`)
  return match[1]
}

beforeEach(async () => {
  workspace = createTempWorkspace('ocm-ssh-integration-')
  db = createTestDatabase()
  ipcServer = await createIPCServer(randomUUID())
})

afterEach(async () => {
  await ipcServer.dispose()
  await fs.unlink(ipcServer.ipcHandlePath).catch(() => {})
  db.close()
  workspace.restore()
})

describe('GitAuthService SSH wiring', () => {
  it('registers the askpass and host key handlers on the IPC server', async () => {
    const service = new GitAuthService()

    await service.initialize(ipcServer, db)

    expect(service.sshHostKeyHandler).not.toBeNull()
    expect(ipcServer.getHandler('ssh-host-key')).toBe(service.sshHostKeyHandler)
    expect(ipcServer.getHandler('askpass')).toBeDefined()
    expect(service.sshHostKeyHandler?.getKnownHostsPath()).toBe(join(workspace.path, 'config', 'known_hosts'))
    await expect(fs.access(join(workspace.path, 'config', 'known_hosts'))).resolves.toBeUndefined()
  })

  it('trusts a host key that is already stored in the database', async () => {
    const now = Date.now()
    db.prepare(
      'INSERT INTO trusted_ssh_hosts (host, key_type, public_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run('github.com', 'ssh-rsa', SSH_KEY, now, now)
    const service = new GitAuthService()
    await service.initialize(undefined, db)

    await expect(service.verifyHostKeyBeforeOperation('git@github.com:user/repo.git')).resolves.toBe(true)
  })

  it('trusts every host before the handler is initialized', async () => {
    const service = new GitAuthService()

    await expect(service.verifyHostKeyBeforeOperation('git@github.com:user/repo.git')).resolves.toBe(true)
  })

  it('exposes the shared git environment with terminal prompts disabled', async () => {
    const service = new GitAuthService()
    await service.initialize(ipcServer, db)

    const env = service.getGitEnvironment()

    expect(env.GIT_TERMINAL_PROMPT).toBe('0')
    expect(env.LANG).toBe('en_US.UTF-8')
    expect(env.LC_ALL).toBe('en_US.UTF-8')
    expect(env.GIT_SSH_COMMAND).toContain(join(workspace.path, 'config', 'known_hosts'))
    expect(env.VSCODE_GIT_IPC_HANDLE).toBe(ipcServer.ipcHandlePath)
    expect(env.VSCODE_GIT_FETCH_SILENT).toBeUndefined()
    expect(service.getGitEnvironment(true).VSCODE_GIT_FETCH_SILENT).toBe('true')
  })
})

describe('GitAuthService SSH key lifecycle', () => {
  it('writes the decrypted key, exposes it in the SSH environment and removes it on cleanup', async () => {
    const service = new GitAuthService()
    await service.initialize(undefined, db)

    await service.setupSSHKey(encryptedKeyCredential())

    const env = service.getSSHEnvironment()
    const keyPath = sshKeyPathFromCommand(env.GIT_SSH_COMMAND)
    expect(env.GIT_SSH_COMMAND).toContain('-o IdentitiesOnly=yes')
    expect(env.SSHPASS).toBeUndefined()
    const stats = await fs.stat(keyPath)
    expect(stats.mode & 0o777).toBe(0o600)
    await expect(fs.readFile(keyPath, 'utf-8')).resolves.toContain(SSH_KEY)

    await service.cleanupSSHKey()

    await expect(fs.access(keyPath)).rejects.toThrow()
    expect(service.getSSHEnvironment().GIT_SSH_COMMAND).not.toContain('-i "')
  })

  it('exposes the decrypted passphrase to sshpass', async () => {
    const service = new GitAuthService()
    await service.initialize(undefined, db)

    await service.setupSSHKey(encryptedKeyCredential('my-secret-passphrase'))

    const env = service.getSSHEnvironment()
    expect(env.GIT_SSH_COMMAND).toContain('sshpass -e')
    expect(env.SSHPASS).toBe('my-secret-passphrase')

    await service.cleanupSSHKey()
  })

  it('ignores credentials that are not SSH keys', async () => {
    const service = new GitAuthService()
    await service.initialize(undefined, db)

    await service.setupSSHKey({ name: 'pat', host: 'github.com', type: 'pat', token: 'ghp-token' })

    expect(service.getSSHEnvironment().GIT_SSH_COMMAND).not.toContain('-i "')
  })
})
