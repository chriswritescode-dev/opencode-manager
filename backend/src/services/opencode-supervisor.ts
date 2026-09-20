import type { SettingsService } from './settings'
import { logger } from '../utils/logger'
import { ENV } from '@opencode-manager/shared/config/env'
import { archiveBrokenOpenCodeConfigFile, writeHealthWatchArtifact } from './opencode-config-file'
import { restoreLastKnownGoodOpenCodeConfig, seedOpenCodeConfigFile } from './opencode-config-apply'
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

const MAX_QUEUED_LIFECYCLE_OPERATIONS = 2

export type OpenCodeOperationReason =
  | 'backend_startup'
  | 'health_poll'
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
  private operationTail: Promise<void> = Promise.resolve()
  private queuedOperations = 0
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
      this.closeLifecycleGate()

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
      this.closeLifecycleGate()

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
      this.closeLifecycleGate()
      await this.openCodeServerManager.stop()
      this.setState('stopped')
      return this.getStatus()
    }, { droppable: false })

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

  private async runLifecycleOperation(
    operation: () => Promise<OpenCodeLifecycleStatus>,
    options: { droppable?: boolean } = {},
  ): Promise<OpenCodeLifecycleStatus> {
    if ((options.droppable ?? true) && this.queuedOperations >= MAX_QUEUED_LIFECYCLE_OPERATIONS) {
      logger.warn('Dropped an OpenCode lifecycle request: one operation is running and another is already queued')
      return this.getStatus()
    }

    this.queuedOperations += 1
    const previousTail = this.operationTail
    let releaseTail!: () => void
    this.operationTail = new Promise<void>((resolve) => {
      releaseTail = resolve
    })

    try {
      await previousTail
      this.operationInProgress = true
      try {
        return await operation()
      } finally {
        this.operationInProgress = false
        this.touch()
      }
    } finally {
      this.queuedOperations -= 1
      releaseTail()
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
    this.closeLifecycleGate()
    this.lastError = this.openCodeServerManager.getLastStartupError() ?? 'OpenCode health check failed'

    if (respectThreshold && this.consecutiveFailures < this.failureThreshold) {
      return this.getStatus()
    }

    return this.recover(reason)
  }

  private async recover(reason: OpenCodeOperationReason): Promise<OpenCodeLifecycleStatus> {
    this.closeLifecycleGate()

    if (this.openCodeServerManager.isLastStartupErrorNonRecoverable()) {
      return this.failWithoutRecovery()
    }

    this.setState('recovering')
    logger.warn(`OpenCode unhealthy during ${reason}, entering recovery`)

    for (const action of OPENCODE_RECOVERY_ACTIONS) {
      if (this.openCodeServerManager.isLastStartupErrorNonRecoverable()) {
        return this.failWithoutRecovery()
      }

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
    this.openCodeServerManager.setLifecycleInitialized(false)
    return this.getStatus()
  }

  private failWithoutRecovery(): OpenCodeLifecycleStatus {
    const message = this.lastError ?? this.openCodeServerManager.getLastStartupError() ?? 'OpenCode failed with a non-recoverable startup error'
    logger.error(`OpenCode failed with a non-recoverable startup error; skipping configuration recovery: ${message}`)
    this.activeRecoveryAction = null
    this.attemptedRecoveryActions = []
    this.setState('failed')
    this.openCodeServerManager.setLifecycleInitialized(false)
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
    await writeHealthWatchArtifact('opencode-health', (timestamp) => JSON.stringify({
      capturedAt: timestamp,
      startupError: this.openCodeServerManager.getLastStartupError(),
      lifecycleState: this.state,
      attemptedRecoveryActions: this.attemptedRecoveryActions,
    }, null, 2))
  }

  private async rollbackToLastKnownGood(): Promise<void> {
    await archiveBrokenOpenCodeConfigFile()
    const restored = await restoreLastKnownGoodOpenCodeConfig(this.settingsService)
    if (!restored) {
      throw new Error('No last known good config available')
    }

    await this.openCodeServerManager.restart()
  }

  private async seedDefaultConfig(): Promise<void> {
    await archiveBrokenOpenCodeConfigFile()
    await seedOpenCodeConfigFile()
    this.openCodeServerManager.clearStartupError()
    await this.openCodeServerManager.restart()
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

  private closeLifecycleGate(): void {
    this.openCodeServerManager.setLifecycleInitialized(false)
  }

  private markHealthy(): void {
    this.state = 'healthy'
    this.lastError = null
    this.activeRecoveryAction = null
    this.attemptedRecoveryActions = []
    this.consecutiveFailures = 0
    this.openCodeServerManager.setLifecycleInitialized(true)
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
}
