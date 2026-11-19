import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import * as fs from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import type { TempWorkspace } from '../helpers/test-env'
import { applyTestEnv, createTempWorkspace } from '../helpers/test-env'
import { testLogEntries } from '../helpers/log-assertions'
import { validateSSHPrivateKey } from '../../src/utils/ssh-validation'

const SSH_KEYGEN_SCRIPT = `#!/usr/bin/env node
const fs = require('node:fs')
const args = process.argv.slice(2)
const keyIndex = args.indexOf('-f')
const keyPath = keyIndex >= 0 ? args[keyIndex + 1] : undefined
const mode = keyPath ? (fs.statSync(keyPath).mode & 0o777).toString(8) : ''
fs.appendFileSync(process.env.SSH_KEYGEN_ARGS_FILE, JSON.stringify({ args, mode }) + '\\n')
const failureFile = process.env.SSH_KEYGEN_FAILURE_FILE
if (fs.existsSync(failureFile)) {
  process.stderr.write(fs.readFileSync(failureFile, 'utf8').trim() + '\\n')
  process.exit(255)
}
process.stdout.write('ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIQQ fake@host\\n')
`

const SshKeygenInvocationSchema = z.object({ args: z.array(z.string()), mode: z.string() })

const OPENSSH_KEY = `-----BEGIN OPENSSH PRIVATE KEY-----
${'A'.repeat(120)}
-----END OPENSSH PRIVATE KEY-----`

let workspace: TempWorkspace
let argsFile: string
let failureFile: string
let restoreEnv: () => void

function sshKeygenInvocations(): Array<z.infer<typeof SshKeygenInvocationSchema>> {
  const lines = readFileSync(argsFile, 'utf-8').split('\n').filter((line) => line.length > 0)
  return lines.map((line) => SshKeygenInvocationSchema.parse(JSON.parse(line)))
}

function failSshKeygen(message: string): void {
  writeFileSync(failureFile, message, 'utf-8')
}

beforeEach(() => {
  workspace = createTempWorkspace('ocm-ssh-validation-')
  const binDir = join(workspace.path, 'bin')
  mkdirSync(binDir, { recursive: true })
  writeFileSync(join(binDir, 'ssh-keygen'), SSH_KEYGEN_SCRIPT, { mode: 0o755 })
  argsFile = join(workspace.path, 'ssh-keygen-args.jsonl')
  failureFile = join(workspace.path, 'ssh-keygen-failure')
  writeFileSync(argsFile, '')
  restoreEnv = applyTestEnv({
    PATH: `${binDir}:${process.env.PATH ?? ''}`,
    SSH_KEYGEN_ARGS_FILE: argsFile,
    SSH_KEYGEN_FAILURE_FILE: failureFile,
  })
})

afterEach(() => {
  restoreEnv()
  workspace.restore()
})

describe('validateSSHPrivateKey', () => {
  it('accepts a key ssh-keygen can read and hands it a private temp file', async () => {
    const result = await validateSSHPrivateKey(OPENSSH_KEY)

    expect(result).toEqual({ valid: true, hasPassphrase: false })

    const [invocation] = sshKeygenInvocations()
    const tempKeyPath = invocation?.args[4]
    expect(invocation?.args.slice(0, 4)).toEqual(['-y', '-P', '', '-f'])
    expect(invocation?.mode).toBe('600')
    expect(tempKeyPath).toBeDefined()
    await expect(fs.access(tempKeyPath ?? '')).rejects.toThrow()
  })

  it.each([
    ['incorrect passphrase supplied to decrypt private key'],
    ['failed: incorrect passphrase supplied to decrypt private key'],
    ['Load key "/tmp/temp-ssh-key-123": bad passphrase'],
    ['passphrase failed'],
  ])('reports a passphrase-protected key for stderr %s', async (failure) => {
    failSshKeygen(failure)

    const result = await validateSSHPrivateKey(OPENSSH_KEY)

    expect(result).toEqual({ valid: true, hasPassphrase: true })
  })

  it('rejects a key ssh-keygen cannot parse and stays quiet on the error log', async () => {
    failSshKeygen('invalid format')

    const result = await validateSSHPrivateKey('-----BEGIN INVALID KEY-----\nAAAA\n-----END INVALID KEY-----')

    expect(result.valid).toBe(false)
    expect(result.hasPassphrase).toBe(false)
    expect(result.error).toContain('Invalid SSH key')
    expect(testLogEntries('error')).toHaveLength(0)
  })

  it('removes the temp file when ssh-keygen rejects the key', async () => {
    failSshKeygen('invalid format')

    await validateSSHPrivateKey(OPENSSH_KEY)

    const [invocation] = sshKeygenInvocations()
    await expect(fs.access(invocation?.args[4] ?? '')).rejects.toThrow()
  })

  it.each([
    [null, 'SSH key is required'],
    [undefined, 'SSH key is required'],
    ['', 'SSH key is required'],
    ['   \n\t   ', 'SSH key cannot be empty'],
  ])('rejects the missing key %j', async (key, error) => {
    const result = await validateSSHPrivateKey(key)

    expect(result).toEqual({ valid: false, hasPassphrase: false, error })
    expect(sshKeygenInvocations()).toHaveLength(0)
  })
})
