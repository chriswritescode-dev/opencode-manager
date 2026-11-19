import { DEFAULTS } from '@opencode-manager/shared/config'
import type { V2Event } from '@opencode-manager/shared/opencode'
import { logger } from '../utils/logger'

export interface OpenCodeEventStreamApi {
  event: {
    subscribe: (options?: { signal?: AbortSignal; onActivity?: () => void }) => AsyncIterable<V2Event>
  }
}

export interface OpenCodeEventSubscriptionOptions {
  api: () => OpenCodeEventStreamApi
  label: string
  onOpen: () => void
  onEvent: (event: V2Event) => void
  onDisconnect: (cause: unknown) => void
  reconnectDelayMs?: number
  maxReconnectDelayMs?: number
  stallThresholdMs?: number
  watchdogTickMs?: number
}

export interface OpenCodeEventSubscription {
  close: () => void
  reconnect: () => void
}

interface SubscriptionAttempt {
  controller: AbortController
  watchdog: ReturnType<typeof setInterval> | null
}

function nextBackoffDelay(currentDelayMs: number, maxDelayMs: number): number {
  return Math.min(currentDelayMs * 2, maxDelayMs)
}

export function subscribeOpenCodeEvents(options: OpenCodeEventSubscriptionOptions): OpenCodeEventSubscription {
  const reconnectDelayMs = options.reconnectDelayMs ?? DEFAULTS.SSE.RECONNECT_DELAY_MS
  const maxReconnectDelayMs = options.maxReconnectDelayMs ?? DEFAULTS.SSE.MAX_RECONNECT_DELAY_MS
  const stallThresholdMs = options.stallThresholdMs ?? DEFAULTS.SSE.STALL_THRESHOLD_MS
  const watchdogTickMs = options.watchdogTickMs ?? DEFAULTS.SSE.WATCHDOG_TICK_MS

  let closed = false
  let currentDelay = reconnectDelayMs
  let loopToken = 0
  let currentAttempt: SubscriptionAttempt | null = null
  let delayTimer: ReturnType<typeof setTimeout> | null = null
  let resolveDelay: (() => void) | null = null

  const stopAttempt = (): void => {
    const attempt = currentAttempt
    currentAttempt = null
    if (!attempt) return
    if (attempt.watchdog) {
      clearInterval(attempt.watchdog)
      attempt.watchdog = null
    }
    attempt.controller.abort()
  }

  const stopDelay = (): void => {
    if (delayTimer) {
      clearTimeout(delayTimer)
      delayTimer = null
    }
    const resolve = resolveDelay
    resolveDelay = null
    resolve?.()
  }

  const wait = (delayMs: number): Promise<void> => new Promise((resolve) => {
    resolveDelay = resolve
    delayTimer = setTimeout(() => {
      delayTimer = null
      resolveDelay = null
      resolve()
    }, delayMs)
  })

  const run = async (token: number): Promise<void> => {
    while (!closed && token === loopToken) {
      const attempt: SubscriptionAttempt = { controller: new AbortController(), watchdog: null }
      currentAttempt = attempt
      let lastActivityAt = Date.now()
      let opened = false
      let stallError: Error | null = null
      let failure: unknown

      attempt.watchdog = setInterval(() => {
        if (Date.now() - lastActivityAt <= stallThresholdMs) return
        stallError = new Error(`${options.label}: OpenCode event stream stalled`)
        attempt.controller.abort(stallError)
      }, watchdogTickMs)

      try {
        const stream = options.api().event.subscribe({
          signal: attempt.controller.signal,
          onActivity: () => {
            lastActivityAt = Date.now()
          },
        })

        for await (const event of stream) {
          lastActivityAt = Date.now()
          if (closed || token !== loopToken) break
          if (!opened && event.type === 'server.connected') {
            opened = true
            currentDelay = reconnectDelayMs
            options.onOpen()
          }
          try {
            options.onEvent(event)
          } catch (error) {
            logger.error(`${options.label}: failed to handle ${event.type} event`, error)
          }
        }
      } catch (error) {
        failure = error
      } finally {
        if (attempt.watchdog) {
          clearInterval(attempt.watchdog)
          attempt.watchdog = null
        }
        if (currentAttempt === attempt) currentAttempt = null
      }

      if (closed || token !== loopToken) return

      try {
        options.onDisconnect(stallError ?? failure)
      } catch (error) {
        logger.error(`${options.label}: disconnect handler failed`, error)
      }
      await wait(currentDelay)
      if (closed || token !== loopToken) return
      currentDelay = nextBackoffDelay(currentDelay, maxReconnectDelayMs)
    }
  }

  const startLoop = (token: number): void => {
    void run(token).catch((error) => {
      logger.error(`${options.label}: subscription loop failed`, error)
    })
  }

  startLoop(loopToken)

  return {
    close: () => {
      if (closed) return
      closed = true
      loopToken += 1
      stopDelay()
      stopAttempt()
    },
    reconnect: () => {
      if (closed) return
      loopToken += 1
      stopDelay()
      stopAttempt()
      currentDelay = reconnectDelayMs
      startLoop(loopToken)
    },
  }
}
