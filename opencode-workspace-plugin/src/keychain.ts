import { spawnSync } from 'child_process'

const SERVICE = 'opencode-manager'

export class KeychainError extends Error {
  constructor(message: string, public exitCode: number | null) {
    super(message)
    this.name = 'KeychainError'
  }
}

function runSecurity(args: string[], input?: string): { stdout: string; stderr: string; code: number | null } {
  const res = spawnSync('security', args, {
    input,
    encoding: 'utf-8',
  })
  return { stdout: res.stdout ?? '', stderr: res.stderr ?? '', code: res.status }
}

export function setToken(account: string, token: string): void {
  const res = runSecurity([
    'add-generic-password',
    '-s', SERVICE,
    '-a', account,
    '-w', token,
    '-U',
  ])
  if (res.code !== 0) {
    throw new KeychainError(`Failed to store token in Keychain: ${res.stderr.trim()}`, res.code)
  }
}

export function getToken(account: string): string | null {
  const res = runSecurity([
    'find-generic-password',
    '-s', SERVICE,
    '-a', account,
    '-w',
  ])
  if (res.code !== 0) return null
  return res.stdout.trim() || null
}

export function deleteToken(account: string): boolean {
  const res = runSecurity([
    'delete-generic-password',
    '-s', SERVICE,
    '-a', account,
  ])
  return res.code === 0
}
