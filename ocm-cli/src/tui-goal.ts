import type { Context, ToastOptions } from '@opencode/plugin/tui/context'
import type { SessionGoal } from '@opencode-manager/shared/schemas'
import { getGoalOutcomeTitle, getGoalStopReasonLabel } from '@opencode-manager/shared/notifications'
import { ManagerApi, ManagerApiError, isManagerRouteMissing } from './manager-api.js'
import { resolveManagerAuth } from './manager-auth.js'
import type { ManagerAuth } from './manager-auth.js'
import { promptDialog, selectDialog, slashArgument } from './tui-dialogs.js'
import { isOpenGoal } from './goal-store.js'
import type { GoalStore } from './goal-store.js'
import type { RemoteContext } from './remote-context.js'

export const GOALS_ATTACH_REQUIRED =
  'Goals run on OpenCode Manager. Attach with `ocm` (or move this session with /ocm-move) first.'
export const GOALS_ROUTE_MISSING = 'This OpenCode Manager does not expose goals to ocm; upgrade the Manager.'

export type ManagerAuthOk = Extract<ManagerAuth, { ok: true }>

export type GoalCommandDeps = {
  remote: RemoteContext | undefined
  store: GoalStore | undefined
  createApi?: (auth: ManagerAuthOk) => ManagerApi
}

export function formatGoalStatus(goal: SessionGoal): string {
  const parts = [getGoalOutcomeTitle(goal.status), `turn ${goal.continuationCount}/${goal.maxContinuations}`]
  if (goal.tokenBudget !== null) {
    parts.push(`${goal.tokensUsed}/${goal.tokenBudget} tokens`)
  }
  parts.push(goal.objective)
  return parts.join(' · ')
}

export function goalOutcomeToast(goal: SessionGoal): ToastOptions {
  const variant = goal.status === 'completed' ? 'success' : goal.status === 'blocked' ? 'error' : 'warning'
  return {
    variant,
    title: getGoalOutcomeTitle(goal.status),
    message: goal.stopReason ? getGoalStopReasonLabel(goal.stopReason) : goal.lastReason ?? goal.objective,
  }
}

function showGoalError(context: Context, error: unknown): void {
  if (isManagerRouteMissing(error)) {
    context.ui.toast.show({ variant: 'error', message: GOALS_ROUTE_MISSING })
    return
  }
  if (error instanceof ManagerApiError) {
    context.ui.toast.show({ variant: 'error', message: error.message })
    return
  }
  context.ui.toast.show({ variant: 'error', message: error instanceof Error ? error.message : String(error) })
}

async function runOpenGoalAction(context: Context, api: ManagerApi, goal: SessionGoal): Promise<SessionGoal | undefined> {
  const action = await selectDialog(context, 'Session goal', [
    goal.status === 'paused'
      ? { title: 'Resume goal', value: 'resume' as const }
      : { title: 'Pause goal', value: 'pause' as const },
    { title: 'Cancel goal', value: 'cancel' as const },
  ])
  if (!action) return undefined
  switch (action) {
    case 'pause':
      return api.pauseSessionGoal(goal.id)
    case 'resume':
      return api.resumeSessionGoal(goal.id)
    case 'cancel':
      return api.cancelSessionGoal(goal.id)
  }
}

async function startGoal(
  context: Context,
  store: GoalStore,
  api: ManagerApi,
  sessionID: string,
  directory: string,
  objective: string,
): Promise<void> {
  const goal = await api.startSessionGoal({ sessionId: sessionID, directory, objective })
  store.set(goal)
  try {
    await context.client.session.prompt({
      sessionID,
      text: objective,
      delivery: context.data.session.status(sessionID) === 'running' ? 'queue' : undefined,
    })
  } catch (error) {
    const cancelled = await api.cancelSessionGoal(goal.id).catch(() => undefined)
    if (cancelled) store.set(cancelled)
    context.ui.toast.show({ variant: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}

export async function runGoalCommand(context: Context, deps: GoalCommandDeps, input?: string): Promise<void> {
  try {
    if (!deps.remote || !deps.store) {
      context.ui.toast.show({ variant: 'error', message: GOALS_ATTACH_REQUIRED })
      return
    }

    const current = context.ui.router.current()
    if (current.type !== 'session') {
      context.ui.toast.show({ variant: 'error', message: 'Not in a session' })
      return
    }
    const sessionID = current.sessionID
    const session = context.data.session.get(sessionID)
    if (!session?.location.directory) {
      context.ui.toast.show({ variant: 'error', message: 'Session has no directory' })
      return
    }

    const auth = await resolveManagerAuth(deps.remote.managerUrl)
    if (!auth.ok) {
      context.ui.toast.show({ variant: 'error', message: auth.message })
      return
    }
    const api = deps.createApi ? deps.createApi(auth) : new ManagerApi(auth.managerUrl, auth.token)

    const existing = await api.getLatestSessionGoal(sessionID)
    if (isOpenGoal(existing)) {
      const result = await runOpenGoalAction(context, api, existing)
      if (result) deps.store.set(result)
      return
    }

    const objective =
      slashArgument(input, 'goal') ||
      (await promptDialog(context, {
        title: 'Start goal',
        description: 'What should this session accomplish?',
        placeholder: 'Describe the goal',
      }))
    if (!objective) return

    await startGoal(context, deps.store, api, sessionID, session.location.directory, objective)
  } catch (error) {
    showGoalError(context, error)
  }
}
