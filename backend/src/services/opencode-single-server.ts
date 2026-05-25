import { spawn, execSync, spawnSync } from 'child_process'
import path from 'path'
import { promises as fs } from 'fs'
import { logger } from '../utils/logger'
import { createGitEnv, createGitIdentityEnv, resolveGitIdentity } from '../utils/git-auth'
import type { GitCredential } from '@opencode-manager/shared'
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
import { SettingsService } from './settings'
import { getWorkspacePath, getOpenCodeConfigFilePath, ENV } from '@opencode-manager/shared/config/env'
import { parseJsonc } from '@opencode-manager/shared/utils'
import type { Database } from 'bun:sqlite'
import { compareVersions } from '../utils/version-utils'
import { patchConfigWithRecovery } from './opencode/config-recovery'
import type { OpenCodeClient } from './opencode/client'
import { writeFileContent } from './file-operations'


const MIN_OPENCODE_VERSION = '1.0.137'
const MAX_STDERR_SIZE = 10240
const HEALTH_CHECK_TIMEOUT_MS = 3000
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

class OpenCodeServerManager {
  private static instance: OpenCodeServerManager
  private serverProcess: ReturnType<typeof spawn> | null = null
  private serverPid: number | null = null
  private isHealthy: boolean = false
  private db: Database | null = null
  private version: string | null = null
  private lastStartupError: string | null = null
  private opInProgress: boolean = false
  private openCodeClient: OpenCodeClient | null = null

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
    this.openCodeClient = createOpenCodeClient(password)
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
      return
    }

    try {
      if (this.isHealthy) {
        logger.info('OpenCode server already running and healthy')
        return
      }

    await this.rebuildClient()

    const isDevelopment = ENV.SERVER.NODE_ENV !== 'production'
    const password = this.getResolvedPassword()
    const openCodeServerHost = getOpenCodeServerHost()
    const isExposed = openCodeServerHost !== '127.0.0.1' && openCodeServerHost !== 'localhost'
    if (isExposed && !password) {
      const msg = `OPENCODE_HOST=${openCodeServerHost} exposes the OpenCode server externally but no password is configured. Set OPENCODE_SERVER_PASSWORD env var or configure a password via Settings → OpenCode → Server Auth.`
      this.lastStartupError = msg
      logger.error(msg)
      throw new Error(msg)
    }

    let gitCredentials: GitCredential[] = []
    let gitIdentityEnv: Record<string, string> = {}
    let userEnvVars: Record<string, string> = {}
    if (this.db) {
      try {
        const settingsService = new SettingsService(this.db)
        const settings = settingsService.getSettings('default')
        gitCredentials = settings.preferences.gitCredentials || []
        const rawEnvVars = settings.preferences.serverEnvVars || []
        if (rawEnvVars.length > 0) {
          userEnvVars = Object.fromEntries(
            rawEnvVars
              .filter(({ key }) => {
                const normalizedKey = key.trim()
                return normalizedKey !== '' && !(BLOCKED_SERVER_ENV_KEYS as readonly string[]).includes(normalizedKey)
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

    const openCodeServerPort = getOpenCodeServerPort()
    const existingProcesses = await this.findProcessesByPort(openCodeServerPort)
    if (existingProcesses.length > 0) {
      logger.info(`OpenCode server already running on port ${openCodeServerPort}`)
      const healthy = await this.checkHealth()
      if (healthy) {
        if (isDevelopment) {
          logger.warn('Development mode: Killing existing server for hot reload')
          for (const proc of existingProcesses) {
            try {
              process.kill(proc.pid, 'SIGKILL')
            } catch (error) {
              logger.warn(`Failed to kill process ${proc.pid}:`, error)
            }
          }
          await new Promise(r => setTimeout(r, 2000))
        } else {
          this.isHealthy = true
          if (existingProcesses[0]) {
            this.serverPid = existingProcesses[0].pid
          }
          return
        }
      } else {
        logger.warn('Killing unhealthy OpenCode server')
        for (const proc of existingProcesses) {
          try {
            process.kill(proc.pid, 'SIGKILL')
          } catch (error) {
            logger.warn(`Failed to kill process ${proc.pid}:`, error)
          }
        }
        await new Promise(r => setTimeout(r, 1000))
      }
    }

    const openCodeServerDirectory = getOpenCodeServerDirectory()
    const openCodeConfigPath = getOpenCodeConfigPath()
    logger.info(`OpenCode server working directory: ${openCodeServerDirectory}`)
    logger.info(`OpenCode XDG_CONFIG_HOME: ${path.join(openCodeServerDirectory, '.config')}`)
    logger.info(`OpenCode will use ?directory= parameter for session isolation`)

    const gitEnv = createGitEnv(gitCredentials)
    const knownHostsPath = path.join(getWorkspacePath(), 'config', 'known_hosts')
    let gitSshCommand: string
    let sshConfigPath: string | null = null

    const sshCredentials = gitCredentials.filter(cred => cred.type === 'ssh' && cred.sshPrivateKeyEncrypted)
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
    const configuredPlugins = await this.getConfiguredPlugins(openCodeConfigPath)
    await this.installConfiguredPlugins(configuredPlugins)
    const configuredPluginCount = configuredPlugins.length

    let stderrOutput = ''

    const cleanEnv = { ...process.env }
    delete cleanEnv.OPENCODE_SERVER_PASSWORD
    delete cleanEnv.OPENCODE_RUN_ID
    delete cleanEnv.OPENCODE_PROCESS_ROLE
    delete cleanEnv.OPENCODE_PID
    delete cleanEnv.OPENCODE

    this.serverProcess = spawn(
      'opencode',
      ['serve', '--port', openCodeServerPort.toString(), '--hostname', openCodeServerHost],
      {
        cwd: openCodeServerDirectory,
        detached: !isDevelopment,
        stdio: isDevelopment ? 'inherit' : ['ignore', 'pipe', 'pipe'],
        env: {
          ...cleanEnv,
          ...userEnvVars,
          ...gitEnv,
          ...gitIdentityEnv,
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

    this.serverProcess.on('exit', (code, signal) => {
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

    this.isHealthy = true
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
      if (!this.serverPid) return

      logger.info('Stopping OpenCode server')
      try {
        process.kill(this.serverPid, 'SIGTERM')
      } catch (error) {
        const errorCode = error && typeof error === 'object' && 'code' in error ? (error as { code: string }).code : ''
        if (errorCode === 'ESRCH') {
          logger.debug(`Process ${this.serverPid} already stopped`)
        } else {
          logger.warn(`Failed to send SIGTERM to ${this.serverPid}:`, error)
        }
      }

      await new Promise(r => setTimeout(r, 2000))

      try {
        process.kill(this.serverPid, 'SIGKILL')
      } catch (error) {
        const errorCode = error && typeof error === 'object' && 'code' in error ? (error as { code: string }).code : ''
        if (errorCode === 'ESRCH') {
          logger.debug(`Process ${this.serverPid} already stopped`)
        } else {
          logger.warn(`Failed to send SIGKILL to ${this.serverPid}:`, error)
        }
      }

      this.serverPid = null
      this.isHealthy = false

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
      await fs.mkdir(binDir, { recursive: true })

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

      await fs.mkdir(installDir, { recursive: true })
      if (!await fs.access(path.join(installDir, 'package.json')).then(() => true).catch(() => false)) {
        const init = spawnSync('bun', ['init', '-y'], { cwd: installDir, encoding: 'utf8' })
        if (init.status !== 0) {
          logger.warn(`Failed to initialize OpenCode plugin cache for ${plugin}: ${init.stderr || init.stdout}`)
          continue
        }
      }

      const result = spawnSync('bun', ['add', '--ignore-scripts', installSpec], { cwd: installDir, encoding: 'utf8' })
      if (result.status === 0) {
        logger.info(`Installed OpenCode plugin: ${plugin}`)
        continue
      }

      logger.warn(`Failed to install OpenCode plugin ${plugin}: ${result.stderr || result.stdout}`)
    }
  }

  async restart(): Promise<void> {
    const acquired = this.acquireOp()
    if (!acquired) {
      return
    }

    try {
      logger.info('Restarting OpenCode server (full process restart)')
      await this.stop(true)
      await new Promise(r => setTimeout(r, 1000))
      await this.start(false, true)
    } finally {
      this.releaseOp(acquired)
    }
  }

  async reloadConfig(): Promise<void> {
    const acquired = this.acquireOp()
    if (!acquired) {
      return
    }

    try {
      logger.info('Reloading OpenCode configuration (via API)')
      try {
        const configPath = getOpenCodeConfigFilePath()
        const fileContent = await fs.readFile(configPath, 'utf-8')
        const fileConfig = parseJsonc(fileContent) as Record<string, unknown>
        logger.info(`Read config from file for reload: ${configPath}`)

        const patchResult = await patchConfigWithRecovery(this.requireClient(), fileConfig)
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

  clearStartupError(): void {
    this.lastStartupError = null
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
        path: '/doc',
        signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
      })
      return response.ok
    } catch {
      return false
    }
  }

  async fetchVersion(): Promise<string | null> {
    try {
      const result = execSync('opencode --version 2>&1', { encoding: 'utf8' })
      const match = result.match(/(\d+\.\d+\.\d+)/)
      if (match && match[1]) {
        this.version = match[1]
        return this.version
      }
    } catch (error) {
      logger.warn('Failed to get OpenCode version:', error)
    }
    return null
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
    try {
      const pids = execSync(`lsof -ti:${port}`).toString().trim().split('\n')
      return pids.filter(Boolean).map(pid => ({ pid: parseInt(pid) }))
    } catch {
      return []
    }
  }
}

export const opencodeServerManager = OpenCodeServerManager.getInstance()
export { OpenCodeServerManager }
