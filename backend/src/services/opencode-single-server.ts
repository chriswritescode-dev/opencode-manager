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
import { BLOCKED_SERVER_ENV_KEYS } from '@opencode-manager/shared'
import {
  OPENCODE_PINNED_VERSION,
  describeUnsupportedOpenCodeVersion,
  isSupportedOpenCodeVersion,
  parseOpenCodeVersionOutput,
} from '@opencode-manager/shared/opencode'
import { resolveOpenCodeBinaryPath } from './opencode-installer'
import { SettingsService } from './settings'
import {
  getWorkspacePath,
  getOpenCodeAgentTmpPath,
  getOpenCodeConfigFilePath,
  getOpenCodeConfigHome,
  getOpenCodeStateHome,
  getOpenCodeTmpHome,
  ENV,
} from '@opencode-manager/shared/config/env'
import type { Database } from 'bun:sqlite'
import type { OpenCodeClient } from './opencode/client'
import { getOrCreateInternalToken } from './internal-token'
import { installManagedPlugins } from './opencode/plugin-registry'
import { getOpenCodeHome } from './opencode-home'
import { restoreQuarantinedOpenCodePlugins } from './opencode-plugin-quarantine'
import { resolveProcessIdentityProvider } from './opencode/process-identity'
import { SandboxRuntimeService } from './sandbox/runtime'
import { CredentialProvider } from './credential-provider'
import { mkdirSafe, writeFileAtomic } from '../utils/fs-safe'
import { createProcessLogForwarder } from '../utils/log-buffer'
import { OPENCODE_SERVICE_SERVE_ARGS, prepareOpenCodeServiceLaunch } from './opencode-service-mode'


const MAX_STDERR_SIZE = 10240
const STARTUP_HEALTH_TIMEOUT_MS = 30000
const PROCESS_SIGTERM_GRACE_MS = 10000
const PROCESS_SIGKILL_CONFIRM_MS = 2000
const PROCESS_EXIT_POLL_MS = 50
const CHILD_STATE_MARKER_REFRESH_MS = 60000

type StartupValidationIssue = {
  path: string
  message: string
}

export class ConfigReloadError extends Error {
  validationIssues: StartupValidationIssue[]

  constructor(message: string, validationIssues: StartupValidationIssue[] = []) {
    super(message)
    this.name = 'ConfigReloadError'
    this.validationIssues = validationIssues
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

// Helper getters to ensure values are computed at runtime (not module load time)
// This allows proper mocking in tests
const getOpenCodeServerDirectory = () => getWorkspacePath()
const getOpenCodeConfigPath = () => getOpenCodeConfigFilePath()
const getOpenCodeServerPort = () => ENV.OPENCODE.PORT
const getOpenCodeServerHost = () => ENV.OPENCODE.HOST

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
    resolveOpenCodeBinaryPath(getOpenCodeHome()),
    '/usr/local/bin/opencode',
    '/opt/opencode/bin/opencode',
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
    this.openCodeClient = createOpenCodeClient(password, getOpenCodeServerHost())
  }

  getEffectiveServerHost(): string {
    return getOpenCodeServerHost()
  }

  private getResolvedPassword(): string {
    if (this.db) {
      const settingsService = new SettingsService(this.db)
      return settingsService.getOpenCodeServerPassword()
    }
    return ENV.OPENCODE.SERVER_PASSWORD
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

  async start(allowNested = false): Promise<void> {
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
          await this.terminateAttestedPredecessor()
          if (existingProcesses.length > 0) {
            await this.terminatePortOwners(existingProcesses)
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
      if (sandboxEnforced && !this.sandboxEnforced) {
        void new SandboxRuntimeService(this.db).prepareWorkspaceSandboxOnBoot().catch((error) => {
          logger.warn('Sandbox enforcement enabled but preparing the guest image failed:', error)
        })
      }
      logger.info(`OpenCode sandbox enforcement: ${sandboxEnforced ? 'enabled' : 'disabled'}`)
    }

    const password = this.getResolvedPassword()
    const openCodeServerHost = getOpenCodeServerHost()

    let credentialProvider: CredentialProvider | null = null
    let gitIdentityEnv: Record<string, string> = {}
    let userEnvVars: Record<string, string> = {}
    if (this.db) {
      try {
        credentialProvider = new CredentialProvider(this.db)
        const settingsService = new SettingsService(this.db)
        const settings = settingsService.getSettings('default')
        const gitCredentials = credentialProvider.getGitCredentials()
        const rawEnvVars = settings.preferences.serverEnvVars || []
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
      await this.terminateAttestedPredecessor()
      if (existingProcesses.length > 0) {
        logger.warn('Sandbox enforcement enabled: killing existing OpenCode server to guarantee a sandboxed startup')
        await this.terminatePortOwners(existingProcesses)
        replacingExistingServer = true
      }
    } else if (existingProcesses.length > 0) {
      logger.info(`OpenCode server already running on port ${openCodeServerPort}`)
      const healthy = await this.checkHealth()
      if (healthy) {
        if (isDevelopment) {
          logger.warn('Development mode: Killing existing server for hot reload')
          await this.terminatePortOwners(existingProcesses)
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
          await this.terminatePortOwners(existingProcesses)
          replacingExistingServer = true
        }
      } else {
        logger.warn('Killing unhealthy OpenCode server')
        await this.terminatePortOwners(existingProcesses)
        replacingExistingServer = true
      }
    }

    await this.reconcileExitedChildMarker()

    const openCodeServerDirectory = getOpenCodeServerDirectory()
    const openCodeConfigPath = getOpenCodeConfigPath()
    logger.info(`OpenCode server working directory: ${openCodeServerDirectory}`)
    logger.info(`OpenCode XDG_CONFIG_HOME: ${getOpenCodeConfigHome()}`)
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

    await this.fetchVersion()
    if (this.version && !this.isVersionSupported()) {
      this.failNonRecoverable(
        `${describeUnsupportedOpenCodeVersion(this.version)}. Install a supported version from Settings → OpenCode.`,
      )
    }
    await this.resetAgentTmpDirectory()
    const pluginConfigHome = getOpenCodeConfigHome()
    try {
      await restoreQuarantinedOpenCodePlugins(pluginConfigHome, openCodeConfigPath)
    } catch (error) {
      this.failNonRecoverable(
        `Failed to restore legacy quarantined OpenCode plugins before startup: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    try {
      await installManagedPlugins(pluginConfigHome)
    } catch (error) {
      if (sandboxEnforced) {
        logger.error('Failed to install a generated OpenCode plugin; refusing to start an enforced server', error)
        this.failNonRecoverable(error instanceof Error ? error.message : String(error))
      }
      logger.warn('Failed to install a generated OpenCode plugin (sandboxing is disabled):', error)
    }
    const openCodeExecutable = resolveOpenCodeExecutable() ?? 'opencode'

    let stderrOutput = ''

    const microsandboxEnv = resolveManagerMicrosandboxEnv()

    const cleanEnv = { ...process.env }
    delete cleanEnv.OPENCODE_PASSWORD
    delete cleanEnv.OPENCODE_SERVER_PASSWORD
    delete cleanEnv.OPENCODE_RUN_ID
    delete cleanEnv.OPENCODE_PROCESS_ROLE
    delete cleanEnv.OPENCODE_PID
    delete cleanEnv.OPENCODE
    delete cleanEnv.OPENCODE_CONFIG
    delete cleanEnv.OPENCODE_CONFIG_DIR
    delete cleanEnv.OPENCODE_CONFIG_CONTENT
    delete userEnvVars.OPENCODE_CONFIG
    delete userEnvVars.OPENCODE_CONFIG_DIR
    delete userEnvVars.OPENCODE_CONFIG_CONTENT

    const serverEnv = {
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
      GIT_SSH_COMMAND: gitSshCommand,
      XDG_DATA_HOME: getOpenCodeStateHome(),
      XDG_STATE_HOME: getOpenCodeStateHome(),
      XDG_CONFIG_HOME: getOpenCodeConfigHome(),
      TMPDIR: getOpenCodeTmpHome(),
    }

    try {
      await prepareOpenCodeServiceLaunch(serverEnv, password)
    } catch (error) {
      const message = `Failed to prepare the OpenCode service settings: ${error instanceof Error ? error.message : String(error)}`
      this.lastStartupError = message
      logger.error(message)
      throw new Error(message)
    }

    this.serverProcess = spawn(
      openCodeExecutable,
      [...OPENCODE_SERVICE_SERVE_ARGS, '--port', openCodeServerPort.toString(), '--hostname', openCodeServerHost],
      {
        cwd: openCodeServerDirectory,
        detached: !isDevelopment,
        stdio: isDevelopment ? 'inherit' : ['ignore', 'pipe', 'pipe'],
        env: serverEnv,
      }
    )

    const openCodeStdoutLog = createProcessLogForwarder({ source: 'opencode', defaultLevel: 'info' })
    const openCodeStderrLog = createProcessLogForwarder({ source: 'opencode', defaultLevel: 'error' })

    if (!isDevelopment && this.serverProcess.stderr) {
      this.serverProcess.stderr.on('data', (data) => {
        const text = data.toString()
        stderrOutput += text
        if (stderrOutput.length > MAX_STDERR_SIZE) {
          stderrOutput = stderrOutput.slice(-MAX_STDERR_SIZE)
        }
        openCodeStderrLog.write(data)
      })
      this.serverProcess.stderr.on('end', () => openCodeStderrLog.flush())
    }

    if (!isDevelopment && this.serverProcess.stdout) {
      this.serverProcess.stdout.on('data', (data) => openCodeStdoutLog.write(data))
      this.serverProcess.stdout.on('end', () => openCodeStdoutLog.flush())
    }

    const spawnedServerPid = this.serverProcess.pid
    this.serverProcess.on('exit', (code, signal) => {
      if (spawnedServerPid !== undefined && this.serverPid === spawnedServerPid) {
        this.serverPid = null
        this.isHealthy = false
        this.stopChildStateMarkerRefresh()
      }
      if (code !== null && code !== 0) {
        this.lastStartupError = `Server exited with code ${code}${stderrOutput ? `: ${stderrOutput.slice(-500)}` : ''}`
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

    const healthy = await this.waitForHealth(STARTUP_HEALTH_TIMEOUT_MS)
    if (!healthy) {
      this.lastStartupError = `Server failed to become healthy after ${Math.round(STARTUP_HEALTH_TIMEOUT_MS / 1000)}s${stderrOutput ? `. Last error: ${stderrOutput.slice(-500)}` : ''}`
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
        await this.reconcileExitedChildMarker()
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

  private async resetAgentTmpDirectory(): Promise<void> {
    const tmpDir = getOpenCodeAgentTmpPath()
    try {
      await mkdirSafe(tmpDir)
      const entries = await fs.readdir(tmpDir)
      await Promise.all(entries.map((entry) => fs.rm(path.join(tmpDir, entry), { recursive: true, force: true })))
    } catch (error) {
      logger.warn(`Failed to reset the agent temporary directory ${tmpDir}:`, error)
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
      await this.start(true)
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
    return OPENCODE_PINNED_VERSION
  }

  isVersionSupported(): boolean {
    if (!this.version) return false
    return isSupportedOpenCodeVersion(this.version)
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

  async checkHealth(): Promise<boolean> {
    if (!this.openCodeClient) {
      return false
    }
    try {
      await this.openCodeClient.api.server.info({
        signal: AbortSignal.timeout(ENV.TIMEOUTS.HEALTH_CHECK_TIMEOUT_MS),
      })
      return true
    } catch {
      return false
    }
  }

  async fetchVersion(): Promise<string | null> {
    try {
      const executable = resolveOpenCodeExecutable() ?? 'opencode'
      const result = spawnSync(executable, ['--version'], { encoding: 'utf8' })
      const version = parseOpenCodeVersionOutput(`${result.stdout ?? ''}${result.stderr ?? ''}`)
      if (version) {
        this.version = version
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
    context: string,
    failurePhrase: string,
  ): Promise<void> {
    this.signalProcessOrGroup(pid, groupTarget, 'SIGTERM')
    const exited = await this.waitForProcessOrGroupExit(pid, groupTarget, PROCESS_SIGTERM_GRACE_MS)
    if (exited) return
    this.signalProcessOrGroup(pid, groupTarget, 'SIGKILL')
    const killed = await this.waitForProcessOrGroupExit(pid, groupTarget, PROCESS_SIGKILL_CONFIRM_MS)
    if (!killed) {
      const message = `${context} (PID ${pid}${groupTarget !== null ? `, process group ${groupTarget}` : ''}) ${failurePhrase}`
      this.lastStartupError = message
      logger.error(message)
      throw new Error(message)
    }
  }

  private async terminatePortOwners(processes: Array<{pid: number}>): Promise<void> {
    const targets = processes.map((proc) => {
      const pgid = readProcessGroupId(proc.pid)
      return { pid: proc.pid, groupTarget: pgid !== null && pgid === proc.pid ? proc.pid : null }
    })
    for (const target of targets) {
      this.signalProcessOrGroup(target.pid, target.groupTarget, 'SIGKILL')
    }
    const survivors: number[] = []
    for (const target of targets) {
      const exited = await this.waitForProcessOrGroupExit(target.pid, target.groupTarget, PROCESS_SIGKILL_CONFIRM_MS)
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

  private async terminateAttestedPredecessor(): Promise<void> {
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
      'Previous OpenCode server process',
      'retained live processes after SIGTERM and SIGKILL; refusing to start an enforced server while host-executed processes may survive',
    )
  }

  private async reconcileExitedChildMarker(): Promise<void> {
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
