import { execFile } from 'child_process'
import type { TokenStore, TokenStoreDescription } from './token-store.js'
import { TokenStoreError } from './token-store.js'

export const KEYCHAIN_SERVICE = 'opencode-manager'

const SECURITY_BIN = '/usr/bin/security'
const ITEM_NOT_FOUND = 44

export interface SecurityResult {
  stdout: string
  stderr: string
  code: number | null
}

export type SecurityRunner = (args: string[]) => Promise<SecurityResult>

type ExecFileFailure = Error & { code?: number | string }

function runSecurity(args: string[]): Promise<SecurityResult> {
  return new Promise<SecurityResult>((resolve, reject) => {
    execFile(SECURITY_BIN, args, { encoding: 'utf-8' }, (err, stdout, stderr) => {
      const exitCode = (err as ExecFileFailure | null)?.code ?? (err ? null : 0)
      if (typeof exitCode !== 'number') {
        reject(new TokenStoreError(`cannot run the macOS 'security' CLI: ${(err as Error).message}`, 'keychain'))
        return
      }
      resolve({ stdout: stdout ?? '', stderr: stderr ?? '', code: exitCode })
    })
  })
}

function describeFailure(res: SecurityResult): string {
  const stderr = res.stderr.trim()
  if (stderr) return stderr
  if (res.code !== null) return `exit status ${res.code}`
  return 'process terminated without an exit status'
}

export function createKeychainTokenStore(run: SecurityRunner = runSecurity): TokenStore {
  return {
    describe(): TokenStoreDescription {
      return { kind: 'keychain', location: `macOS Keychain (service ${KEYCHAIN_SERVICE})` }
    },
    async get(account: string): Promise<string | null> {
      const res = await run([
        'find-generic-password',
        '-s', KEYCHAIN_SERVICE,
        '-a', account,
        '-w',
      ])
      if (res.code === 0) return res.stdout.trim() || null
      if (res.code === ITEM_NOT_FOUND) return null
      throw new TokenStoreError(
        `failed to read token from the macOS Keychain: ${describeFailure(res)}`,
        'keychain',
      )
    },
    async set(account: string, token: string): Promise<void> {
      const res = await run([
        'add-generic-password',
        '-s', KEYCHAIN_SERVICE,
        '-a', account,
        '-w', token,
        '-U',
      ])
      if (res.code !== 0) {
        throw new TokenStoreError(
          `failed to store token in the macOS Keychain: ${describeFailure(res)}`,
          'keychain',
        )
      }
    },
    async delete(account: string): Promise<boolean> {
      const res = await run([
        'delete-generic-password',
        '-s', KEYCHAIN_SERVICE,
        '-a', account,
      ])
      if (res.code === 0) return true
      if (res.code === ITEM_NOT_FOUND) return false
      throw new TokenStoreError(
        `failed to delete token from the macOS Keychain: ${describeFailure(res)}`,
        'keychain',
      )
    },
  }
}
