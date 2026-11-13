import { spawn, execSync, spawnSync } from 'child_process'
import path from 'path'
import os from 'os'
import type { Readable } from 'node:stream'
import { StringDecoder } from 'node:string_decoder'
import { promises as fs, accessSync, constants } from 'fs'
import { z } from 'zod'
import { logger } from '../utils/logger'
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
import { JsonValueSchema } from '@opencode-manager/shared/utils'
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
import { getErrorCode } from './error-code'
import type { OpenCodeClient } from './opencode/client'
import { getOrCreateInternalToken } from './internal-token'
import { installManagedPlugins } from './opencode/plugin-registry'
import { getOpenCodeHome } from './opencode-home'
import { restoreQuarantinedOpenCodePlugins } from './opencode-plugin-quarantine'
import { resolveProcessIdentityProvider } from './opencode/process-identity'
import type { ProcessIdentityProvider } from './opencode/process-identity'
import { SandboxRuntimeService } from './sandbox/runtime'
import { CredentialProvider } from './credential-provider'
import { syncManagerGitIdentityConfig } from './git-identity'
import { mkdirSafe, writeFileAtomic } from '../utils/fs-safe'
import { createProcessLogForwarder } from '../utils/log-buffer'
import { OPENCODE_SERVICE_SERVE_ARGS, prepareOpenCodeServiceLaunch } from './opencode-service-mode'


const MAX_STDERR_SIZE = 10240
const STARTUP_HEALTH_TIMEOUT_MS = 30000
const HEALTH_POLL_INTERVAL_MS = 500
const CHILD_EXIT_DIAGNOSTIC_DRAIN_MS = 1000
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

export interface OpenCodeServerChild {
  pid?: number
  stdout: Readable | null
  stderr: Readable | null
  on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): void
  on(event: 'error', listener: (error: Error) => void): void
  on(event: 'close', listener: () => void): void
}

export interface OpenCodeServerSpawnOptions {
  cwd: string
  detached: boolean
  stdio: ['ignore', 'pipe', 'pipe']
  env: NodeJS.ProcessEnv
}

export interface OpenCodeServerVersionOutput {
  stdout: string
  stderr: string
}

export interface OpenCodeServerSandboxRuntime {
  isEnabled: () => boolean
  stopAllSandboxesForToggle: () => Promise<void>
  prepareSandboxOnBoot: () => Promise<void>
}

export interface OpenCodeServerTimings {
  sigtermGraceMs: number
  sigkillConfirmMs: number
  exitPollMs: number
}

export interface OpenCodeServerManagerDeps {
  timings: OpenCodeServerTimings
  spawnServer: (executable: string, args: string[], options: OpenCodeServerSpawnOptions) => OpenCodeServerChild
  runCommand: (command: string) => string
  readVersionOutput: (executable: string) => OpenCodeServerVersionOutput
  signalProcess: (pid: number, signal: NodeJS.Signals | number) => void
  processIdentity: () => ProcessIdentityProvider
  createOpenCodeClient: (password: string, host: string) => OpenCodeClient | Promise<OpenCodeClient>
  createSandboxRuntime: (db: Database) => OpenCodeServerSandboxRuntime
  installManagedPlugins: (configHome: string) => Promise<void>
  restoreQuarantinedOpenCodePlugins: (configHome: string, configPath: string) => Promise<void>
}

export const openCodeServerManagerDeps: OpenCodeServerManagerDeps = {
  timings: {
    sigtermGraceMs: PROCESS_SIGTERM_GRACE_MS,
    sigkillConfirmMs: PROCESS_SIGKILL_CONFIRM_MS,
    exitPollMs: PROCESS_EXIT_POLL_MS,
  },
  spawnServer: (executable, args, options) => spawn(executable, args, options),
  runCommand: (command) => execSync(command).toString(),
  readVersionOutput: (executable) => {
    const result = spawnSync(executable, ['--version'], { encoding: 'utf8' })
    return { stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
  },
  signalProcess: (pid, signal) => {
    process.kill(pid, signal)
  },
  processIdentity: () => resolveProcessIdentityProvider(),
  createOpenCodeClient: async (password, host) => {
    const { createOpenCodeClient } = await import('./opencode/client')
    return createOpenCodeClient(password, host)
  },
  createSandboxRuntime: (db) => new SandboxRuntimeService(db),
  installManagedPlugins: (configHome) => installManagedPlugins(configHome),
  restoreQuarantinedOpenCodePlugins: (configHome, configPath) => restoreQuarantinedOpenCodePlugins(configHome, configPath),
}

const getOpenCodeServerDirectory = () => getWorkspacePath()
const getOpenCodeConfigPath = () => getOpenCodeConfigFilePath()
const getOpenCodeServerPort = () => ENV.OPENCODE.PORT
const getOpenCodeServerHost = () => ENV.OPENCODE.HOST

function resolveManagerMicrosandboxEnv(): ManagerMicrosandboxEnv {
  const env: ManagerMicrosandboxEnv = {
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

interface ManagerMicrosandboxEnv {
  MSB_BACKEND: string
  MSB_HOME: string
  MSB_PATH: string
  MSB_LIBKRUNFW_PATH?: string
  MSB_PROFILE?: string
  MSB_API_URL?: string
  MSB_API_KEY?: string
}

interface AttestedProcessTarget {
  pid: number
  groupTarget: number | null
  pidAttested: boolean
  groupAttested: boolean
}

const childStateGroupMemberSchema = z.object({
  pid: z.number(),
  startToken: z.string(),
})

const childStateMarkerSchema = z.object({
  pid: z.number(),
  pgid: JsonValueSchema.nullish(),
  enforced: z.boolean(),
  startToken: z.string(),
  generation: z.number(),
  groupMembers: z.array(JsonValueSchema).nullish(),
})

const restartGenerationRowSchema = z.object({ value: z.string() })

const execErrorStatusSchema = z.object({ status: z.number().nullish() })

type AbortRaceOutcome<T> = { completed: true; value: T } | { completed: false }

function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<AbortRaceOutcome<T>> {
  if (signal.aborted) {
    return Promise.resolve({ completed: false })
  }
  return new Promise<AbortRaceOutcome<T>>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort)
      resolve({ completed: false })
    }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve({ completed: true, value })
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

function waitForPollInterval(signal: AbortSignal, ms: number): Promise<boolean> {
  if (signal.aborted) {
    return Promise.resolve(false)
  }
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve(true)
    }, ms)
    function onAbort() {
      clearTimeout(timer)
      resolve(false)
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function readDurableRestartGeneration(db: Database | null): number {
  if (!db) return 0
  try {
    const row = restartGenerationRowSchema.safeParse(db.prepare('SELECT value FROM app_secrets WHERE key = ?').get(RESTART_GENERATION_KEY))
    if (!row.success) return 0
    const parsed = Number(row.data.value)
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
    const parsed = childStateMarkerSchema.safeParse(JSON.parse(await fs.readFile(getChildStateMarkerPath(), 'utf-8')))
    if (!parsed.success) return null
    const marker = parsed.data
    const parsedPgid = z.number().safeParse(marker.pgid)
    const pgid = parsedPgid.success && parsedPgid.data > 0 ? parsedPgid.data : null
    const groupMembers = (marker.groupMembers ?? []).flatMap((member) => {
      const parsedMember = childStateGroupMemberSchema.safeParse(member)
      return parsedMember.success ? [parsedMember.data] : []
    })
    return {
      pid: marker.pid,
      pgid,
      enforced: marker.enforced,
      startToken: marker.startToken,
      generation: marker.generation,
      groupMembers,
    }
  } catch {
    return null
  }
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
  ]
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null || candidate.length === 0) continue
    try {
      accessSync(candidate, constants.X_OK)
      return candidate
    } catch {
    }
  }
  return null
}

class OpenCodeServerManager {
  private static instance: OpenCodeServerManager | null = null
  private serverProcess: OpenCodeServerChild | null = null
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
  private readonly lifecycleOpenedListeners = new Set<() => void>()
  private markerRefreshTimer: ReturnType<typeof setInterval> | null = null
  private processGeneration = 0
  private intentionalStop: { pid: number; generation: number } | null = null
  private readonly deps: OpenCodeServerManagerDeps

  constructor(deps: Partial<OpenCodeServerManagerDeps> = {}) {
    this.deps = { ...openCodeServerManagerDeps, ...deps }
  }

  setDatabase(db: Database) {
    this.db = db
  }

  setOpenCodeClient(client: OpenCodeClient | null) {
    this.openCodeClient = client
  }

  async rebuildClient(): Promise<void> {
    const password = this.getResolvedPassword()
    this.openCodeClient = await this.deps.createOpenCodeClient(password, getOpenCodeServerHost())
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
    const instance = OpenCodeServerManager.instance ?? new OpenCodeServerManager()
    OpenCodeServerManager.instance = instance
    return instance
  }

  static resetInstance(): void {
    OpenCodeServerManager.instance?.stopChildStateMarkerRefresh()
    OpenCodeServerManager.instance = null
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

  private readProcessGroupId(pid: number): number | null {
    return this.deps.processIdentity().readProcessStat(pid)?.pgrp ?? null
  }

  private readProcessStartToken(pid: number): string | null {
    return this.deps.processIdentity().readProcessStat(pid)?.startToken ?? null
  }

  private processGroupExists(pgid: number): boolean {
    try {
      this.deps.signalProcess(-pgid, 0)
      return true
    } catch (error) {
      return getErrorCode(error) !== 'ESRCH'
    }
  }

  private async readProcessStartTokenWithRetry(pid: number): Promise<string | null> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const token = this.readProcessStartToken(pid)
      if (token !== null) return token
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    return null
  }

  private async readProcessGroupIdWithRetry(pid: number): Promise<number | null> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const pgid = this.readProcessGroupId(pid)
      if (pgid !== null) return pgid
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    return null
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
        sandboxEnforced = this.deps.createSandboxRuntime(this.db).isEnabled()
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
          await this.deps.createSandboxRuntime(this.db).stopAllSandboxesForToggle()
          logger.info('Sandbox enforcement disabled: stopped all sandbox microVMs')
        } catch (error) {
          this.failNonRecoverable(`Failed to stop the workspace sandbox while disabling enforcement: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      if (sandboxEnforced && !this.sandboxEnforced) {
        void this.deps.createSandboxRuntime(this.db).prepareSandboxOnBoot().catch((error) => {
          logger.warn('Sandbox enforcement enabled but preparing the guest image failed:', error)
        })
      }
      logger.info(`OpenCode sandbox enforcement: ${sandboxEnforced ? 'enabled' : 'disabled'}`)
    }

    const password = this.getResolvedPassword()
    const openCodeServerHost = getOpenCodeServerHost()

    let credentialProvider: CredentialProvider | null = null
    let userEnvVars: Record<string, string> = {}
    if (this.db) {
      try {
        credentialProvider = new CredentialProvider(this.db)
        const settingsService = new SettingsService(this.db)
        const settings = settingsService.getSettings('default')
        const rawEnvVars = settings.preferences.serverEnvVars || []
        if (rawEnvVars.length > 0) {
          userEnvVars = Object.fromEntries(
            rawEnvVars
              .filter(({ key }) => {
                const normalizedKey = key.trim()
                return (
                  normalizedKey !== '' &&
                  !BLOCKED_SERVER_ENV_KEYS.some((blockedKey) => blockedKey === normalizedKey) &&
                  !normalizedKey.startsWith('MSB_')
                )
              })
              .map(({ key, value }) => [key.trim(), value])
          )
          logger.info(`Injecting ${Object.keys(userEnvVars).length} custom server env vars`)
        }

        await syncManagerGitIdentityConfig(this.db)
      } catch (error) {
        logger.warn('Failed to get git settings:', error)
      }
    }

    this.sandboxEnforced = sandboxEnforced
    if (sandboxEnforced && !this.deps.processIdentity().attested) {
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
            && childState.startToken === this.readProcessStartToken(childState.pid)
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
      await this.deps.restoreQuarantinedOpenCodePlugins(pluginConfigHome, openCodeConfigPath)
    } catch (error) {
      this.failNonRecoverable(
        `Failed to restore legacy quarantined OpenCode plugins before startup: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    try {
      await this.deps.installManagedPlugins(pluginConfigHome)
    } catch (error) {
      if (sandboxEnforced) {
        logger.error('Failed to install a generated OpenCode plugin; refusing to start an enforced server', error)
        this.failNonRecoverable(error instanceof Error ? error.message : String(error))
      }
      logger.warn('Failed to install a generated OpenCode plugin (sandboxing is disabled):', error)
    }
    const openCodeExecutable = resolveOpenCodeExecutable() ?? 'opencode'

    let stderrOutput = ''
    const stderrDecoder = new StringDecoder('utf8')
    const appendStderrOutput = (chunk: string) => {
      stderrOutput += chunk
      if (stderrOutput.length > MAX_STDERR_SIZE) {
        stderrOutput = stderrOutput.slice(-MAX_STDERR_SIZE)
      }
    }

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

    const serverEnv: NodeJS.ProcessEnv = {
      ...cleanEnv,
      ...userEnvVars,
      ...microsandboxEnv,
      ...gitEnv,
      OCM_SANDBOX_ENFORCED: sandboxEnforced ? 'true' : 'false',
      GIT_SSH_COMMAND: gitSshCommand,
      XDG_DATA_HOME: getOpenCodeStateHome(),
      XDG_STATE_HOME: getOpenCodeStateHome(),
      XDG_CONFIG_HOME: getOpenCodeConfigHome(),
      TMPDIR: getOpenCodeTmpHome(),
    }
    if (this.db) {
      serverEnv.OCM_INTERNAL_API_URL = `http://localhost:${ENV.SERVER.PORT}/api/internal`
      serverEnv.OCM_INTERNAL_TOKEN = getOrCreateInternalToken(this.db)
    }

    try {
      await prepareOpenCodeServiceLaunch({
        XDG_CONFIG_HOME: getOpenCodeConfigHome(),
        XDG_STATE_HOME: getOpenCodeStateHome(),
      }, password)
    } catch (error) {
      const message = `Failed to prepare the OpenCode service settings: ${error instanceof Error ? error.message : String(error)}`
      this.recordStartupError(message)
      throw new Error(message)
    }

    this.serverProcess = this.deps.spawnServer(
      openCodeExecutable,
      [...OPENCODE_SERVICE_SERVE_ARGS, '--port', openCodeServerPort.toString(), '--hostname', openCodeServerHost],
      {
        cwd: openCodeServerDirectory,
        detached: !isDevelopment,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: serverEnv,
      }
    )

    const openCodeStdoutLog = createProcessLogForwarder({ source: 'opencode', defaultLevel: 'info' })
    const openCodeStderrLog = createProcessLogForwarder({ source: 'opencode', defaultLevel: 'error' })

    const spawnedServerPid = this.serverProcess.pid
    const spawnedServerStderr = this.serverProcess.stderr
    const spawnedGeneration = ++this.processGeneration
    const childExitController = new AbortController()

    let spawnedProcessExitError: string | null = null
    let stderrEnded = false
    let stderrDecoderFlushed = false
    let exitDiagnosticFinalized = false
    let exitDiagnosticCode: number | null = null
    let exitDiagnosticSignal: NodeJS.Signals | null = null
    let exitDiagnosticExitedBeforeHealthy = false
    let exitDiagnosticIntentionalStop = false
    let exitDiagnosticDrainTimer: ReturnType<typeof setTimeout> | null = null
    let exitDiagnosticDrainResolve: (() => void) | null = null

    const flushStderrDecoder = () => {
      if (stderrDecoderFlushed) return
      stderrDecoderFlushed = true
      appendStderrOutput(stderrDecoder.end())
    }

    const clearExitDiagnosticDrainTimer = () => {
      if (exitDiagnosticDrainTimer !== null) {
        clearTimeout(exitDiagnosticDrainTimer)
        exitDiagnosticDrainTimer = null
      }
    }

    const finalizeExitDiagnostic = (message: string | null) => {
      if (exitDiagnosticFinalized) return
      exitDiagnosticFinalized = true
      clearExitDiagnosticDrainTimer()
      if (message !== null) {
        spawnedProcessExitError = message
        if (this.processGeneration === spawnedGeneration) {
          this.recordStartupError(message)
        }
      }
      const resolve = exitDiagnosticDrainResolve
      exitDiagnosticDrainResolve = null
      if (resolve) resolve()
    }

    const buildExitDiagnostic = (): string | null => {
      if (exitDiagnosticIntentionalStop) return null
      if (exitDiagnosticCode !== null && exitDiagnosticCode !== 0) {
        return `OpenCode server exited with code ${exitDiagnosticCode}${stderrOutput ? `: ${stderrOutput.slice(-500)}` : ''}`
      }
      if (exitDiagnosticSignal !== null) {
        return `OpenCode server terminated by signal ${exitDiagnosticSignal}`
      }
      if (exitDiagnosticExitedBeforeHealthy) {
        return 'OpenCode server exited with code 0 before becoming healthy'
      }
      return null
    }

    const finalizeExitDiagnosticFromState = () => {
      flushStderrDecoder()
      finalizeExitDiagnostic(buildExitDiagnostic())
    }

    const awaitExitDiagnostic = (): Promise<void> => {
      if (exitDiagnosticFinalized) return Promise.resolve()
      return new Promise<void>((resolve) => {
        exitDiagnosticDrainResolve = resolve
      })
    }

    this.serverProcess.stderr?.on('data', (data) => {
      if (isDevelopment) process.stderr.write(data)
      appendStderrOutput(stderrDecoder.write(data))
      openCodeStderrLog.write(data)
    })
    this.serverProcess.stderr?.on('end', () => {
      stderrEnded = true
      flushStderrDecoder()
      openCodeStderrLog.flush()
      if (childExitController.signal.aborted) {
        finalizeExitDiagnosticFromState()
      }
    })

    this.serverProcess.stdout?.on('data', (data) => {
      if (isDevelopment) process.stdout.write(data)
      openCodeStdoutLog.write(data)
    })
    this.serverProcess.stdout?.on('end', () => openCodeStdoutLog.flush())

    this.serverProcess.on('error', (error) => {
      childExitController.abort()
      finalizeExitDiagnostic(`Failed to launch the OpenCode server (${openCodeExecutable}): ${error.message}`)
    })

    this.serverProcess.on('exit', (code, signal) => {
      childExitController.abort()
      const exitedBeforeHealthy = !this.isHealthy
      if (spawnedServerPid !== undefined && this.serverPid === spawnedServerPid) {
        this.serverPid = null
        this.isHealthy = false
        this.stopChildStateMarkerRefresh()
      }
      exitDiagnosticCode = code
      exitDiagnosticSignal = signal
      exitDiagnosticExitedBeforeHealthy = exitedBeforeHealthy
      const intentionalStop = this.intentionalStop
      exitDiagnosticIntentionalStop = intentionalStop !== null
        && intentionalStop.pid === spawnedServerPid
        && intentionalStop.generation === spawnedGeneration
        && (signal === 'SIGTERM' || signal === 'SIGKILL' || code === 0)
      if (exitDiagnosticFinalized) return
      const hasDiagnostic = (code !== null && code !== 0) || signal !== null || exitedBeforeHealthy
      if (!hasDiagnostic) {
        finalizeExitDiagnostic(null)
        return
      }
      if (spawnedServerStderr == null || stderrEnded) {
        finalizeExitDiagnosticFromState()
        return
      }
      exitDiagnosticDrainTimer = setTimeout(() => {
        exitDiagnosticDrainTimer = null
        finalizeExitDiagnosticFromState()
      }, CHILD_EXIT_DIAGNOSTIC_DRAIN_MS)
    })

    this.serverProcess.on('close', () => {
      if (childExitController.signal.aborted) {
        finalizeExitDiagnosticFromState()
      }
    })

    this.serverPid = this.serverProcess.pid ?? null
    if (this.serverPid !== null) {
      if (!isDevelopment) {
        if (!this.deps.processIdentity().attested) {
          logger.warn('Process identity attestation is unavailable on this platform; tracking the OpenCode server as a direct child without PID-reuse attestation')
        } else {
          const startToken = await this.readProcessStartTokenWithRetry(this.serverPid)
          if (startToken === null) {
            const message = 'Failed to read the process identity of the freshly spawned OpenCode server; refusing to detach an unattestable child'
            this.recordStartupError(message)
            await this.stop(true)
            throw new Error(message)
          }
          try {
            const processGroup = await this.readProcessGroupIdWithRetry(this.serverPid)
            const groupMembers = processGroup !== null && processGroup === this.serverPid
              ? this.deps.processIdentity().readProcessGroupMembers(processGroup)
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
            this.recordStartupError(message)
            await this.stop(true)
            throw new Error(message)
          }
          this.startChildStateMarkerRefresh()
        }
      }
    }

    logger.info(`OpenCode server started with PID ${this.serverPid}`)

    const healthy = await this.waitForHealth(STARTUP_HEALTH_TIMEOUT_MS, childExitController.signal)
    if (!healthy) {
      if (childExitController.signal.aborted) {
        await awaitExitDiagnostic()
      }
      if (spawnedProcessExitError !== null) {
        throw new Error(spawnedProcessExitError)
      }
      const message = `OpenCode server failed to become healthy after ${Math.round(STARTUP_HEALTH_TIMEOUT_MS / 1000)}s${stderrOutput ? `. Last error: ${stderrOutput.slice(-500)}` : ''}`
      this.recordStartupError(message)
      throw new Error(message)
    }

    if (sandboxEnforced || replacingExistingServer) {
      let portOwners: Array<{pid: number}> = []
      try {
        portOwners = await this.findProcessesByPort(openCodeServerPort)
      } catch (inspectionError) {
        const message = `Could not verify port ${openCodeServerPort} ownership after health; refusing to mark the server healthy: ${inspectionError instanceof Error ? inspectionError.message : String(inspectionError)}`
        this.recordStartupError(message)
        await this.stop(true)
        throw new Error(message)
      }
      if (this.serverPid === null || !portOwners.some((proc) => proc.pid === this.serverPid)) {
        const owners = portOwners.length > 0 ? `; port ${openCodeServerPort} is owned by PID(s) ${portOwners.map((proc) => proc.pid).join(', ')}` : `; no process owns port ${openCodeServerPort}`
        const message = `The newly started OpenCode server (PID ${this.serverPid ?? 'unknown'}) does not own the OpenCode port${owners}; refusing to mark the server healthy`
        this.recordStartupError(message)
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
        const pgid = this.readProcessGroupId(pid)
        if (pgid !== null && pgid === pid) {
          groupTarget = pid
        }
      }

      if (groupTarget !== null) {
        logger.info(`Terminating OpenCode process group ${groupTarget} so host-executed descendants do not survive the stop`)
      }
      this.intentionalStop = { pid, generation: this.processGeneration }
      try {
        await this.terminateAndConfirm(
          pid,
          groupTarget,
          'OpenCode server',
          'retained live processes after SIGTERM and SIGKILL; refusing to complete the stop while host-executed processes may survive',
        )
      } catch (error) {
        this.intentionalStop = null
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

  isChildStateMarkerRefreshActive(): boolean {
    return this.markerRefreshTimer !== null
  }

  getServerPid(): number | null {
    return this.serverPid
  }

  isServerHealthy(): boolean {
    return this.isHealthy
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

  private recordStartupError(message: string): void {
    this.lastStartupError = message
    logger.error(message)
  }

  private failNonRecoverable(message: string): never {
    this.lastStartupErrorNonRecoverable = true
    this.recordStartupError(message)
    throw new NonRecoverableStartupError(message)
  }

  isRestartPending(): boolean {
    return this.restartPending
  }

  isSandboxEnforced(): boolean {
    return this.sandboxEnforced
  }

  setLifecycleInitialized(initialized: boolean): void {
    const opened = initialized && !this.lifecycleInitialized
    this.lifecycleInitialized = initialized
    if (!opened) return
    this.lifecycleOpenedListeners.forEach((listener) => {
      try {
        listener()
      } catch (error) {
        logger.error('OpenCode lifecycle listener failed:', error)
      }
    })
  }

  onLifecycleInitialized(listener: () => void): () => void {
    this.lifecycleOpenedListeners.add(listener)
    return () => { this.lifecycleOpenedListeners.delete(listener) }
  }

  isLifecycleInitialized(): boolean {
    return this.lifecycleInitialized
  }

  markRestartPending(): void {
    this.restartPending = true
    this.restartPendingGeneration += 1
    advanceDurableRestartGeneration(this.db)
  }

  async checkHealth(signal?: AbortSignal): Promise<boolean> {
    if (!this.openCodeClient) {
      return false
    }
    const timeoutSignal = AbortSignal.timeout(ENV.TIMEOUTS.HEALTH_CHECK_TIMEOUT_MS)
    const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
    try {
      await this.openCodeClient.api.server.info({
        signal: requestSignal,
      })
      return true
    } catch {
      return false
    }
  }

  async fetchVersion(): Promise<string | null> {
    try {
      const executable = resolveOpenCodeExecutable() ?? 'opencode'
      const result = this.deps.readVersionOutput(executable)
      const version = parseOpenCodeVersionOutput(`${result.stdout}${result.stderr}`)
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
      this.deps.signalProcess(pid, 0)
      return true
    } catch (error) {
      return getErrorCode(error) !== 'ESRCH'
    }
  }

  private signalProcessOrGroup(pid: number, groupTarget: number | null, signal: NodeJS.Signals): void {
    const target = groupTarget !== null ? -groupTarget : pid
    try {
      this.deps.signalProcess(target, signal)
    } catch (error) {
      if (getErrorCode(error) === 'ESRCH') {
        logger.debug(`Process ${pid} already stopped`)
      } else {
        logger.warn(`Failed to send ${signal} to ${groupTarget !== null ? `process group ${groupTarget}` : `process ${pid}`}:`, error)
      }
    }
  }

  private async waitForProcessOrGroupExit(pid: number, groupTarget: number | null, timeoutMs: number): Promise<boolean> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      const alive = groupTarget !== null ? this.processGroupExists(groupTarget) : this.processExists(pid)
      if (!alive) {
        return true
      }
      await new Promise(r => setTimeout(r, this.deps.timings.exitPollMs))
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
    const exited = await this.waitForProcessOrGroupExit(pid, groupTarget, this.deps.timings.sigtermGraceMs)
    if (exited) return
    this.signalProcessOrGroup(pid, groupTarget, 'SIGKILL')
    const killed = await this.waitForProcessOrGroupExit(pid, groupTarget, this.deps.timings.sigkillConfirmMs)
    if (!killed) {
      const message = `${context} (PID ${pid}${groupTarget !== null ? `, process group ${groupTarget}` : ''}) ${failurePhrase}`
      this.recordStartupError(message)
      throw new Error(message)
    }
  }

  private async terminatePortOwners(processes: Array<{pid: number}>): Promise<void> {
    const targets = processes.map((proc) => {
      const pgid = this.readProcessGroupId(proc.pid)
      return { pid: proc.pid, groupTarget: pgid !== null && pgid === proc.pid ? proc.pid : null }
    })
    for (const target of targets) {
      this.signalProcessOrGroup(target.pid, target.groupTarget, 'SIGKILL')
    }
    const survivors: number[] = []
    for (const target of targets) {
      const exited = await this.waitForProcessOrGroupExit(target.pid, target.groupTarget, this.deps.timings.sigkillConfirmMs)
      if (!exited) {
        survivors.push(target.pid)
      }
    }
    if (survivors.length > 0) {
      const message = `Failed to terminate the existing OpenCode server process(es) on port ${getOpenCodeServerPort()}: PID(s) ${survivors.join(', ')} still own the port or retain live process-group members; refusing to spawn a new server`
      this.recordStartupError(message)
      throw new Error(message)
    }
  }

  private resolveAttestedProcessTarget(marker: ChildStateMarker): AttestedProcessTarget {
    const pid = marker.pid
    const pidAttested = marker.startToken !== '' && this.readProcessStartToken(pid) === marker.startToken
    let groupTarget: number | null = null
    let groupAttested = false
    if (pidAttested) {
      const livePgid = this.readProcessGroupId(pid)
      if (livePgid !== null && livePgid === pid) {
        groupTarget = pid
      }
    } else if (marker.pgid !== null) {
      const currentMembers = this.deps.processIdentity().readProcessGroupMembers(marker.pgid)
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
      const currentMembers = this.deps.processIdentity().readProcessGroupMembers(marker.pgid)
      if (currentMembers.length > 0 && !target.groupAttested) {
        const message = `Previous OpenCode server process (PID ${marker.pid}) has exited but process group ${marker.pgid} still exists and cannot be proven to belong to it; refusing to signal an unverified process group before starting an enforced server`
        this.recordStartupError(message)
        throw new Error(message)
      }
    }
    const pidAlive = target.pidAttested
    const groupAlive = target.groupTarget !== null && this.processGroupExists(target.groupTarget)
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
      const currentMembers = this.deps.processIdentity().readProcessGroupMembers(marker.pgid)
      if (currentMembers.length > 0) {
        if (!target.groupAttested || target.groupTarget === null) {
          const message = `Previous OpenCode server leader (PID ${marker.pid}) has exited but process group ${marker.pgid} still exists and cannot be proven to belong to it; refusing to replace the child state marker while live processes may survive`
          this.recordStartupError(message)
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

  startChildStateMarkerRefresh(): void {
    this.stopChildStateMarkerRefresh()
    this.markerRefreshTimer = setInterval(() => {
      void this.refreshChildStateMarkerMembers()
    }, CHILD_STATE_MARKER_REFRESH_MS)
  }

  stopChildStateMarkerRefresh(): void {
    if (this.markerRefreshTimer !== null) {
      clearInterval(this.markerRefreshTimer)
      this.markerRefreshTimer = null
    }
  }

  async refreshChildStateMarkerMembers(): Promise<void> {
    try {
      const marker = await readChildStateMarker()
      if (marker === null || marker.pgid === null) return
      const leaderStat = this.deps.processIdentity().readProcessStat(marker.pid)
      if (leaderStat === null || leaderStat.startToken !== marker.startToken || leaderStat.pgrp !== marker.pgid) {
        this.stopChildStateMarkerRefresh()
        return
      }
      const groupMembers = this.deps.processIdentity().readProcessGroupMembers(marker.pgid)
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

  private async waitForHealth(timeoutMs: number, exitSignal: AbortSignal): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (exitSignal.aborted) {
        return false
      }
      const probe = await raceWithAbort(this.checkHealth(exitSignal), exitSignal)
      if (exitSignal.aborted) {
        return false
      }
      if (probe.completed && probe.value) {
        return true
      }
      const polled = await waitForPollInterval(exitSignal, HEALTH_POLL_INTERVAL_MS)
      if (!polled) {
        return false
      }
    }
    return false
  }

  private async findProcessesByPort(port: number): Promise<Array<{pid: number}>> {
    let output: string
    try {
      output = this.deps.runCommand(`lsof -nP -t -iTCP:${port} -sTCP:LISTEN`).trim()
    } catch (error) {
      const status = execErrorStatusSchema.safeParse(error)
      if (status.success && status.data.status === 1) {
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
