import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'bun:sqlite'
import * as fs from 'node:fs/promises'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { TempWorkspace } from '../helpers/test-env'
import { applyTestEnv, createTempWorkspace } from '../helpers/test-env'
import { createTestDatabase } from '../helpers/test-database'
import { SSHHostKeyHandler } from '../../src/ipc/sshHostKeyHandler'

const SSH_KEYSCAN_SCRIPT = `#!/usr/bin/env node
const fs = require('node:fs')
const keyFile = process.env.SSH_KEYSCAN_KEY_FILE
if (!fs.existsSync(keyFile)) {
  process.stderr.write('ssh-keyscan: no keys found\\n')
  process.exit(1)
}
process.stdout.write(fs.readFileSync(keyFile, 'utf8'))
`

const RSA_KEY = 'github.com ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQDRHw== test@host'
const ED25519_KEY = 'github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIQQ/test@example.com'
const ECDSA_KEY = 'github.com ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBEM/test@test.com'

let workspace: TempWorkspace
let db: Database
let handler: SSHHostKeyHandler
let knownHostsPath: string
let keyScanKeyFile: string
let restoreEnv: () => void

function insertTrustedHost(host: string, keyType: string, publicKey: string): void {
  const now = Date.now()
  db.prepare(
    'INSERT INTO trusted_ssh_hosts (host, key_type, public_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  ).run(host, keyType, publicKey, now, now)
}

function keyScanReturns(publicKey: string): void {
  writeFileSync(keyScanKeyFile, `${publicKey}\n`, 'utf-8')
}

beforeEach(async () => {
  workspace = createTempWorkspace('ocm-ssh-hostkey-')
  const binDir = join(workspace.path, 'bin')
  mkdirSync(binDir, { recursive: true })
  writeFileSync(join(binDir, 'ssh-keyscan'), SSH_KEYSCAN_SCRIPT, { mode: 0o755 })
  keyScanKeyFile = join(workspace.path, 'keyscan-output')
  restoreEnv = applyTestEnv({ PATH: `${binDir}:${process.env.PATH ?? ''}`, SSH_KEYSCAN_KEY_FILE: keyScanKeyFile })

  db = createTestDatabase()
  knownHostsPath = join(workspace.path, 'config', 'known_hosts')
  await fs.mkdir(join(workspace.path, 'config'), { recursive: true })
  await fs.writeFile(knownHostsPath, '', { mode: 0o600 })

  handler = new SSHHostKeyHandler(db, 5_000)
  await handler.initialize()
})

afterEach(async () => {
  try {
    db.close()
  } catch {}
  restoreEnv()
  workspace.restore()
})

describe('SSHHostKeyHandler initialization', () => {
  it('points known_hosts at the workspace config directory', () => {
    expect(handler.getKnownHostsPath()).toBe(knownHostsPath)
    expect(handler.getEnv()).toEqual({ KNOWN_HOSTS_PATH: knownHostsPath })
  })

  it('loads every trusted host key from the database into known_hosts', async () => {
    insertTrustedHost('github.com', 'ssh-rsa', RSA_KEY)
    insertTrustedHost('gitlab.com:2222', 'ssh-ed25519', ED25519_KEY)

    const reloaded = new SSHHostKeyHandler(db, 5_000)
    await reloaded.initialize()

    const content = await fs.readFile(reloaded.getKnownHostsPath(), 'utf-8')
    expect(content).toContain(RSA_KEY)
    expect(content).toContain(ED25519_KEY)
  })
})

describe('known_hosts entries', () => {
  it.each([
    ['a non-standard port', 'github.com:2222', '[github.com]:2222 ssh-rsa AAAA test@host', '[github.com]:2222'],
    ['the standard port', 'github.com', 'github.com ssh-rsa AAAA test@host', 'github.com ssh-rsa'],
    ['an ED25519 key', 'github.com', ED25519_KEY, 'ssh-ed25519'],
    ['an ECDSA key', 'github.com', ECDSA_KEY, 'ecdsa-sha2-nistp256'],
  ])('writes %s as a known_hosts line', async (_label, host, publicKey, expectedFragment) => {
    await handler['addToKnownHosts'](host, publicKey)

    const content = await fs.readFile(knownHostsPath, 'utf-8')
    expect(content).toContain(expectedFragment)
    expect(content).not.toContain('SHA256:')
  })

  it('writes exactly one host key line with the host, key type and key data', async () => {
    await handler['addToKnownHosts']('github.com', RSA_KEY)

    const content = await fs.readFile(knownHostsPath, 'utf-8')
    expect(content.trim().split('\n')).toEqual([RSA_KEY])
  })

  it('does not write a port suffix for the standard port', async () => {
    await handler['addToKnownHosts']('github.com', RSA_KEY)

    await expect(fs.readFile(knownHostsPath, 'utf-8')).resolves.not.toContain(':22')
  })

  it('resolves without throwing when known_hosts cannot be written', async () => {
    handler['knownHostsPath'] = join(workspace.path, 'missing-dir', 'known_hosts')

    await expect(handler['addToKnownHosts']('github.com', RSA_KEY)).resolves.toBeUndefined()
  })
})

describe('trusted host persistence', () => {
  it('inserts a new trusted host and reads it back', () => {
    handler['saveTrustedHost']('github.com', RSA_KEY)

    expect(handler['getTrustedHost']('github.com')).toEqual({ key_type: 'ssh-rsa', public_key: RSA_KEY })
  })

  it('updates the stored key when the same host reports a new one', () => {
    handler['saveTrustedHost']('github.com', RSA_KEY)
    handler['saveTrustedHost']('github.com', ED25519_KEY)

    const rows = db.prepare('SELECT public_key FROM trusted_ssh_hosts WHERE host = ?').all('github.com')
    expect(rows).toEqual([{ public_key: ED25519_KEY }])
  })

  it('returns null instead of throwing when the database query fails', () => {
    db.close()

    expect(handler['getTrustedHost']('github.com')).toBeNull()
  })

  it('swallows a database write failure', () => {
    db.close()

    expect(() => handler['saveTrustedHost']('github.com', RSA_KEY)).not.toThrow()
  })
})

describe('verifyHostKeyBeforeOperation', () => {
  it('trusts a host that is already stored', async () => {
    insertTrustedHost('github.com', 'ssh-rsa', RSA_KEY)

    await expect(handler.verifyHostKeyBeforeOperation('git@github.com:user/repo.git')).resolves.toBe(true)
  })

  it('rejects a host that ssh-keyscan cannot resolve', async () => {
    await expect(handler.verifyHostKeyBeforeOperation('git@unknown.example:user/repo.git')).resolves.toBe(false)
  })

  it('stores the scanned key when the host is auto-accepted', async () => {
    keyScanReturns(RSA_KEY)

    await handler.autoAcceptHostKey('git@github.com:user/repo.git')

    expect(handler['getTrustedHost']('github.com')).toEqual({ key_type: 'ssh-rsa', public_key: RSA_KEY })
    await expect(fs.readFile(knownHostsPath, 'utf-8')).resolves.toContain(RSA_KEY)
    await expect(handler.verifyHostKeyBeforeOperation('git@github.com:user/repo.git')).resolves.toBe(true)
  })
})

describe('respond', () => {
  it('reports an unknown request id', async () => {
    await expect(handler.respond({ requestId: 'non-existent-id', response: 'accept' })).resolves.toEqual({
      success: false,
      error: 'Request not found or expired',
    })
  })

  it('has no pending requests initially', () => {
    expect(handler.getPendingCount()).toBe(0)
  })
})

it('creates the known_hosts file when it does not exist yet', async () => {
  const fresh = new SSHHostKeyHandler(db, 5_000)
  const freshPath = fresh.getKnownHostsPath()
  await fs.rm(freshPath, { force: true })

  await fresh.initialize()

  expect(existsSync(freshPath)).toBe(true)
})
