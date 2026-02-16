/* eslint-disable no-empty */
import { promises as fs } from 'fs'
import { execFile } from 'child_process'
import { randomBytes } from 'crypto'
import { join } from 'path'
import { getWorkspacePath } from '@opencode-manager/shared/config/env'

const SSH_KEYS_DIR = join(getWorkspacePath(), '.ssh-keys')

async function ensureSSHKeysDir(): Promise<void> {
  try {
    await fs.access(SSH_KEYS_DIR)
  } catch {
    await fs.mkdir(SSH_KEYS_DIR, { mode: 0o700, recursive: true })
  }
}

async function validateSSHKey(keyPath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(keyPath)
    const mode = stats.mode & 0o777
    
    if (mode !== 0o600) {
      await fs.chmod(keyPath, 0o600)
    }
    
    const keyContent = await fs.readFile(keyPath, 'utf-8')
    const trimmedKey = keyContent.trim()
    
    if (!trimmedKey) {
      return false
    }
    
    const keyLines = trimmedKey.split('\n')
    const firstLine = keyLines[0]
    
    if (!firstLine) {
      return false
    }
    
    if (firstLine.startsWith('-----BEGIN')) {
      return true
    }
    
    if (firstLine.match(/^(ssh-rsa|ssh-ed25519|ecdsa-sha2-nistp256|ecdsa-sha2-nistp384|ecdsa-sha2-nistp521|ssh-dss)\s+/)) {
      return true
    }
    
    return false
  } catch {
    return false
  }
}

export async function writeTemporarySSHKey(keyContent: string, identifier: string): Promise<string> {
  await ensureSSHKeysDir()
  
  const randomSuffix = randomBytes(8).toString('hex')
  const fileName = `key-${identifier}-${randomSuffix}`
  const keyPath = join(SSH_KEYS_DIR, fileName)

  if (!keyPath.startsWith(SSH_KEYS_DIR)) {
    throw new Error('Invalid key path')
  }

  await fs.writeFile(keyPath, keyContent.trim() + '\n', { mode: 0o600 })
  
  const isValid = await validateSSHKey(keyPath)
  if (!isValid) {
    await fs.unlink(keyPath).catch(() => {})
    throw new Error('Invalid SSH key format')
  }
  
  return keyPath
}

export async function cleanupSSHKey(keyPath: string): Promise<void> {
  try {
    await fs.unlink(keyPath).catch(() => {})
  } catch {
  }
}

export interface SSHCommandResult {
  command: string
  env?: Record<string, string>
}

export function buildSSHCommand(keyPath: string, passphrase?: string, knownHostsPath?: string, port?: string): SSHCommandResult {
  const knownHostsOption = knownHostsPath ? `-o UserKnownHostsFile="${knownHostsPath}" -o StrictHostKeyChecking=accept-new` : '-o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/dev/null'
  const portOption = port && port !== '22' ? ` -p ${port}` : ''
  const baseCommand = `ssh -T -i "${keyPath}" -o IdentitiesOnly=yes -o PasswordAuthentication=no ${knownHostsOption}${portOption}`

  if (passphrase) {
    return {
      command: `sshpass -e ${baseCommand}`,
      env: { SSHPASS: passphrase }
    }
  }

  return { command: baseCommand }
}

export function buildSSHCommandWithKnownHosts(knownHostsPath: string, port?: string): string {
  const portOption = port && port !== '22' ? ` -p ${port}` : ''
  return `ssh -T -o UserKnownHostsFile="${knownHostsPath}" -o StrictHostKeyChecking=accept-new -o PasswordAuthentication=no${portOption}`
}

export async function writePersistentSSHKey(keyContent: string, identifier: string): Promise<string> {
  await ensureSSHKeysDir()

  const fileName = `persistent-${identifier}`
  const keyPath = join(SSH_KEYS_DIR, fileName)

  if (!keyPath.startsWith(SSH_KEYS_DIR)) {
    throw new Error('Invalid key path')
  }

  await fs.writeFile(keyPath, keyContent.trim() + '\n', { mode: 0o600 })

  const isValid = await validateSSHKey(keyPath)
  if (!isValid) {
    await fs.unlink(keyPath).catch(() => {})
    throw new Error('Invalid SSH key format')
  }

  return keyPath
}

export function buildSSHCommandWithConfig(configPath: string, knownHostsPath: string): string {
  return `ssh -T -F "${configPath}" -o UserKnownHostsFile="${knownHostsPath}" -o StrictHostKeyChecking=accept-new -o PasswordAuthentication=no`
}

export async function stripKeyPassphrase(keyPath: string, passphrase: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    execFile('ssh-keygen', ['-p', '-P', passphrase, '-N', '', '-f', keyPath], (error: Error | null) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

export interface SSHConfigEntry {
  hostname: string
  port: string
  keyPath: string
}

export function generateSSHConfig(entries: SSHConfigEntry[]): string {
  const lines: string[] = []

  for (const entry of entries) {
    lines.push(`Host ${entry.hostname}`)
    lines.push(`  IdentityFile "${entry.keyPath}"`)
    lines.push('  IdentitiesOnly yes')

    if (entry.port !== '22') {
      lines.push(`  Port ${entry.port}`)
    }

    lines.push('')
  }

  return lines.join('\n')
}

export async function writeSSHConfig(configPath: string, configContent: string): Promise<void> {
  const dir = join(getWorkspacePath(), 'config')
  try {
    await fs.access(dir)
  } catch {
    await fs.mkdir(dir, { mode: 0o700, recursive: true })
  }

  await fs.writeFile(configPath, configContent, { mode: 0o600 })
}

export async function cleanupAllSSHKeys(): Promise<void> {
  try {
    await fs.rm(SSH_KEYS_DIR, { recursive: true, force: true })
  } catch {
  }
}

export async function cleanupPersistentSSHKeys(): Promise<void> {
  await ensureSSHKeysDir()

  try {
    const files = await fs.readdir(SSH_KEYS_DIR)
    const persistentFiles = files.filter(f => f.startsWith('persistent-'))

    await Promise.all(
      persistentFiles.map(f => fs.unlink(join(SSH_KEYS_DIR, f)).catch(() => {}))
    )
  } catch {
  }

  try {
    const configPath = join(getWorkspacePath(), 'config', 'ssh_config')
    await fs.unlink(configPath)
  } catch {
  }
}

export interface SSHConnectionInfo {
  user: string
  host: string
  port: string
}

export function parseSSHHost(input: string): SSHConnectionInfo {
  const defaultUser = 'git'
  const defaultPort = '22'
  
  if (input.startsWith('ssh://')) {
    try {
      const parsed = new URL(input)
      return {
        user: parsed.username || defaultUser,
        host: parsed.hostname || '',
        port: parsed.port || defaultPort
      }
    } catch {
    }
  }
  
  const cleaned = input.replace(/^[a-z]+:\/\//i, '')
  
  let user = defaultUser
  let host = cleaned
  let port = defaultPort
  
  if (cleaned.includes('@')) {
    const atIndex = cleaned.indexOf('@')
    user = cleaned.substring(0, atIndex)
    host = cleaned.substring(atIndex + 1)
  }
  
  if (host.includes(':')) {
    const colonIndex = host.lastIndexOf(':')
    const afterColon = host.substring(colonIndex + 1)
    
    if (afterColon.includes('/')) {
      const hostPart = host.split(':')[0]
      if (hostPart) {
        host = hostPart
      }
    } else {
      const portNum = parseInt(afterColon, 10)
      if (!isNaN(portNum) && portNum > 0 && portNum <= 65535) {
        port = afterColon
        const hostPart = host.substring(0, colonIndex)
        if (hostPart) {
          host = hostPart
        }
      } else {
        const hostPart = host.split(':')[0]
        if (hostPart) {
          host = hostPart
        }
      }
    }
  }
  
  return { user, host, port }
}

export function normalizeHostPort(host: string, port?: string): string {
  if (port && port !== '22') {
    return `${host}:${port}`
  }
  return host
}

export function parseHostPort(hostPort: string): { host: string; port: string } {
  if (hostPort.includes(':')) {
    const colonIndex = hostPort.lastIndexOf(':')
    const host = hostPort.substring(0, colonIndex)
    const port = hostPort.substring(colonIndex + 1)
    return { host, port }
  }
  return { host: hostPort, port: '22' }
}
