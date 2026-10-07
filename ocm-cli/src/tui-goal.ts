import type { Context, ToastOptions } from '@opencode/plugin/tui/context'
import {
  GOAL_MAX_CONTINUATIONS_MAX,
  GOAL_MAX_CONTINUATIONS_MIN,
  StartSessionGoalRequestSchema,
  type SessionGoal,
  type StartSessionGoalRequest,
} from '@opencode-manager/shared/schemas'
import {
  getGoalOutcomeTitle,
  getGoalStopReasonLabel,
  getGoalTokenLabel,
  getGoalTurnLabel,
} from '@opencode-manager/shared/notifications'
import { ManagerApi, isManagerRouteMissing } from './manager-api.js'
import { resolveManagerAuth } from './manager-auth.js'
import type { ManagerAuthOk } from './manager-auth.js'
import { slashArgument } from './tui-dialogs.js'
import { isOpenGoal } from './goal-store.js'
import type { GoalStore } from './goal-store.js'
import type { RemoteContext } from './remote-context.js'

export const GOALS_ATTACH_REQUIRED =
  'Goals run on OpenCode Manager. Attach with `ocm` (or move this session with /ocm-move) first.'
export const GOALS_ROUTE_MISSING = 'This OpenCode Manager does not expose goals to ocm; upgrade the Manager.'

export type GoalFormInput = {
  objective: string
  maxTurns: string
  tokenBudget: string
}

export type GoalFormResult = { ok: true; request: StartSessionGoalRequest } | { ok: false; error: string }

/** Goal operations the goal dialog calls. Each resolves to an error message, or null on success. */
export type GoalActions = {
  start(form: GoalFormInput): Promise<string | null>
  pause(goal: SessionGoal): Promise<string | null>
  resume(goal: SessionGoal): Promise<string | null>
  cancel(goal: SessionGoal): Promise<string | null>
}

export type GoalDialogProps = {
  sessionID: string
  store: GoalStore
  initialGoal: SessionGoal | null
  initialObjective: string
  actions: GoalActions
}

export type GoalCommandDeps = {
  remote: RemoteContext | undefined
  store: GoalStore | undefined
  showDialog: (props: GoalDialogProps) => void
  createApi?: (auth: ManagerAuthOk) => ManagerApi
}

export function formatGoalStatus(goal: SessionGoal): string {
  return [getGoalOutcomeTitle(goal.status), getGoalTurnLabel(goal), getGoalTokenLabel(goal), goal.objective]
    .filter((part): part is string => part !== null)
    .join(' · ')
}

export function goalOutcomeToast(goal: SessionGoal): ToastOptions {
  const variant = goal.status === 'completed' ? 'success' : goal.status === 'blocked' ? 'error' : 'warning'
  return {
    variant,
    title: getGoalOutcomeTitle(goal.status),
    message: goalReason(goal) ?? goal.objective,
  }
}

/** The stop-reason label, else the auditor's last reason, else null. */
export function goalReason(goal: SessionGoal): string | null {
  return goal.stopReason ? getGoalStopReasonLabel(goal.stopReason) : goal.lastReason
}

/** Validates the goal dialog fields into a start request; blank limits fall back to the Manager defaults. */
export function parseGoalForm(form: GoalFormInput, sessionId: string, directory: string): GoalFormResult {
  const objective = form.objective.trim()
  if (!objective) return { ok: false, error: 'Describe what this session should accomplish.' }

  const maxContinuations = parseOptionalInteger(form.maxTurns)
  if (
    maxContinuations === null ||
    (maxContinuations !== undefined &&
      (maxContinuations < GOAL_MAX_CONTINUATIONS_MIN || maxContinuations > GOAL_MAX_CONTINUATIONS_MAX))
  ) {
    return { ok: false, error: `Max turns must be a whole number from ${GOAL_MAX_CONTINUATIONS_MIN} to ${GOAL_MAX_CONTINUATIONS_MAX}.` }
  }

  const tokenBudget = parseOptionalInteger(form.tokenBudget)
  if (tokenBudget === null || (tokenBudget !== undefined && tokenBudget <= 0)) {
    return { ok: false, error: 'Token budget must be a positive whole number.' }
  }

  const parsed = StartSessionGoalRequestSchema.safeParse({
    sessionId,
    directory,
    objective,
    ...(maxContinuations !== undefined ? { maxContinuations } : {}),
    ...(tokenBudget !== undefined ? { tokenBudget } : {}),
  })
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid goal.' }
  return { ok: true, request: parsed.data }
}

export function describeGoalError(error: unknown): string {
  if (isManagerRouteMissing(error)) return GOALS_ROUTE_MISSING
  return error instanceof Error ? error.message : String(error)
}

export async function runGoalCommand(context: Context, deps: GoalCommandDeps, input?: string): Promise<void> {
  try {
    if (!deps.remote || !deps.store) {
      context.ui.toast.show({ variant: 'error', message: GOALS_ATTACH_REQUIRED })
      return
    }

    const route = context.ui.router.current()
    if (route.type !== 'session') {
      context.ui.toast.show({ variant: 'error', message: 'Not in a session' })
      return
    }
    const sessionID = route.sessionID
    const directory = context.data.session.get(sessionID)?.location.directory
    if (!directory) {
      context.ui.toast.show({ variant: 'error', message: 'Session has no directory' })
      return
    }

    const auth = await resolveManagerAuth(deps.remote.managerUrl)
    if (!auth.ok) {
      context.ui.toast.show({ variant: 'error', message: auth.message })
      return
    }
    const api = deps.createApi ? deps.createApi(auth) : new ManagerApi(auth.managerUrl, auth.token)
    const store = deps.store
    const actions = createGoalActions(context, api, store, sessionID, directory)

    const objective = slashArgument(input, 'goal')
    const existing = await api.getLatestSessionGoal(sessionID)
    if (objective && !isOpenGoal(existing)) {
      const error = await actions.start({ objective, maxTurns: '', tokenBudget: '' })
      if (error) context.ui.toast.show({ variant: 'error', message: error })
      return
    }

    deps.showDialog({ sessionID, store, initialGoal: existing, initialObjective: objective, actions })
  } catch (error) {
    context.ui.toast.show({ variant: 'error', message: describeGoalError(error) })
  }
}

function createGoalActions(context: Context, api: ManagerApi, store: GoalStore, sessionID: string, directory: string): GoalActions {
  const run = async (operation: () => Promise<SessionGoal>): Promise<string | null> => {
    try {
      store.set(await operation())
      return null
    } catch (error) {
      return describeGoalError(error)
    }
  }

  return {
    async start(form) {
      const parsed = parseGoalForm(form, sessionID, directory)
      if (!parsed.ok) return parsed.error
      return startGoal(context, api, store, parsed.request)
    },
    pause: (goal) => run(() => api.pauseSessionGoal(goal.id)),
    resume: (goal) => run(() => api.resumeSessionGoal(goal.id)),
    cancel: (goal) => run(() => api.cancelSessionGoal(goal.id)),
  }
}

async function startGoal(context: Context, api: ManagerApi, store: GoalStore, request: StartSessionGoalRequest): Promise<string | null> {
  let goal: SessionGoal
  try {
    goal = await api.startSessionGoal(request)
  } catch (error) {
    return describeGoalError(error)
  }
  store.set(goal)

  try {
    await context.client.session.prompt({
      sessionID: request.sessionId,
      text: request.objective,
      delivery: context.data.session.status(request.sessionId) === 'running' ? 'queue' : undefined,
    })
    return null
  } catch (error) {
    const cancelled = await api.cancelSessionGoal(goal.id).catch(() => undefined)
    if (cancelled) store.set(cancelled)
    return `The goal was cancelled because the objective could not be sent: ${error instanceof Error ? error.message : String(error)}`
  }
}

function parseOptionalInteger(value: string): number | undefined | null {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return /^\d+$/.test(trimmed) ? Number(trimmed) : null
}
