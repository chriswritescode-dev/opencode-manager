import type { SessionGoal } from '@opencode-manager/shared/schemas'

export const GOAL_POLL_INTERVAL_MS = 3000

export type GoalStoreDeps = {
  load: (sessionID: string) => Promise<SessionGoal | null>
  onOutcome: (goal: SessionGoal) => void
  pollIntervalMs?: number
}

export type GoalStore = {
  watch(sessionID: string, listener: (goal: SessionGoal | null) => void): () => void
  set(goal: SessionGoal): void
  refresh(sessionID: string): Promise<void>
}

interface GoalEntry {
  readonly sessionID: string
  goal: SessionGoal | null
  listeners: Set<(goal: SessionGoal | null) => void>
  timer: ReturnType<typeof setInterval> | null
}

export function isOpenGoal(goal: SessionGoal | null | undefined): goal is SessionGoal {
  return !!goal && (goal.status === 'active' || goal.status === 'paused')
}

function isTerminalGoal(goal: SessionGoal): boolean {
  return goal.status === 'completed' || goal.status === 'blocked' || goal.status === 'stopped'
}

export function createGoalStore(deps: GoalStoreDeps): GoalStore {
  const pollIntervalMs = deps.pollIntervalMs ?? GOAL_POLL_INTERVAL_MS
  const entries = new Map<string, GoalEntry>()

  function entryFor(sessionID: string): GoalEntry {
    let entry = entries.get(sessionID)
    if (!entry) {
      entry = { sessionID, goal: null, listeners: new Set(), timer: null }
      entries.set(sessionID, entry)
    }
    return entry
  }

  function stopPolling(entry: GoalEntry): void {
    if (entry.timer !== null) {
      clearInterval(entry.timer)
      entry.timer = null
    }
  }

  function isLive(entry: GoalEntry): boolean {
    return entry.listeners.size > 0 && entries.get(entry.sessionID) === entry
  }

  function startPolling(entry: GoalEntry): void {
    stopPolling(entry)
    entry.timer = setInterval(() => {
      void loadInto(entry)
    }, pollIntervalMs)
  }

  function applyGoal(entry: GoalEntry, goal: SessionGoal | null): void {
    const previous = entry.goal
    entry.goal = goal
    for (const listener of entry.listeners) listener(goal)
    if (entry.listeners.size > 0 && isOpenGoal(previous) && goal !== null && isTerminalGoal(goal)) {
      deps.onOutcome(goal)
    }
    if (goal?.status === 'active' && isLive(entry)) startPolling(entry)
    else stopPolling(entry)
  }

  async function loadInto(entry: GoalEntry): Promise<void> {
    let goal: SessionGoal | null
    try {
      goal = await deps.load(entry.sessionID)
    } catch {
      if (entry.goal?.status !== 'active' || !isLive(entry)) stopPolling(entry)
      return
    }
    if (entries.get(entry.sessionID) !== entry) {
      stopPolling(entry)
      return
    }
    applyGoal(entry, goal)
  }

  return {
    watch(sessionID, listener) {
      const entry = entryFor(sessionID)
      entry.listeners.add(listener)
      void loadInto(entry)
      return () => {
        entry.listeners.delete(listener)
        if (entry.listeners.size === 0) {
          stopPolling(entry)
          entries.delete(sessionID)
        }
      }
    },
    set(goal) {
      const entry = entries.get(goal.sessionId)
      if (!entry) return
      applyGoal(entry, goal)
    },
    refresh(sessionID) {
      const entry = entries.get(sessionID)
      if (!entry) return Promise.resolve()
      return loadInto(entry)
    },
  }
}
