import path from 'path'
import type { SettingsService } from './settings'
import { logger } from '../utils/logger'
import { ensureDirectoryExists, writeFileContent } from './file-operations'
import { getOpenCodeConfigFilePath, getWorkspacePath, ENV } from '@opencode-manager/shared/config/env'
import type { OpenCodeServerManager } from './opencode-single-server'

export const OPENCODE_LIFECYCLE_STATES = [
  'idle',
  'starting',
  'healthy',
  'unhealthy',
  'recovering',
  'failed',
  'stopping',
  'stopped',
] as const

export type OpenCodeLifecycleState = (typeof OPENCODE_LIFECYCLE_STATES)[number]

export const OPENCODE_RECOVERY_ACTIONS = [
  'restart',
  'debug_capture',
  'rollback_last_known_good',
  'seed_default_config',
] as const

export type OpenCodeRecoveryAction = (typeof OPENCODE_RECOVERY_ACTIONS)[number]

export type OpenCodeOperationReason =
  | 'backend_startup'
  | 'health_poll'
  | 'api_probe'
  | 'settings_restart'
  | 'settings_reload'
  | 'manual'

export interface OpenCodeLifecycleStatus {
  state: OpenCodeLifecycleState
  healthy: boolean
  port: number
  version: string | null
  minVersion: string
  versionSupported: boolean
  lastError: string | null
  activeRecoveryAction: OpenCodeRecoveryAction | null
  attemptedRecoveryActions: OpenCodeRecoveryAction[]
  nextRecoveryAction: OpenCodeRecoveryAction | null
  failureCount: number
  watching: boolean
  updatedAt: string
}

interface OpenCodeSupervisorOptions {
  pollIntervalMs?: number
  failureThreshold?: number
  userId?: string
  watchEnabled?: boolean
}

export class OpenCodeSupervisor {
  private interval: ReturnType<typeof setInterval> | null = null
  private state: OpenCodeLifecycleState = 'idle'
  private lastError: string | null = null
  private activeRecoveryAction: OpenCodeRecoveryAction | null = null
  private attemptedRecoveryActions: OpenCodeRecoveryAction[] = []
  private consecutiveFailures = 0
  private operationInProgress = false
  private updatedAt = new Date().toISOString()

  constructor(
    private readonly openCodeServerManager: OpenCodeServerManager,
    private readonly settingsService: SettingsService,
    private readonly options: OpenCodeSupervisorOptions = {},
  ) {}

  get pollIntervalMs(): number {
    return this.options.pollIntervalMs ?? ENV.OPENCODE.HEALTH_POLL_MS
  }

  get failureThreshold(): number {
    return this.options.failureThreshold ?? ENV.OPENCODE.HEALTH_FAILURE_THRESHOLD
  }

  isWatchEnabled(): boolean {
    if (this.options.watchEnabled !== undefined) return this.options.watchEnabled
    return ENV.OPENCODE.HEALTH_WATCH_ENABLED
  }

  async start(): Promise<OpenCodeLifecycleStatus> {
    await this.runLifecycleOperation(async () => {
      this.setState('starting')

      try {
        await this.openCodeServerManager.start()
        const healthy = await this.openCodeServerManager.checkHealth()
        if (healthy) {
          this.markHealthy()
          return this.getStatus()
        }

        this.recordFailure('OpenCode server failed to become healthy during startup')
      } catch (error) {
        this.recordFailure(error)
      }

      return this.recover('backend_startup')
    })

    this.startWatching()
    return this.getStatus()
  }

  async restart(reason: OpenCodeOperationReason): Promise<OpenCodeLifecycleStatus> {
    return this.runLifecycleOperation(async () => {
      this.setState('starting')

      try {
        this.openCodeServerManager.clearStartupError()
        await this.openCodeServerManager.restart()
        return this.refreshHealthOrRecover(reason)
      } catch (error) {
        this.recordFailure(error)
        return this.recover(reason)
      }
    })
  }

  async reloadConfig(reason: OpenCodeOperationReason): Promise<OpenCodeLifecycleStatus> {
    return this.runLifecycleOperation(async () => {
      this.setState('starting')

      try {
        this.openCodeServerManager.clearStartupError()
        await this.openCodeServerManager.reloadConfig()
        return this.refreshHealthOrRecover(reason)
      } catch (error) {
        this.recordFailure(error)
        return this.recover(reason)
      }
    })
  }

  async checkNow(reason: OpenCodeOperationReason): Promise<OpenCodeLifecycleStatus> {
    if (reason === 'health_poll' && !this.isWatchEnabled()) {
      return this.getStatus()
    }

    if (this.operationInProgress || this.openCodeServerManager.isOperationInProgress()) {
      return this.getStatus()
    }

    return this.runLifecycleOperation(async () => this.refreshHealthOrRecover(reason, true))
  }

  async stop(): Promise<void> {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }

    await this.runLifecycleOperation(async () => {
      this.setState('stopping')
      await this.openCodeServerManager.stop()
      this.setState('stopped')
      return this.getStatus()
    })

    logger.info('Stopped OpenCode supervisor')
  }

  getStatus(): OpenCodeLifecycleStatus {
    const nextRecoveryAction = this.state === 'recovering' || this.state === 'unhealthy' || this.state === 'failed'
      ? this.getNextRecoveryAction()
      : null

    return {
      state: this.state,
      healthy: this.state === 'healthy',
      port: this.openCodeServerManager.getPort(),
      version: this.openCodeServerManager.getVersion(),
      minVersion: this.openCodeServerManager.getMinVersion(),
      versionSupported: this.openCodeServerManager.isVersionSupported(),
      lastError: this.lastError,
      activeRecoveryAction: this.activeRecoveryAction,
      attemptedRecoveryActions: [...this.attemptedRecoveryActions],
      nextRecoveryAction,
      failureCount: this.consecutiveFailures,
      watching: this.interval !== null,
      updatedAt: this.updatedAt,
    }
  }

  private async runLifecycleOperation(operation: () => Promise<OpenCodeLifecycleStatus>): Promise<OpenCodeLifecycleStatus> {
    if (this.operationInProgress) {
      return this.getStatus()
    }

    this.operationInProgress = true
    try {
      return await operation()
    } finally {
      this.operationInProgress = false
      this.touch()
    }
  }

  private async refreshHealthOrRecover(reason: OpenCodeOperationReason, respectThreshold = false): Promise<OpenCodeLifecycleStatus> {
    const healthy = await this.openCodeServerManager.checkHealth()
    if (healthy) {
      this.markHealthy()
      return this.getStatus()
    }

    this.consecutiveFailures += 1
    this.setState('unhealthy')
    this.lastError = this.openCodeServerManager.getLastStartupError() ?? 'OpenCode health check failed'

    if (respectThreshold && this.consecutiveFailures < this.failureThreshold) {
      return this.getStatus()
    }

    return this.recover(reason)
  }

  private async recover(reason: OpenCodeOperationReason): Promise<OpenCodeLifecycleStatus> {
    this.setState('recovering')
    logger.warn(`OpenCode unhealthy during ${reason}, entering recovery`)

    for (const action of OPENCODE_RECOVERY_ACTIONS) {
      this.activeRecoveryAction = action
      this.attemptedRecoveryActions.push(action)
      this.touch()

      try {
        await this.runRecoveryAction(action)
        const healthy = await this.openCodeServerManager.checkHealth()
        if (healthy) {
          this.markHealthy()
          return this.getStatus()
        }

        this.lastError = this.openCodeServerManager.getLastStartupError() ?? `Recovery action '${action}' did not restore OpenCode health`
        logger.warn(this.lastError)
      } catch (error) {
        this.recordFailure(error)
        logger.warn(`Recovery action '${action}' failed: ${this.lastError}`)
      }
    }

    this.activeRecoveryAction = null
    this.setState('failed')
    return this.getStatus()
  }

  private async runRecoveryAction(action: OpenCodeRecoveryAction): Promise<void> {
    if (action === 'restart') {
      await this.openCodeServerManager.restart()
      return
    }

    if (action === 'debug_capture') {
      await this.captureDebugSnapshot()
      await this.openCodeServerManager.restart()
      return
    }

    if (action === 'rollback_last_known_good') {
      await this.rollbackToLastKnownGood()
      return
    }

    await this.seedDefaultConfig()
  }

  private async captureDebugSnapshot(): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const debugPath = path.join(getWorkspacePath(), '.opencode', 'state', 'health-watch', `opencode-health-${timestamp}.json`)
    const payload = JSON.stringify({
      capturedAt: timestamp,
      startupError: this.openCodeServerManager.getLastStartupError(),
      lifecycleState: this.state,
      attemptedRecoveryActions: this.attemptedRecoveryActions,
    }, null, 2)

    await ensureDirectoryExists(path.dirname(debugPath))
    await writeFileContent(debugPath, payload)
  }

  private async rollbackToLastKnownGood(): Promise<void> {
    this.settingsService.archiveBrokenConfig(this.userId)
    const lastGood = this.settingsService.restoreToLastKnownGoodConfig(this.userId)
    if (!lastGood) {
      throw new Error('No last known good config available')
    }

    const config = this.settingsService.updateOpenCodeConfig(lastGood.configName, { content: lastGood.content }, this.userId)
    if (!config) {
      throw new Error(`Failed to restore OpenCode config '${lastGood.configName}'`)
    }

    await this.writeConfig(lastGood.content)
    this.openCodeServerManager.clearStartupError()
    await this.openCodeServerManager.restart()
  }

  private async seedDefaultConfig(): Promise<void> {
    const seedConfig = JSON.stringify({ $schema: 'https://opencode.ai/config.json' }, null, 2)
    const defaultConfig = this.settingsService.getDefaultOpenCodeConfig(this.userId)

    if (defaultConfig) {
      this.settingsService.updateOpenCodeConfig(defaultConfig.name, { content: seedConfig }, this.userId)
    } else {
      this.settingsService.createOpenCodeConfig(
        {
          name: 'default',
          content: seedConfig,
          isDefault: true,
        },
        this.userId,
      )
    }

    await this.writeConfig(seedConfig)
    this.openCodeServerManager.clearStartupError()
    await this.openCodeServerManager.restart()
  }

  private async writeConfig(content: string): Promise<void> {
    const configPath = getOpenCodeConfigFilePath()
    await writeFileContent(configPath, content)
  }

  private startWatching(): void {
    if (!this.isWatchEnabled()) {
      logger.info('OpenCode supervisor health polling disabled')
      return
    }

    if (this.interval) {
      return
    }

    this.interval = setInterval(() => {
      void this.checkNow('health_poll').catch((error) => {
        logger.warn('OpenCode supervisor health check encountered an unexpected error:', error)
      })
    }, this.pollIntervalMs)

    logger.info(`Started OpenCode supervisor health polling (${this.pollIntervalMs}ms)`)
  }

  private markHealthy(): void {
    this.state = 'healthy'
    this.lastError = null
    this.activeRecoveryAction = null
    this.attemptedRecoveryActions = []
    this.consecutiveFailures = 0
    this.touch()
  }

  private recordFailure(error: unknown): void {
    this.consecutiveFailures += 1
    this.lastError = error instanceof Error
      ? error.message
      : this.openCodeServerManager.getLastStartupError() ?? 'Unknown OpenCode lifecycle error'
    this.setState('unhealthy')
  }

  private setState(state: OpenCodeLifecycleState): void {
    this.state = state
    this.touch()
  }

  private touch(): void {
    this.updatedAt = new Date().toISOString()
  }

  private getNextRecoveryAction(): OpenCodeRecoveryAction | null {
    return OPENCODE_RECOVERY_ACTIONS.find((action) => !this.attemptedRecoveryActions.includes(action)) ?? null
  }

  private get userId(): string {
    return this.options.userId ?? 'default'
  }
}
