import { spawn, execSync, spawnSync } from 'child_process'
import path from 'path'
import os from 'os'
import { promises as fs, accessSync, constants } from 'fs'
import { logger } from '../utils/logger'
import { createGitIdentityEnv, resolveGitIdentity } from '../utils/git-auth'
import {
  buildSSHCommandWithKnownHosts,
  buildSSHCommandWithConfig,
  writePersistentSSHKey,
  stripKeyPassphrase,
  writeSSHConfig,
  generateSSHConfig,
  cleanupPersistentSSHKeys,
  parseSSHHost
} from '../utils/ssh-key-manager'
import { decryptSecret } from '../utils/crypto'
import { BLOCKED_SERVER_ENV_KEYS, DEFAULT_SERVER_ENV_VARS } from '@opencode-manager/shared'
import { SettingsService } from './settings'
import { getWorkspacePath, getOpenCodeConfigFilePath, ENV } from '@opencode-manager/shared/config/env'
import { parseJsonc } from '@opencode-manager/shared/utils'
import type { Database } from 'bun:sqlite'
import { compareVersions } from '../utils/version-utils'
import { patchConfigWithRecovery } from './opencode/config-recovery'
import type { OpenCodeClient } from './opencode/client'
import { writeFileContent } from './file-operations'
import { getOrCreateInternalToken } from './internal-token'
import { installManagedPlugins } from './opencode/plugin-registry'
import { getEnforcedSandboxShellPath, installSandboxShell } from './sandbox/shell-wrapper'
import { getOpenCodePluginDiscoveryHome, quarantineOpenCodePlugins, restoreQuarantinedOpenCodePlugins } from './opencode-plugin-quarantine'
import { sanitizeConfigForEnforcement } from './opencode/enforcement-config'
import { resolveProcessIdentityProvider } from './opencode/process-identity'
import { resolveEffectiveServerHost } from './opencode/upstream'
import { SandboxRuntimeService } from './sandbox/runtime'
import { CredentialProvider } from './credential-provider'
import { mkdirSafe, writeFileAtomic } from '../utils/fs-safe'

export { sanitizeConfigForEnforcement }


const MIN_OPENCODE_VERSION = '1.0.137'
const MAX_STDERR_SIZE = 10240
const PLUGIN_INSTALL_TIMEOUT_MS = 120000
const PROCESS_EXIT_GRACE_MS = 2000
const PROCESS_EXIT_POLL_MS = 50
const CHILD_STATE_MARKER_REFRESH_MS = 60000
const DEPRECATED_PLUGIN_PACKAGES = ['opencode-openai-codex-auth', 'opencode-copilot-auth']

type StartupValidationIssue = {
  path: string
  message: string
}

type OpenCodePluginOptions = Record<string, unknown>
type OpenCodePluginSpec = string | [string, OpenCodePluginOptions]

export class ConfigReloadError extends Error {
  validationIssues: StartupValidationIssue[]
  removedFields: string[]

  constructor(message: string, validationIssues: StartupValidationIssue[] = [], removedFields: string[] = []) {
    super(message)
    this.name = 'ConfigReloadError'
    this.validationIssues = validationIssues
    this.removedFields = removedFields
  }
}

export class NonRecoverableStartupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NonRecoverableStartupError'
  }
}

export class OpenCodeOperationBusyError extends Error {
  constructor() {
    super('Another OpenCode server operation is already in progress; refusing to treat a contended transition as completed')
    this.name = 'OpenCodeOperationBusyError'
  }
}

function parseStartupValidationIssues(stderrOutput: string): StartupValidationIssue[] {
  const match = stderrOutput.match(/ZodError:\s*(\[[\s\S]*?\])(?:\n\s+at |$)/)
  if (!match?.[1]) {
    return []
  }

  try {
    const parsed = JSON.parse(match[1]) as Array<{ path?: unknown; message?: unknown }>
    return parsed
      .map((issue) => ({
        path: Array.isArray(issue.path) && issue.path.length > 0 ? issue.path.join('.') : 'root',
        message: typeof issue.message === 'string' ? issue.message : 'Invalid value',
      }))
      .filter((issue) => issue.message)
  } catch {
    return []
  }
}

function formatStartupError(stderrOutput: string, fallback: string): string {
  const validationIssues = parseStartupValidationIssues(stderrOutput)
  if (validationIssues.length === 0) {
    return fallback
  }

  const summary = validationIssues
    .slice(0, 8)
    .map((issue) => `${issue.path}: ${issue.message}`)
    .join('; ')

  const remainder = validationIssues.length > 8
    ? ` (${validationIssues.length - 8} more issue${validationIssues.length - 8 === 1 ? '' : 's'})`
    : ''

  return `OpenCode config validation failed: ${summary}${remainder}`
}

// Helper getters to ensure values are computed at runtime (not module load time)
// This allows proper mocking in tests
const getOpenCodeServerDirectory = () => getWorkspacePath()
const getOpenCodeConfigPath = () => getOpenCodeConfigFilePath()
const getOpenCodeServerPort = () => ENV.OPENCODE.PORT
const getOpenCodeServerHost = () => ENV.OPENCODE.HOST
const getOpenCodeServerPublicUrl = () => ENV.OPENCODE.PUBLIC_URL
const getOpenCodeServerUsername = () => ENV.OPENCODE.SERVER_USERNAME

function resolveManagerMicrosandboxEnv(): Record<string, string> {
  const env: Record<string, string> = {
    MSB_BACKEND: process.env.MSB_BACKEND ?? 'local',
    MSB_HOME: process.env.MSB_HOME ?? path.join(process.env.HOME ?? os.homedir(), '.microsandbox'),
    MSB_PATH: ENV.SANDBOX?.MSB_PATH ?? process.env.MSB_PATH ?? 'msb',
  }
  if (process.env.MSB_LIBKRUNFW_PATH) env.MSB_LIBKRUNFW_PATH = process.env.MSB_LIBKRUNFW_PATH
  if (process.env.MSB_PROFILE) env.MSB_PROFILE = process.env.MSB_PROFILE
  if (process.env.MSB_API_URL) env.MSB_API_URL = process.env.MSB_API_URL
  if (process.env.MSB_API_KEY) env.MSB_API_KEY = process.env.MSB_API_KEY
  return env
}

function readProcessGroupId(pid: number): number | null {
  return resolveProcessIdentityProvider().readProcessStat(pid)?.pgrp ?? null
}

function processGroupExists(pgid: number): boolean {
  try {
    process.kill(-pgid, 0)
    return true
  } catch (error) {
    const errorCode = error && typeof error === 'object' && 'code' in error ? (error as { code: string }).code : ''
    return errorCode !== 'ESRCH'
  }
}

const CHILD_STATE_MARKER_FILENAME = 'opencode-server-child.json'
const getChildStateMarkerPath = () => path.join(getOpenCodeServerDirectory(), '.opencode', 'state', CHILD_STATE_MARKER_FILENAME)
const RESTART_GENERATION_KEY = 'opencode_restart_generation'

type ChildStateMarker = {
  pid: number
  pgid: number | null
  enforced: boolean
  startToken: string
  generation: number
  groupMembers: Array<{ pid: number; startToken: string }>
}

function readProcessStartToken(pid: number): string | null {
  return resolveProcessIdentityProvider().readProcessStat(pid)?.startToken ?? null
}

async function readProcessStartTokenWithRetry(pid: number): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const token = readProcessStartToken(pid)
    if (token !== null) return token
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return null
}

async function readProcessGroupIdWithRetry(pid: number): Promise<number | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const pgid = readProcessGroupId(pid)
    if (pgid !== null) return pgid
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return null
}

function readDurableRestartGeneration(db: Database | null): number {
  if (!db) return 0
  try {
    const row = db.prepare('SELECT value FROM app_secrets WHERE key = ?').get(RESTART_GENERATION_KEY) as { value: string } | undefined
    if (row === undefined) return 0
    const parsed = Number(row.value)
    return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0
  } catch {
    return 0
  }
}

function advanceDurableRestartGeneration(db: Database | null): void {
  if (!db) return
  const next = readDurableRestartGeneration(db) + 1
  const now = Date.now()
  try {
    db.prepare(`
      INSERT INTO app_secrets (key, value, created_at, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(RESTART_GENERATION_KEY, String(next), now, now)
  } catch (error) {
    logger.warn('Failed to persist the OpenCode restart generation:', error)
  }
}

async function writeChildStateMarker(marker: ChildStateMarker): Promise<void> {
  await writeFileAtomic(getChildStateMarkerPath(), JSON.stringify(marker, null, 2))
}

async function readChildStateMarker(): Promise<ChildStateMarker | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(getChildStateMarkerPath(), 'utf-8')) as Record<string, unknown>
    if (
      typeof parsed.pid === 'number' &&
      typeof parsed.enforced === 'boolean' &&
      typeof parsed.startToken === 'string' &&
      typeof parsed.generation === 'number'
    ) {
      const pgid = typeof parsed.pgid === 'number' && parsed.pgid > 0 ? parsed.pgid : null
      const groupMembers = Array.isArray(parsed.groupMembers)
        ? parsed.groupMembers.filter(
          (member): member is { pid: number; startToken: string } =>
            member !== null &&
            typeof member === 'object' &&
            !Array.isArray(member) &&
            typeof (member as { pid?: unknown }).pid === 'number' &&
            typeof (member as { startToken?: unknown }).startToken === 'string',
        )
        : []
      return {
        pid: parsed.pid,
        pgid,
        enforced: parsed.enforced,
        startToken: parsed.startToken,
        generation: parsed.generation,
        groupMembers,
      }
    }
  } catch {
    return null
  }
  return null
}

async function removeChildStateMarker(): Promise<void> {
  try {
    await fs.rm(getChildStateMarkerPath(), { force: true })
  } catch (error) {
    logger.warn('Failed to remove the OpenCode child state marker:', error)
  }
}

export function resolveOpenCodeExecutable(): string | null {
  const candidates = [
    process.env.OPENCODE_BIN,
    '/usr/local/bin/opencode',
    '/opt/opencode/bin/opencode',
    path.join(getOpenCodePluginDiscoveryHome(), '.opencode', 'bin', 'opencode'),
  ].filter((candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0)
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK)
      return candidate
    } catch {
      // try the next candidate
    }
  }
  return null
}

class OpenCodeServerManager {
  private static instance: OpenCodeServerManager
  private serverProcess: ReturnType<typeof spawn> | null = null
  private serverPid: number | null = null
  private isHealthy: boolean = false
  private db: Database | null = null
  private version: string | null = null
  private lastStartupError: string | null = null
  private lastStartupErrorNonRecoverable = false
  private restartPending: boolean = false
  private restartPendingGeneration: number = 0
  private opInProgress: boolean = false
  private openCodeClient: OpenCodeClient | null = null
  private sandboxEnforced: boolean = false
  private lifecycleInitialized: boolean = false
  private markerRefreshTimer: ReturnType<typeof setInterval> | null = null

  private constructor() {}

  setDatabase(db: Database) {
    this.db = db
  }

  setOpenCodeClient(client: OpenCodeClient) {
    this.openCodeClient = client
  }

  async rebuildClient(): Promise<void> {
    const password = this.getResolvedPassword()
    const { createOpenCodeClient } = await import('./opencode/client')
    this.openCodeClient = createOpenCodeClient(password, resolveEffectiveServerHost(this.sandboxEnforced))
  }

  getEffectiveServerHost(): string {
    return resolveEffectiveServerHost(this.sandboxEnforced)
  }

  private getResolvedPassword(): string {
    if (this.db) {
      const settingsService = new SettingsService(this.db)
      return settingsService.getOpenCodeServerPassword()
    }
    return ENV.OPENCODE.SERVER_PASSWORD
  }

  private requireClient(): OpenCodeClient {
    if (!this.openCodeClient) {
      throw new Error('OpenCodeClient not configured on OpenCodeServerManager. Call setOpenCodeClient() during startup.')
    }
    return this.openCodeClient
  }

  static getInstance(): OpenCodeServerManager {
    if (!OpenCodeServerManager.instance) {
      OpenCodeServerManager.instance = new OpenCodeServerManager()
    }
    return OpenCodeServerManager.instance
  }

  /**
   * Test-only method to reset the singleton instance.
   * Should only be used in test setup/teardown.
   */
  static resetInstance(): void {
    const instance = OpenCodeServerManager.instance
    if (instance) {
      instance.stopChildStateMarkerRefresh()
    }
    OpenCodeServerManager.instance = null as unknown as OpenCodeServerManager
  }

  private acquireOp(): boolean {
    if (this.opInProgress) {
      return false
    }

    this.opInProgress = true
    return true
  }

  private releaseOp(acquired: boolean): void {
    if (acquired) {
      this.opInProgress = false
    }
  }

  isOperationInProgress(): boolean {
    return this.opInProgress
  }

  async start(retryAfterPluginInstall = true, allowNested = false): Promise<void> {
    const acquired = this.acquireOp()
    if (!acquired && !allowNested) {
      throw new OpenCodeOperationBusyError()
    }

    try {
      const restartGenerationAtStart = this.restartPendingGeneration
      if (this.isHealthy) {
        logger.info('OpenCode server already running and healthy')
        return
      }

    const isDevelopment = ENV.SERVER.NODE_ENV !== 'production'
    let sandboxEnforced = false
    if (this.db) {
      try {
        sandboxEnforced = new SandboxRuntimeService(this.db).isEnabled()
      } catch (error) {
        sandboxEnforced = true
        this.sandboxEnforced = true
        const message = `Failed to determine sandbox enforcement state: ${error instanceof Error ? error.message : String(error)}`
        let existingProcesses: Array<{pid: number}> = []
        try {
          existingProcesses = await this.findProcessesByPort(getOpenCodeServerPort())
        } catch (inspectionError) {
          this.failNonRecoverable(
            `${message}; port-owner inspection failed: ${inspectionError instanceof Error ? inspectionError.message : String(inspectionError)}`,
          )
        }
        try {
          await this.terminateAttestedPredecessor(PROCESS_EXIT_GRACE_MS)
          if (existingProcesses.length > 0) {
            await this.terminatePortOwners(existingProcesses, PROCESS_EXIT_GRACE_MS)
          }
        } catch (cleanupError) {
          this.failNonRecoverable(
            `${message}; the previous OpenCode server could not be proven terminated and may still be reachable: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
          )
        }
        this.failNonRecoverable(message)
      }
      if (!sandboxEnforced && this.sandboxEnforced) {
        try {
          await new SandboxRuntimeService(this.db).stopWorkspaceSandboxForToggle()
          logger.info('Sandbox enforcement disabled: stopped the shared workspace microVM')
        } catch (error) {
          this.failNonRecoverable(`Failed to stop the workspace sandbox while disabling enforcement: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      logger.info(`OpenCode sandbox enforcement: ${sandboxEnforced ? 'enabled' : 'disabled'}`)
    }

    const password = this.getResolvedPassword()
    const openCodeServerHost = getOpenCodeServerHost()
    const effectiveServerHost = resolveEffectiveServerHost(sandboxEnforced)
    if (effectiveServerHost !== openCodeServerHost) {
      logger.warn(`Sandbox enforcement requires the OpenCode server to bind loopback only; overriding OPENCODE_HOST=${openCodeServerHost} with 127.0.0.1 so external clients cannot bypass the Manager proxy policy`)
    }
    const isExposed = openCodeServerHost !== '127.0.0.1' && openCodeServerHost !== 'localhost'
    if (isExposed && !password && !sandboxEnforced) {
      const msg = `OPENCODE_HOST=${openCodeServerHost} exposes the OpenCode server externally but no password is configured. Set OPENCODE_SERVER_PASSWORD env var or configure a password via Settings → OpenCode → Server Auth.`
      this.lastStartupError = msg
      logger.error(msg)
      throw new Error(msg)
    }

    let credentialProvider: CredentialProvider | null = null
    let gitIdentityEnv: Record<string, string> = {}
    let userEnvVars: Record<string, string> = {}
    if (this.db) {
      try {
        credentialProvider = new CredentialProvider(this.db)
        const settingsService = new SettingsService(this.db)
        const settings = settingsService.getSettings('default')
        const gitCredentials = credentialProvider.getGitCredentials()
        const disabledDefaultEnvVars = new Set(settings.preferences.disabledDefaultServerEnvVars || [])
        const rawEnvVars = [
          ...DEFAULT_SERVER_ENV_VARS.filter((envVar) => !disabledDefaultEnvVars.has(envVar.key)),
          ...(settings.preferences.serverEnvVars || []),
        ]
        if (rawEnvVars.length > 0) {
          userEnvVars = Object.fromEntries(
            rawEnvVars
              .filter(({ key }) => {
                const normalizedKey = key.trim()
                return (
                  normalizedKey !== '' &&
                  !(BLOCKED_SERVER_ENV_KEYS as readonly string[]).includes(normalizedKey) &&
                  !normalizedKey.startsWith('MSB_')
                )
              })
              .map(({ key, value }) => [key.trim(), value])
          )
          logger.info(`Injecting ${Object.keys(userEnvVars).length} custom server env vars`)
        }

        const identity = await resolveGitIdentity(settings.preferences.gitIdentity, gitCredentials)
        if (identity) {
          gitIdentityEnv = createGitIdentityEnv(identity)
          logger.info(`Git identity resolved: ${identity.name} <${identity.email}>`)
        }
      } catch (error) {
        logger.warn('Failed to get git settings:', error)
      }
    }

    this.sandboxEnforced = sandboxEnforced
    if (sandboxEnforced && !resolveProcessIdentityProvider().attested) {
      this.failNonRecoverable(
        'Sandbox enforcement requires process identity attestation, which is unavailable on this platform; refusing to run an enforced server',
      )
    }
    await this.rebuildClient()
    const durableRestartGeneration = readDurableRestartGeneration(this.db)

    const openCodeServerPort = getOpenCodeServerPort()
    let existingProcesses: Array<{pid: number}> = []
    try {
      existingProcesses = await this.findProcessesByPort(openCodeServerPort)
    } catch (inspectionError) {
      const inspectionMessage = `Cannot inspect port ${openCodeServerPort} ownership: ${inspectionError instanceof Error ? inspectionError.message : String(inspectionError)}`
      if (sandboxEnforced) {
        this.failNonRecoverable(inspectionMessage)
      }
      logger.warn(inspectionMessage)
    }
    let replacingExistingServer = false
    if (sandboxEnforced) {
      await this.terminateAttestedPredecessor(PROCESS_EXIT_GRACE_MS)
      if (existingProcesses.length > 0) {
        logger.warn('Sandbox enforcement enabled: killing existing OpenCode server to guarantee a sandboxed startup')
        await this.terminatePortOwners(existingProcesses, PROCESS_EXIT_GRACE_MS)
        replacingExistingServer = true
      }
    } else if (existingProcesses.length > 0) {
      logger.info(`OpenCode server already running on port ${openCodeServerPort}`)
      const healthy = await this.checkHealth()
      if (healthy) {
        if (isDevelopment) {
          logger.warn('Development mode: Killing existing server for hot reload')
          await this.terminatePortOwners(existingProcesses, PROCESS_EXIT_GRACE_MS)
          replacingExistingServer = true
        } else {
          const childState = await readChildStateMarker()
          const attestedUnenforced = childState !== null
            && childState.enforced === false
            && childState.generation === durableRestartGeneration
            && childState.startToken !== ''
            && childState.startToken === readProcessStartToken(childState.pid)
            && existingProcesses.some((proc) => proc.pid === childState.pid)
          if (attestedUnenforced) {
            this.isHealthy = true
            this.serverPid = childState.pid
            return
          }
          logger.warn(`Existing OpenCode server on port ${openCodeServerPort} is not attested as a matching unenforced child; terminating it to guarantee consistent sandbox enforcement`)
          await this.terminatePortOwners(existingProcesses, PROCESS_EXIT_GRACE_MS)
          replacingExistingServer = true
        }
      } else {
        logger.warn('Killing unhealthy OpenCode server')
        await this.terminatePortOwners(existingProcesses, PROCESS_EXIT_GRACE_MS)
        replacingExistingServer = true
      }
    }

    await this.reconcileExitedChildMarker(PROCESS_EXIT_GRACE_MS)

    const openCodeServerDirectory = getOpenCodeServerDirectory()
    const openCodeConfigPath = getOpenCodeConfigPath()
    logger.info(`OpenCode server working directory: ${openCodeServerDirectory}`)
    logger.info(`OpenCode XDG_CONFIG_HOME: ${path.join(openCodeServerDirectory, '.config')}`)
    logger.info(`OpenCode will use ?directory= parameter for session isolation`)

    const gitEnv = credentialProvider?.getGitEnv() ?? {}
    const knownHostsPath = path.join(getWorkspacePath(), 'config', 'known_hosts')
    let gitSshCommand: string
    let sshConfigPath: string | null = null

    const sshCredentials = credentialProvider?.getSshCredentialsWithPrivateKey() ?? []
    if (sshCredentials.length > 0) {
      logger.info(`Setting up ${sshCredentials.length} SSH credential(s) for OpenCode server`)

      const sshConfigEntries: Array<{ hostname: string, port: string, keyPath: string }> = []

      for (const cred of sshCredentials) {
        try {
          const { host, port } = parseSSHHost(cred.host)
          const privateKey = decryptSecret(cred.sshPrivateKeyEncrypted!)
          const keyPath = await writePersistentSSHKey(privateKey, cred.name)

          if (cred.passphrase) {
            const passphrase = decryptSecret(cred.passphrase)
            await stripKeyPassphrase(keyPath, passphrase)
            logger.info(`Stripped passphrase from SSH key for ${cred.name} (${host}:${port})`)
          } else {
            logger.info(`Setup SSH key for ${cred.name} (${host}:${port}): ${keyPath}`)
          }

          sshConfigEntries.push({ hostname: host, port, keyPath })
        } catch (error) {
          logger.error(`Failed to setup SSH key for ${cred.name}:`, error)
        }
      }

      if (sshConfigEntries.length > 0) {
        const sshConfigContent = generateSSHConfig(sshConfigEntries)
        sshConfigPath = path.join(getWorkspacePath(), 'config', 'ssh_config')
        await writeSSHConfig(sshConfigPath, sshConfigContent)
        gitSshCommand = buildSSHCommandWithConfig(sshConfigPath, knownHostsPath)
        logger.info(`OpenCode server SSH config written to ${sshConfigPath} with ${sshConfigEntries.length} host(s)`)
      } else {
        gitSshCommand = buildSSHCommandWithKnownHosts(knownHostsPath)
        logger.warn(`No SSH credentials could be set up, using default known_hosts only`)
      }
    } else {
      gitSshCommand = buildSSHCommandWithKnownHosts(knownHostsPath)
    }

    logger.info(`OpenCode server GIT_SSH_COMMAND: ${gitSshCommand}`)

    await this.initializeOpencodeBinDirectory()
    const pluginConfigHome = path.join(openCodeServerDirectory, '.config')
    try {
      if (sandboxEnforced) {
        await quarantineOpenCodePlugins(pluginConfigHome, openCodeConfigPath)
      } else {
        await restoreQuarantinedOpenCodePlugins(pluginConfigHome, openCodeConfigPath)
      }
    } catch (error) {
      if (sandboxEnforced) {
        logger.error('Failed to quarantine untrusted OpenCode plugins; refusing to start an enforced server', error)
        this.failNonRecoverable(error instanceof Error ? error.message : String(error))
      }
      logger.warn('Failed to restore quarantined OpenCode plugins:', error)
    }
    try {
      await installManagedPlugins(pluginConfigHome)
      await installSandboxShell(pluginConfigHome)
    } catch (error) {
      if (sandboxEnforced) {
        logger.error('Failed to install a generated OpenCode plugin; refusing to start an enforced server', error)
        this.failNonRecoverable(error instanceof Error ? error.message : String(error))
      }
      logger.warn('Failed to install a generated OpenCode plugin (sandboxing is disabled):', error)
    }
    const configuredPlugins = sandboxEnforced ? [] : await this.getConfiguredPlugins(openCodeConfigPath)
    await this.installConfiguredPlugins(configuredPlugins)
    const configuredPluginCount = configuredPlugins.length
    const openCodeExecutable = resolveOpenCodeExecutable() ?? 'opencode'

    let stderrOutput = ''

    const microsandboxEnv = resolveManagerMicrosandboxEnv()

    const cleanEnv = { ...process.env }
    delete cleanEnv.OPENCODE_SERVER_PASSWORD
    delete cleanEnv.OPENCODE_RUN_ID
    delete cleanEnv.OPENCODE_PROCESS_ROLE
    delete cleanEnv.OPENCODE_PID
    delete cleanEnv.OPENCODE
    delete cleanEnv.OPENCODE_CONFIG_CONTENT
    delete cleanEnv.OPENCODE_CONFIG_DIR
    delete cleanEnv.OPENCODE_PURE
    delete cleanEnv.OPENCODE_AUTH_CONTENT
    delete cleanEnv.OPENCODE_TEST_HOME
    delete cleanEnv.OPENCODE_TEST_MANAGED_CONFIG_DIR
    delete cleanEnv.SHELL
    delete cleanEnv.BASH_ENV
    delete cleanEnv.ENV

    this.serverProcess = spawn(
      openCodeExecutable,
      ['serve', '--port', openCodeServerPort.toString(), '--hostname', effectiveServerHost],
      {
        cwd: openCodeServerDirectory,
        detached: !isDevelopment,
        stdio: isDevelopment ? 'inherit' : ['ignore', 'pipe', 'pipe'],
        env: {
          ...cleanEnv,
          ...userEnvVars,
          ...microsandboxEnv,
          ...gitEnv,
          ...gitIdentityEnv,
          ...(this.db
            ? {
              OCM_INTERNAL_API_URL: `http://localhost:${ENV.SERVER.PORT}/api/internal`,
              OCM_INTERNAL_TOKEN: getOrCreateInternalToken(this.db),
            }
            : {}),
          OCM_SANDBOX_ENFORCED: sandboxEnforced ? 'true' : 'false',
          OPENCODE_PURE: 'false',
          ...(sandboxEnforced ? { OPENCODE_DISABLE_PROJECT_CONFIG: '1' } : {}),
          ...(sandboxEnforced ? { HOME: getOpenCodePluginDiscoveryHome() } : {}),
          GIT_SSH_COMMAND: gitSshCommand,
          XDG_DATA_HOME: path.join(openCodeServerDirectory, '.opencode/state'),
          XDG_STATE_HOME: path.join(openCodeServerDirectory, '.opencode/state'),
          XDG_CONFIG_HOME: path.join(openCodeServerDirectory, '.config'),
          ...(getOpenCodeServerPublicUrl() ? { OPENCODE_PUBLIC_URL: getOpenCodeServerPublicUrl() } : {}),
          ...(password
            ? {
              OPENCODE_SERVER_PASSWORD: password,
              OPENCODE_SERVER_USERNAME: getOpenCodeServerUsername(),
            }
            : {}),
          OPENCODE_CONFIG: openCodeConfigPath,
          ...(sandboxEnforced ? { SHELL: getEnforcedSandboxShellPath() } : {}),
        }
      }
    )

    if (!isDevelopment && this.serverProcess.stderr) {
      this.serverProcess.stderr.on('data', (data) => {
        stderrOutput += data.toString()
        if (stderrOutput.length > MAX_STDERR_SIZE) {
          stderrOutput = stderrOutput.slice(-MAX_STDERR_SIZE)
        }
      })
    }

    const spawnedServerPid = this.serverProcess.pid
    this.serverProcess.on('exit', (code, signal) => {
      if (spawnedServerPid !== undefined && this.serverPid === spawnedServerPid) {
        this.serverPid = null
        this.isHealthy = false
        this.stopChildStateMarkerRefresh()
      }
      if (code !== null && code !== 0) {
        const fallback = `Server exited with code ${code}${stderrOutput ? `: ${stderrOutput.slice(-500)}` : ''}`
        this.lastStartupError = formatStartupError(stderrOutput, fallback)
        logger.error('OpenCode server process exited:', this.lastStartupError)
      } else if (signal) {
        this.lastStartupError = `Server terminated by signal ${signal}`
        logger.error('OpenCode server process terminated:', this.lastStartupError)
      }
    })

    this.serverPid = this.serverProcess.pid ?? null
    if (this.serverPid !== null) {
      if (!isDevelopment) {
        if (!resolveProcessIdentityProvider().attested) {
          logger.warn('Process identity attestation is unavailable on this platform; tracking the OpenCode server as a direct child without PID-reuse attestation')
        } else {
          const startToken = await readProcessStartTokenWithRetry(this.serverPid)
          if (startToken === null) {
            const message = 'Failed to read the process identity of the freshly spawned OpenCode server; refusing to detach an unattestable child'
            this.lastStartupError = message
            logger.error(message)
            await this.stop(true)
            throw new Error(message)
          }
          try {
            const processGroup = await readProcessGroupIdWithRetry(this.serverPid)
            const groupMembers = processGroup !== null && processGroup === this.serverPid
              ? resolveProcessIdentityProvider().readProcessGroupMembers(processGroup)
              : []
            await writeChildStateMarker({
              pid: this.serverPid,
              pgid: processGroup !== null && processGroup === this.serverPid ? processGroup : null,
              enforced: sandboxEnforced,
              startToken,
              generation: durableRestartGeneration,
              groupMembers,
            })
          } catch (error) {
            const message = `Failed to persist the OpenCode child state marker: ${error instanceof Error ? error.message : String(error)}`
            this.lastStartupError = message
            logger.error(message)
            await this.stop(true)
            throw new Error(message)
          }
          this.startChildStateMarkerRefresh()
        }
      }
    }

    logger.info(`OpenCode server started with PID ${this.serverPid}`)

    const healthTimeoutMs = configuredPluginCount > 0 ? 120000 : 30000
    const healthy = await this.waitForHealth(healthTimeoutMs)
    if (!healthy) {
      const fallback = `Server failed to become healthy after ${Math.round(healthTimeoutMs / 1000)}s${stderrOutput ? `. Last error: ${stderrOutput.slice(-500)}` : ''}`
      this.lastStartupError = formatStartupError(stderrOutput, fallback)
      if (configuredPluginCount > 0 && retryAfterPluginInstall) {
        logger.warn(`OpenCode server did not become healthy after installing ${configuredPluginCount} configured plugin(s); restarting once`)
        await this.stop(true)
        await new Promise(r => setTimeout(r, 1000))
        await this.start(false, true)
        return
      }
      throw new Error('OpenCode server failed to become healthy')
    }

    if (sandboxEnforced || replacingExistingServer) {
      let portOwners: Array<{pid: number}> = []
      try {
        portOwners = await this.findProcessesByPort(openCodeServerPort)
      } catch (inspectionError) {
        const message = `Could not verify port ${openCodeServerPort} ownership after health; refusing to mark the server healthy: ${inspectionError instanceof Error ? inspectionError.message : String(inspectionError)}`
        this.lastStartupError = message
        logger.error(message)
        await this.stop(true)
        throw new Error(message)
      }
      if (this.serverPid === null || !portOwners.some((proc) => proc.pid === this.serverPid)) {
        const owners = portOwners.length > 0 ? `; port ${openCodeServerPort} is owned by PID(s) ${portOwners.map((proc) => proc.pid).join(', ')}` : `; no process owns port ${openCodeServerPort}`
        const message = `The newly started OpenCode server (PID ${this.serverPid ?? 'unknown'}) does not own the OpenCode port${owners}; refusing to mark the server healthy`
        this.lastStartupError = message
        logger.error(message)
        await this.stop(true)
        throw new Error(message)
      }
    }

    this.isHealthy = true
    if (this.restartPendingGeneration === restartGenerationAtStart) {
      this.restartPending = false
    }
    logger.info('OpenCode server is healthy')

    await this.fetchVersion()
    if (this.version) {
      logger.info(`OpenCode version: ${this.version}`)
      if (!this.isVersionSupported()) {
        logger.warn(`OpenCode version ${this.version} is below minimum required version ${MIN_OPENCODE_VERSION}`)
        logger.warn('Some features like MCP management may not work correctly')
      }
    }
    } finally {
      this.releaseOp(acquired)
    }
  }

  async stop(allowNested = false): Promise<void> {
    const acquired = this.acquireOp()
    if (!acquired && !allowNested) {
      return
    }

    try {
      if (!this.serverPid) {
        await this.reconcileExitedChildMarker(PROCESS_EXIT_GRACE_MS)
        return
      }

      logger.info('Stopping OpenCode server')
      const pid = this.serverPid
      const marker = await readChildStateMarker()
      let groupTarget: number | null = null

      if (marker !== null && marker.pid === pid) {
        const target = this.resolveAttestedProcessTarget(marker)
        if (!target.pidAttested && !target.groupAttested) {
          this.isHealthy = false
          logger.warn(
            `Refusing to signal PID ${pid}: its process identity no longer matches the attested child state marker; the tracked child has exited and its PID may have been reused`,
          )
          return
        }
        groupTarget = target.groupTarget
      } else if (marker !== null) {
        this.isHealthy = false
        logger.warn(`Refusing to signal PID ${pid}: it does not match the child state marker PID ${marker.pid}`)
        return
      } else {
        const pgid = readProcessGroupId(pid)
        if (pgid !== null && pgid === pid) {
          groupTarget = pid
        }
      }

      if (groupTarget !== null) {
        logger.info(`Terminating OpenCode process group ${groupTarget} so host-executed descendants do not survive the stop`)
      }
      try {
        await this.terminateAndConfirm(
          pid,
          groupTarget,
          PROCESS_EXIT_GRACE_MS,
          'OpenCode server',
          'retained live processes after SIGTERM and SIGKILL; refusing to complete the stop while host-executed processes may survive',
        )
      } catch (error) {
        this.isHealthy = false
        throw error
      }

      this.serverPid = null
      this.isHealthy = false
      this.stopChildStateMarkerRefresh()

      await removeChildStateMarker()

      try {
        await cleanupPersistentSSHKeys()
      } catch (error) {
        logger.warn('Failed to cleanup persistent SSH keys:', error)
      }
    } finally {
      this.releaseOp(acquired)
    }
  }

  private async initializeOpencodeBinDirectory(): Promise<void> {
    const binDir = path.join(
      getOpenCodeServerDirectory(),
      '.opencode',
      'state',
      'opencode',
      'bin'
    )

    const packageJsonPath = path.join(binDir, 'package.json')

    try {
      await mkdirSafe(binDir)

      const packageJsonExists = await fs.access(packageJsonPath)
        .then(() => true)
        .catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return false
          throw error
        })

      if (!packageJsonExists) {
        try {
          execSync('bun init -y', {
            cwd: binDir,
            stdio: 'inherit',
            timeout: 30000
          })
          logger.info('OpenCode bin directory initialized successfully')
        } catch (error) {
          logger.error('bun init failed:', error)
          throw new Error(`bun init failed: ${error}`)
        }
      }

    } catch (error) {
      logger.error('Failed to initialize OpenCode bin directory:', error)
    }
  }

  private isPathPluginSpec(spec: string): boolean {
    return spec.startsWith('file://') || spec.startsWith('.') || path.isAbsolute(spec)
  }

  private getPluginInstallSpec(spec: string): string {
    if (spec.startsWith('@')) {
      const slashIndex = spec.indexOf('/')
      return slashIndex !== -1 && spec.indexOf('@', slashIndex + 1) === -1 ? `${spec}@latest` : spec
    }
    return spec.includes('@') ? spec : `${spec}@latest`
  }

  private getPluginPackageName(spec: string): string {
    if (spec.startsWith('@')) {
      const slashIndex = spec.indexOf('/')
      if (slashIndex === -1) return spec
      const versionIndex = spec.indexOf('@', slashIndex + 1)
      return versionIndex === -1 ? spec : spec.slice(0, versionIndex)
    }
    const versionIndex = spec.indexOf('@')
    return versionIndex === -1 ? spec : spec.slice(0, versionIndex)
  }

  private sanitizeNpmCacheSegment(spec: string): string {
    if (process.platform !== 'win32') return spec
    return Array.from(spec, (char) => /[<>:"|?*]/.test(char) || char.charCodeAt(0) < 32 ? '_' : char).join('')
  }

  private getPluginSpecifier(plugin: OpenCodePluginSpec): string {
    return Array.isArray(plugin) ? plugin[0] : plugin
  }

  private isOpenCodePluginSpec(plugin: unknown): plugin is OpenCodePluginSpec {
    if (typeof plugin === 'string') return plugin.trim().length > 0
    if (!Array.isArray(plugin) || plugin.length !== 2 || typeof plugin[0] !== 'string' || plugin[0].trim().length === 0) return false
    const options = plugin[1]
    return options !== null && typeof options === 'object' && !Array.isArray(options)
  }

  private async getConfiguredPlugins(configPath: string): Promise<OpenCodePluginSpec[]> {
    try {
      const content = await fs.readFile(configPath, 'utf-8')
      const config = parseJsonc(content) as { plugin?: unknown }
      if (!Array.isArray(config.plugin)) return []
      return config.plugin
        .filter((plugin): plugin is OpenCodePluginSpec => this.isOpenCodePluginSpec(plugin))
    } catch {
      return []
    }
  }

  private async installConfiguredPlugins(plugins: OpenCodePluginSpec[]): Promise<void> {
    const npmPlugins = plugins
      .map((plugin) => this.getPluginSpecifier(plugin))
      .filter((plugin) => !this.isPathPluginSpec(plugin) && !DEPRECATED_PLUGIN_PACKAGES.some((pkg) => plugin.includes(pkg)))
    if (npmPlugins.length === 0) return

    const cacheHome = process.env.XDG_CACHE_HOME || path.join(process.env.HOME || '/home/node', '.cache')
    logger.info(`Pre-installing ${npmPlugins.length} configured OpenCode plugin(s)`)

    for (const plugin of npmPlugins) {
      const installSpec = this.getPluginInstallSpec(plugin)
      const packageName = this.getPluginPackageName(plugin)
      const installDir = path.join(cacheHome, 'opencode', 'packages', this.sanitizeNpmCacheSegment(installSpec))
      const packageJsonPath = path.join(installDir, 'node_modules', packageName, 'package.json')

      try {
        await fs.access(packageJsonPath)
        logger.info(`OpenCode plugin already installed: ${plugin}`)
        continue
      } catch (error) {
        const errorCode = error && typeof error === 'object' && 'code' in error ? (error as NodeJS.ErrnoException).code : ''
        if (errorCode !== 'ENOENT') {
          logger.warn(`Could not check OpenCode plugin install state for ${plugin}:`, error)
        }
      }

      await mkdirSafe(installDir)
      if (!await fs.access(path.join(installDir, 'package.json')).then(() => true).catch(() => false)) {
        const init = spawnSync('bun', ['init', '-y'], { cwd: installDir, encoding: 'utf8', timeout: 30000 })
        if (init.status !== 0) {
          logger.warn(`Failed to initialize OpenCode plugin cache for ${plugin}: ${init.stderr || init.stdout}`)
          continue
        }
      }

      const result = spawnSync('bun', ['add', '--ignore-scripts', installSpec], { cwd: installDir, encoding: 'utf8', timeout: PLUGIN_INSTALL_TIMEOUT_MS })
      if (result.status === 0) {
        logger.info(`Installed OpenCode plugin: ${plugin}`)
        continue
      }

      if (result.error) {
        logger.warn(`Failed to install OpenCode plugin ${plugin}: ${result.error.message}`)
        continue
      }

      logger.warn(`Failed to install OpenCode plugin ${plugin}: ${result.stderr || result.stdout}`)
    }
  }

  async restart(): Promise<void> {
    const acquired = this.acquireOp()
    if (!acquired) {
      throw new OpenCodeOperationBusyError()
    }

    try {
      logger.info('Restarting OpenCode server (full process restart)')
      await this.stop(true)
      await this.start(false, true)
    } finally {
      this.releaseOp(acquired)
    }
  }

  async reloadConfig(): Promise<void> {
    const acquired = this.acquireOp()
    if (!acquired) {
      throw new OpenCodeOperationBusyError()
    }

    try {
      logger.info('Reloading OpenCode configuration (via API)')
      try {
        const configPath = getOpenCodeConfigFilePath()
        const fileContent = await fs.readFile(configPath, 'utf-8')
        const fileConfig = parseJsonc(fileContent) as Record<string, unknown>
        logger.info(`Read config from file for reload: ${configPath}`)

        const patchTarget = sanitizeConfigForEnforcement(fileConfig, this.sandboxEnforced)
        const patchResult = await patchConfigWithRecovery(this.requireClient(), patchTarget)
        if (!patchResult.success) {
          const errorMessage = patchResult.error || 'Failed to reload config'
          const validationIssues = patchResult.details || []
          const removedFields = patchResult.removedFields || []
          if (validationIssues.length > 0) {
            const issueSummary = validationIssues.map((d) => `${d.path}: ${d.message}`).join('; ')
            logger.error(`Config reload validation errors: ${issueSummary}`)
          }
          if (removedFields.length > 0) {
            logger.info(`Removed fields during config reload: ${removedFields.join(', ')}`)
          }
          throw new ConfigReloadError(errorMessage, validationIssues, removedFields)
        }

        if (patchResult.removedFields && patchResult.removedFields.length > 0 && patchResult.appliedConfig) {
          await writeFileContent(configPath, JSON.stringify(patchResult.appliedConfig, null, 2))
          logger.info(`Persisted cleaned config to ${configPath} after removing fields: ${patchResult.removedFields.join(', ')}`)
        }

        logger.info('OpenCode configuration reloaded successfully')
        await new Promise(r => setTimeout(r, 500))
        const healthy = await this.checkHealth()
        if (!healthy) {
          throw new Error('Server unhealthy after config reload')
        }
      } catch (error) {
        logger.error('Failed to reload OpenCode config:', error)
        throw error
      }
    } finally {
      this.releaseOp(acquired)
    }
  }

  getPort(): number {
    return getOpenCodeServerPort()
  }

  getVersion(): string | null {
    return this.version
  }

  getMinVersion(): string {
    return MIN_OPENCODE_VERSION
  }

  isVersionSupported(): boolean {
    if (!this.version) return false
    return compareVersions(this.version, MIN_OPENCODE_VERSION) >= 0
  }

  getLastStartupError(): string | null {
    return this.lastStartupError
  }

  isLastStartupErrorNonRecoverable(): boolean {
    return this.lastStartupErrorNonRecoverable
  }

  clearStartupError(): void {
    this.lastStartupError = null
    this.lastStartupErrorNonRecoverable = false
  }

  private failNonRecoverable(message: string): never {
    this.lastStartupError = message
    this.lastStartupErrorNonRecoverable = true
    logger.error(message)
    throw new NonRecoverableStartupError(message)
  }

  isRestartPending(): boolean {
    return this.restartPending
  }

  isSandboxEnforced(): boolean {
    return this.sandboxEnforced
  }

  setLifecycleInitialized(initialized: boolean): void {
    this.lifecycleInitialized = initialized
  }

  isLifecycleInitialized(): boolean {
    return this.lifecycleInitialized
  }

  markRestartPending(): void {
    this.restartPending = true
    this.restartPendingGeneration += 1
    advanceDurableRestartGeneration(this.db)
  }

  async reinitializeBinDirectory(): Promise<void> {
    logger.info('Reinitializing OpenCode bin directory')
    await this.initializeOpencodeBinDirectory()
  }

  async checkHealth(): Promise<boolean> {
    if (!this.openCodeClient) {
      return false
    }
    try {
      const response = await this.openCodeClient.forward({
        method: 'GET',
        path: '/global/health',
        signal: AbortSignal.timeout(ENV.TIMEOUTS.HEALTH_CHECK_TIMEOUT_MS),
      })
      return response.ok
    } catch {
      return false
    }
  }

  async fetchVersion(): Promise<string | null> {
    try {
      const executable = resolveOpenCodeExecutable() ?? 'opencode'
      const result = spawnSync(executable, ['--version'], { encoding: 'utf8' })
      const match = `${result.stdout ?? ''}${result.stderr ?? ''}`.match(/(\d+\.\d+\.\d+)/)
      if (match && match[1]) {
        this.version = match[1]
        return this.version
      }
    } catch (error) {
      logger.warn('Failed to get OpenCode version:', error)
    }
    return null
  }

  private processExists(pid: number): boolean {
    try {
      process.kill(pid, 0)
      return true
    } catch (error) {
      const errorCode = error && typeof error === 'object' && 'code' in error ? (error as { code: string }).code : ''
      return errorCode !== 'ESRCH'
    }
  }

  private signalProcessOrGroup(pid: number, groupTarget: number | null, signal: NodeJS.Signals): void {
    const target = groupTarget !== null ? -groupTarget : pid
    try {
      process.kill(target, signal)
    } catch (error) {
      const errorCode = error && typeof error === 'object' && 'code' in error ? (error as { code: string }).code : ''
      if (errorCode === 'ESRCH') {
        logger.debug(`Process ${pid} already stopped`)
      } else {
        logger.warn(`Failed to send ${signal} to ${groupTarget !== null ? `process group ${groupTarget}` : `process ${pid}`}:`, error)
      }
    }
  }

  private async waitForProcessOrGroupExit(pid: number, groupTarget: number | null, timeoutMs: number): Promise<boolean> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      const alive = groupTarget !== null ? processGroupExists(groupTarget) : this.processExists(pid)
      if (!alive) {
        return true
      }
      await new Promise(r => setTimeout(r, PROCESS_EXIT_POLL_MS))
    }
    return false
  }

  private async terminateAndConfirm(
    pid: number,
    groupTarget: number | null,
    graceMs: number,
    context: string,
    failurePhrase: string,
  ): Promise<void> {
    this.signalProcessOrGroup(pid, groupTarget, 'SIGTERM')
    const exited = await this.waitForProcessOrGroupExit(pid, groupTarget, graceMs)
    if (exited) return
    this.signalProcessOrGroup(pid, groupTarget, 'SIGKILL')
    const killed = await this.waitForProcessOrGroupExit(pid, groupTarget, graceMs)
    if (!killed) {
      const message = `${context} (PID ${pid}${groupTarget !== null ? `, process group ${groupTarget}` : ''}) ${failurePhrase}`
      this.lastStartupError = message
      logger.error(message)
      throw new Error(message)
    }
  }

  private async terminatePortOwners(processes: Array<{pid: number}>, graceMs: number): Promise<void> {
    const targets = processes.map((proc) => {
      const pgid = readProcessGroupId(proc.pid)
      return { pid: proc.pid, groupTarget: pgid !== null && pgid === proc.pid ? proc.pid : null }
    })
    for (const target of targets) {
      this.signalProcessOrGroup(target.pid, target.groupTarget, 'SIGKILL')
    }
    const survivors: number[] = []
    for (const target of targets) {
      const exited = await this.waitForProcessOrGroupExit(target.pid, target.groupTarget, graceMs)
      if (!exited) {
        survivors.push(target.pid)
      }
    }
    if (survivors.length > 0) {
      const message = `Failed to terminate the existing OpenCode server process(es) on port ${getOpenCodeServerPort()}: PID(s) ${survivors.join(', ')} still own the port or retain live process-group members; refusing to spawn a new server`
      this.lastStartupError = message
      logger.error(message)
      throw new Error(message)
    }
  }

  private resolveAttestedProcessTarget(marker: ChildStateMarker): {
    pid: number
    groupTarget: number | null
    pidAttested: boolean
    groupAttested: boolean
  } {
    const pid = marker.pid
    const pidAttested = marker.startToken !== '' && readProcessStartToken(pid) === marker.startToken
    let groupTarget: number | null = null
    let groupAttested = false
    if (pidAttested) {
      const livePgid = readProcessGroupId(pid)
      if (livePgid !== null && livePgid === pid) {
        groupTarget = pid
      }
    } else if (marker.pgid !== null) {
      const currentMembers = resolveProcessIdentityProvider().readProcessGroupMembers(marker.pgid)
      groupAttested = marker.groupMembers.length > 0 && currentMembers.some(
        (member) => marker.groupMembers.some(
          (recorded) => recorded.pid === member.pid && recorded.startToken === member.startToken,
        ),
      )
      if (groupAttested) {
        groupTarget = marker.pgid
      }
    }
    return { pid, groupTarget, pidAttested, groupAttested }
  }

  private async terminateAttestedPredecessor(graceMs: number): Promise<void> {
    const marker = await readChildStateMarker()
    if (marker === null) return
    const target = this.resolveAttestedProcessTarget(marker)
    if (!target.pidAttested && marker.pgid !== null) {
      const currentMembers = resolveProcessIdentityProvider().readProcessGroupMembers(marker.pgid)
      if (currentMembers.length > 0 && !target.groupAttested) {
        const message = `Previous OpenCode server process (PID ${marker.pid}) has exited but process group ${marker.pgid} still exists and cannot be proven to belong to it; refusing to signal an unverified process group before starting an enforced server`
        this.lastStartupError = message
        logger.error(message)
        throw new Error(message)
      }
    }
    const pidAlive = target.pidAttested
    const groupAlive = target.groupTarget !== null && processGroupExists(target.groupTarget)
    if (!pidAlive && !groupAlive) return
    logger.warn(`Sandbox enforcement enabled: terminating the previous OpenCode process group (leader PID ${marker.pid}) so host-executed descendants cannot survive`)
    await this.terminateAndConfirm(
      target.pid,
      target.groupTarget,
      graceMs,
      'Previous OpenCode server process',
      'retained live processes after SIGTERM and SIGKILL; refusing to start an enforced server while host-executed processes may survive',
    )
  }

  private async reconcileExitedChildMarker(graceMs: number): Promise<void> {
    this.isHealthy = false
    this.stopChildStateMarkerRefresh()
    const marker = await readChildStateMarker()
    if (marker === null) {
      return
    }
    const target = this.resolveAttestedProcessTarget(marker)
    if (target.pidAttested) {
      logger.warn(`Stopping OpenCode server leader PID ${target.pid} that was attested by the child state marker but is no longer tracked`)
      await this.terminateAndConfirm(
        target.pid,
        target.groupTarget,
        graceMs,
        'OpenCode server',
        'retained live processes after SIGTERM and SIGKILL; refusing to complete the stop while host-executed processes may survive',
      )
      await removeChildStateMarker()
      return
    }
    if (marker.pgid !== null) {
      const currentMembers = resolveProcessIdentityProvider().readProcessGroupMembers(marker.pgid)
      if (currentMembers.length > 0) {
        if (!target.groupAttested || target.groupTarget === null) {
          const message = `Previous OpenCode server leader (PID ${marker.pid}) has exited but process group ${marker.pgid} still exists and cannot be proven to belong to it; refusing to replace the child state marker while live processes may survive`
          this.lastStartupError = message
          logger.error(message)
          throw new Error(message)
        }
        logger.warn(
          `Previous OpenCode server leader (PID ${marker.pid}) has exited; terminating its attested process group ${marker.pgid} so host-executed descendants do not survive`,
        )
        await this.terminateAndConfirm(
          target.pid,
          target.groupTarget,
          graceMs,
          'Previous OpenCode server process group',
          'retained live processes after SIGTERM and SIGKILL; refusing to replace the child state marker while host-executed processes may survive',
        )
      }
    }
    await removeChildStateMarker()
  }

  private startChildStateMarkerRefresh(): void {
    this.stopChildStateMarkerRefresh()
    this.markerRefreshTimer = setInterval(() => {
      void this.refreshChildStateMarkerMembers()
    }, CHILD_STATE_MARKER_REFRESH_MS)
  }

  private stopChildStateMarkerRefresh(): void {
    if (this.markerRefreshTimer !== null) {
      clearInterval(this.markerRefreshTimer)
      this.markerRefreshTimer = null
    }
  }

  private async refreshChildStateMarkerMembers(): Promise<void> {
    try {
      const marker = await readChildStateMarker()
      if (marker === null || marker.pgid === null) return
      const leaderStat = resolveProcessIdentityProvider().readProcessStat(marker.pid)
      if (leaderStat === null || leaderStat.startToken !== marker.startToken || leaderStat.pgrp !== marker.pgid) {
        this.stopChildStateMarkerRefresh()
        return
      }
      const groupMembers = resolveProcessIdentityProvider().readProcessGroupMembers(marker.pgid)
      const unchanged =
        groupMembers.length === marker.groupMembers.length &&
        groupMembers.every((member, index) => {
          const recorded = marker.groupMembers[index]
          return recorded !== undefined && recorded.pid === member.pid && recorded.startToken === member.startToken
        })
      if (unchanged) return
      await writeChildStateMarker({ ...marker, groupMembers })
    } catch (error) {
      logger.warn('Failed to refresh the OpenCode child state marker process group membership:', error)
    }
  }

  private async waitForHealth(timeoutMs: number): Promise<boolean> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      if (await this.checkHealth()) {
        return true
      }
      await new Promise(r => setTimeout(r, 500))
    }
    return false
  }

  private async findProcessesByPort(port: number): Promise<Array<{pid: number}>> {
    let output: string
    try {
      output = execSync(`lsof -nP -t -iTCP:${port} -sTCP:LISTEN`).toString().trim()
    } catch (error) {
      const status = error && typeof error === 'object' && 'status' in error ? (error as { status: number | null }).status : null
      if (status === 1) {
        return []
      }
      throw new Error(`lsof failed to inspect port ${port}: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (output === '') {
      return []
    }
    return output.split('\n').filter(Boolean).map(pid => ({ pid: parseInt(pid) }))
  }
}

export const opencodeServerManager = OpenCodeServerManager.getInstance()
export { OpenCodeServerManager }
