import {
  SESSION_GOAL_POLL_INTERVAL_MS,
  isOpenSessionGoal,
  isTerminalSessionGoal,
  type SessionGoal,
} from '@opencode-manager/shared/schemas'

const BACKGROUND_POLL_INTERVAL_MS = 15000
const MAX_ERROR_BACKOFF_MS = 30000
const REQUEST_TIMEOUT_MS = 10000

export type GoalStoreDeps = {
  load: (sessionID: string, signal: AbortSignal) => Promise<SessionGoal | null>
  onOutcome: (goal: SessionGoal) => void
  pollIntervalMs?: number
}

export type GoalStore = {
  watch(sessionID: string, listener: (goal: SessionGoal | null) => void): () => void
  set(goal: SessionGoal): void
}

interface GoalEntry {
  readonly sessionID: string
  goal: SessionGoal | null
  listeners: Set<(goal: SessionGoal | null) => void>
  timer: ReturnType<typeof setTimeout> | null
  abort: AbortController | null
  loading: boolean
  version: number
  errorBackoffMs: number
  outcomeGoalId: number | null
}

export function createGoalStore(deps: GoalStoreDeps): GoalStore {
  const pollIntervalMs = deps.pollIntervalMs ?? SESSION_GOAL_POLL_INTERVAL_MS
  const entries = new Map<string, GoalEntry>()

  function entryFor(sessionID: string): GoalEntry {
    const existing = entries.get(sessionID)
    if (existing) return existing
    const entry: GoalEntry = {
      sessionID,
      goal: null,
      listeners: new Set(),
      timer: null,
      abort: null,
      loading: false,
      version: 0,
      errorBackoffMs: 0,
      outcomeGoalId: null,
    }
    entries.set(sessionID, entry)
    return entry
  }

  function clearTimer(entry: GoalEntry): void {
    if (entry.timer === null) return
    clearTimeout(entry.timer)
    entry.timer = null
  }

  function isCurrent(entry: GoalEntry): boolean {
    return entries.get(entry.sessionID) === entry
  }

  function hasListeners(entry: GoalEntry): boolean {
    return entry.listeners.size > 0
  }

  function baseDelay(entry: GoalEntry): number {
    return hasListeners(entry) ? pollIntervalMs : BACKGROUND_POLL_INTERVAL_MS
  }

  function wantsFollowing(entry: GoalEntry): boolean {
    return isCurrent(entry) && (hasListeners(entry) || isOpenSessionGoal(entry.goal))
  }

  function schedule(entry: GoalEntry): void {
    clearTimer(entry)
    if (!wantsFollowing(entry)) return
    const delay = entry.errorBackoffMs > 0 ? Math.min(entry.errorBackoffMs, MAX_ERROR_BACKOFF_MS) : baseDelay(entry)
    entry.timer = setTimeout(() => {
      entry.timer = null
      void loadInto(entry)
    }, delay)
  }

  function drop(entry: GoalEntry): void {
    clearTimer(entry)
    entry.abort?.abort()
    entry.abort = null
    entries.delete(entry.sessionID)
  }

  function applyGoal(entry: GoalEntry, goal: SessionGoal | null): void {
    const previous = entry.goal
    entry.goal = goal
    for (const listener of entry.listeners) listener(goal)
    if (goal !== null && entry.outcomeGoalId !== goal.id && isOpenSessionGoal(previous) && isTerminalSessionGoal(goal)) {
      entry.outcomeGoalId = goal.id
      deps.onOutcome(goal)
    }
    if (isOpenSessionGoal(goal)) {
      schedule(entry)
      return
    }
    clearTimer(entry)
    if (!hasListeners(entry)) drop(entry)
  }

  function fail(entry: GoalEntry): void {
    const current = entry.errorBackoffMs === 0 ? baseDelay(entry) : entry.errorBackoffMs
    entry.errorBackoffMs = Math.min(current * 2, MAX_ERROR_BACKOFF_MS)
    schedule(entry)
  }

  async function loadInto(entry: GoalEntry): Promise<void> {
    if (entry.loading || !wantsFollowing(entry)) return
    entry.loading = true
    const version = ++entry.version
    const controller = new AbortController()
    entry.abort = controller
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])

    let goal: SessionGoal | null
    try {
      goal = await deps.load(entry.sessionID, signal)
    } catch {
      entry.loading = false
      entry.abort = null
      if (!isCurrent(entry)) return
      fail(entry)
      return
    }

    entry.loading = false
    entry.abort = null
    if (!isCurrent(entry)) return
    if (version !== entry.version) {
      schedule(entry)
      return
    }
    entry.errorBackoffMs = 0
    applyGoal(entry, goal)
  }

  return {
    watch(sessionID, listener) {
      const entry = entryFor(sessionID)
      entry.listeners.add(listener)
      if (entry.goal) listener(entry.goal)
      void loadInto(entry)
      return () => {
        if (!entry.listeners.delete(listener)) return
        if (hasListeners(entry)) return
        if (isOpenSessionGoal(entry.goal)) {
          schedule(entry)
          return
        }
        drop(entry)
      }
    },
    set(goal) {
      const entry = entries.get(goal.sessionId)
      if (!entry) return
      entry.version++
      applyGoal(entry, goal)
    },
  }
}
