import { spawnSync } from 'child_process'
import type { CredentialBackend, CredentialStoreDescription } from './credential-backend.js'
import { CredentialStoreError } from './credential-backend.js'

export const KEYCHAIN_SERVICE = 'opencode-manager'

export type SecuritySpawn = (
  command: string,
  args: string[],
  options: { encoding: 'utf-8' },
) => { stdout: string | null; stderr: string | null; status: number | null; error?: Error }

interface SecurityResult {
  stdout: string
  stderr: string
  code: number | null
}

function runSecurity(spawn: SecuritySpawn, args: string[]): SecurityResult {
  const res = spawn('security', args, { encoding: 'utf-8' })
  if (res.error) {
    throw new CredentialStoreError(
      `cannot run the macOS 'security' CLI: ${res.error.message}`,
      'keychain',
    )
  }
  return { stdout: res.stdout ?? '', stderr: res.stderr ?? '', code: res.status }
}

function describeFailure(res: SecurityResult): string {
  const stderr = res.stderr.trim()
  if (stderr) return stderr
  if (res.code !== null) return `exit status ${res.code}`
  return 'process terminated without an exit status'
}

export function createKeychainCredentialBackend(
  spawn: SecuritySpawn = spawnSync as unknown as SecuritySpawn,
): CredentialBackend {
  return {
    kind: 'keychain',
    describe(): CredentialStoreDescription {
      return { kind: 'keychain', location: `macOS Keychain (service ${KEYCHAIN_SERVICE})` }
    },
    get(account: string): string | null {
      const res = runSecurity(spawn, [
        'find-generic-password',
        '-s', KEYCHAIN_SERVICE,
        '-a', account,
        '-w',
      ])
      if (res.code === 0) return res.stdout.trim() || null
      if (res.code === 44) return null
      throw new CredentialStoreError(
        `failed to read token from the macOS Keychain: ${describeFailure(res)}`,
        'keychain',
      )
    },
    set(account: string, token: string): void {
      const res = runSecurity(spawn, [
        'add-generic-password',
        '-s', KEYCHAIN_SERVICE,
        '-a', account,
        '-w', token,
        '-U',
      ])
      if (res.code !== 0) {
        throw new CredentialStoreError(
          `failed to store token in the macOS Keychain: ${describeFailure(res)}`,
          'keychain',
        )
      }
    },
    delete(account: string): boolean {
      const res = runSecurity(spawn, [
        'delete-generic-password',
        '-s', KEYCHAIN_SERVICE,
        '-a', account,
      ])
      if (res.code === 0) return true
      if (res.code === 44) return false
      throw new CredentialStoreError(
        `failed to delete token from the macOS Keychain: ${describeFailure(res)}`,
        'keychain',
      )
    },
  }
}
