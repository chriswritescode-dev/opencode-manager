import * as path from 'path'
import { z } from 'zod'
import { type JsonValue } from '@opencode-manager/shared/utils'
import * as fs from 'fs/promises'
import * as crypto from 'crypto'
import type { IPCHandler, IpcEnvironment } from './ipcServer'
import type { Database } from 'bun:sqlite'
import { logger } from '../utils/logger'
import { getErrorMessage } from '../utils/error-utils'
import { selectRow, selectRows } from '../db/rows'
import { getWorkspacePath } from '@opencode-manager/shared/config/env'
import { broadcastSSHHostKeyRequest } from '../services/sse-aggregator'
import { executeCommand } from '../utils/process'
import { parseSSHHost, normalizeHostPort } from '../utils/ssh-key-manager'
import { mkdirSafe } from '../utils/fs-safe'

const SSHHostKeyResponseSchema = z.object({
  requestId: z.string(),
  response: z.enum(['accept', 'reject']),
})

const TrustedHostPublicKeyRowSchema = z.object({
  public_key: z.string(),
})

const TrustedHostKeySchema = z.object({
  key_type: z.string(),
  public_key: z.string(),
})

type TrustedHostKey = z.infer<typeof TrustedHostKeySchema>

interface SSHHostKeyRequest {
  id: string
  host: string
  ip: string
  keyType: string
  fingerprint: string
  timestamp: number
  isKeyChanged: boolean
}

export class SSHHostKeyHandler implements IPCHandler {
  private pendingRequests = new Map<string, {
    request: SSHHostKeyRequest
    resolve: (value: boolean) => void
    timeout: ReturnType<typeof setTimeout>
  }>()
  private readonly timeoutMs: number
  private knownHostsPath: string
  private database: Database

  constructor(database: Database, timeoutMs: number = 120_000) {
    this.database = database
    this.timeoutMs = timeoutMs
    const configDir = path.join(getWorkspacePath(), 'config')
    this.knownHostsPath = path.join(configDir, 'known_hosts')
    logger.info(`SSHHostKeyHandler initialized with timeout=${timeoutMs}ms, known_hosts=${this.knownHostsPath}`)
  }

  private async ensureKnownHostsFile(): Promise<void> {
    try {
      const configDir = path.join(getWorkspacePath(), 'config')
      await mkdirSafe(configDir)
      try {
        await fs.access(this.knownHostsPath)
      } catch {
        await fs.writeFile(this.knownHostsPath, '', { mode: 0o600 })
        logger.info(`Created known_hosts file at ${this.knownHostsPath}`)
      }
    } catch (error) {
      logger.error('Failed to ensure known_hosts file:', error)
    }
  }

  async verifyHostKeyBeforeOperation(repoUrl: string): Promise<boolean> {
    const { host, port } = parseSSHHost(repoUrl)
    const hostPort = normalizeHostPort(host, port)

    const trustedHost = this.getTrustedHost(hostPort)
    if (trustedHost) {
      logger.info(`Host ${hostPort} already trusted, skipping verification`)
      return true
    }

    try {
      const publicKey = await this.fetchHostPublicKey(host, port)
      logger.info(`Fetched public key for ${hostPort}`)

      const parts = publicKey.split(' ')
      const keyType = parts[1] || 'UNKNOWN'
      const requestId = crypto.randomBytes(16).toString('hex')
      const hostKeyRequest: SSHHostKeyRequest = {
        id: requestId,
        host: hostPort,
        ip: '',
        keyType,
        fingerprint: publicKey,
        timestamp: Date.now(),
        isKeyChanged: false
      }

      logger.info(`Broadcasting SSH host key request: ${requestId} for host=${hostPort}`)
      broadcastSSHHostKeyRequest({ ...hostKeyRequest, requestId, action: 'verify' })

      return new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => {
          logger.info(`SSH host key request timed out: ${requestId}, rejecting connection`)
          this.pendingRequests.delete(requestId)
          resolve(false)
        }, this.timeoutMs)

        this.pendingRequests.set(requestId, { request: hostKeyRequest, resolve, timeout })
      })
    } catch (cause) {
      logger.warn(`Failed to fetch host key for ${hostPort}, rejecting connection:`, getErrorMessage(cause))
      return false
    }
  }

  async autoAcceptHostKey(repoUrl: string): Promise<void> {
    const { host, port } = parseSSHHost(repoUrl)
    const hostPort = normalizeHostPort(host, port)

    const trustedHost = this.getTrustedHost(hostPort)
    if (trustedHost) {
      logger.info(`Host ${hostPort} already trusted, skipping auto-accept`)
      return
    }

    const publicKey = await this.fetchHostPublicKey(host, port)
    await this.addToKnownHosts(hostPort, publicKey)
    this.saveTrustedHost(hostPort, publicKey)
    logger.info(`Auto-accepted SSH host key for ${hostPort}`)
  }

  private async fetchHostPublicKey(host: string, port?: string): Promise<string> {
    const portArgs = port ? ['-p', port] : []
    const result = await executeCommand(
      ['ssh-keyscan', '-t', 'ed25519,rsa,ecdsa', ...portArgs, host],
      { silent: true, ignoreExitCode: true }
    )
    const output = result.stdout
    const bracketedHost = port && port !== '22' ? `[${host}]:${port}` : host
    const lines = output.trim().split('\n')
    for (const line of lines) {
      if (line.startsWith(host) || line.startsWith(bracketedHost)) {
        return line
      }
    }

    throw new Error('No valid host keys found')
  }

  async handle(payload: JsonValue): Promise<JsonValue> {
    return await this.respond(SSHHostKeyResponseSchema.parse(payload))
  }

  async respond(response: { requestId: string; response: 'accept' | 'reject' }): Promise<{ success: boolean; error?: string }> {
    const pending = this.pendingRequests.get(response.requestId)
    if (!pending) {
      return { success: false, error: 'Request not found or expired' }
    }

    clearTimeout(pending.timeout)
    this.pendingRequests.delete(response.requestId)

    if (response.response === 'accept') {
      await this.addToKnownHosts(pending.request.host, pending.request.fingerprint)
      this.saveTrustedHost(pending.request.host, pending.request.fingerprint)
      logger.info(`Accepted SSH host key for ${pending.request.host}`)
    } else {
      logger.info(`Rejected SSH host key for ${pending.request.host}`)
    }

    pending.resolve(response.response === 'accept')
    return { success: true }
  }

  private async addToKnownHosts(host: string, publicKey: string): Promise<void> {
    try {
      await fs.appendFile(this.knownHostsPath, publicKey + '\n')
      logger.info(`Added host to known_hosts: ${host}`)
    } catch (error) {
      logger.error(`Failed to add host to known_hosts: ${error}`)
    }
  }

  private async loadFromDatabaseToKnownHosts(): Promise<void> {
    try {
      const hosts = selectRows(this.database, TrustedHostPublicKeyRowSchema, 'SELECT * FROM trusted_ssh_hosts')

      const entries = hosts.map(h => h.public_key).join('\n')
      await fs.writeFile(this.knownHostsPath, entries + '\n', { mode: 0o600 })
      logger.info(`Loaded ${hosts.length} trusted hosts from database to known_hosts`)
    } catch (error) {
      logger.error('Failed to load trusted hosts from database:', error)
    }
  }

  private getTrustedHost(host: string): TrustedHostKey | null {
    try {
      const result = selectRow(
        this.database,
        TrustedHostKeySchema,
        'SELECT key_type, public_key FROM trusted_ssh_hosts WHERE host = ?',
        host,
      )
      return result ?? null
    } catch (error) {
      logger.error(`Failed to get trusted host ${host}:`, error)
      return null
    }
  }

  private saveTrustedHost(host: string, publicKey: string): void {
    try {
      const parts = publicKey.split(' ')
      const keyType = parts[1] || 'UNKNOWN'
      const now = Date.now()
      const existing = this.getTrustedHost(host)
      if (existing) {
        this.database.prepare('UPDATE trusted_ssh_hosts SET key_type = ?, public_key = ?, updated_at = ? WHERE host = ?')
          .run(keyType, publicKey, now, host)
        logger.info(`Updated trusted host in database: ${host}`)
      } else {
        this.database.prepare('INSERT INTO trusted_ssh_hosts (host, key_type, public_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
          .run(host, keyType, publicKey, now, now)
        logger.info(`Saved new trusted host to database: ${host}`)
      }
    } catch (error) {
      logger.error(`Failed to save trusted host ${host}:`, error)
    }
  }

  async initialize(): Promise<void> {
    await this.ensureKnownHostsFile()
    await this.loadFromDatabaseToKnownHosts()
    logger.info('SSHHostKeyHandler initialized with known_hosts from database')
  }

  getKnownHostsPath(): string {
    return this.knownHostsPath
  }

  getEnv(): IpcEnvironment {
    return {
      KNOWN_HOSTS_PATH: this.knownHostsPath
    }
  }

  getPendingCount(): number {
    return this.pendingRequests.size
  }
}

export function createSSHHostKeyHandler(database: Database, timeoutMs?: number): SSHHostKeyHandler {
  return new SSHHostKeyHandler(database, timeoutMs)
}
