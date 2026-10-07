import type { Context, ToastOptions } from '@opencode/plugin/tui/context'
import {
  MULTI_RUN_MAX_MODELS,
  type LaunchMultiRunRequest,
  type MultiRun,
  type MultiRunEntry,
} from '@opencode-manager/shared/schemas'
import { formatOpenCodeModelRef } from '@opencode-manager/shared/opencode'
import { ManagerApi, ManagerApiError, isManagerRouteMissing } from './manager-api.js'
import { resolveManagerAuth } from './manager-auth.js'
import type { ManagerAuthOk } from './manager-auth.js'
import { multiSelectDialog, promptDialog, selectDialog, slashArgument } from './tui-dialogs.js'
import type { RemoteContext } from './remote-context.js'

export const MULTI_RUN_ATTACH_REQUIRED =
  'Multi-runs run on OpenCode Manager. Attach to a Manager repo with `ocm` first.'
export const MULTI_RUN_ROUTE_MISSING = 'This OpenCode Manager does not expose multi-runs to ocm; upgrade the Manager.'

export type ModelOption = {
  title: string
  description: string
  value: string
}

export type MultiRunCommandDeps = {
  remote: RemoteContext | undefined
  createApi?: (auth: ManagerAuthOk) => ManagerApi
}

export async function listModelOptions(context: Context): Promise<ModelOption[]> {
  await context.data.location.model.sync()
  const models = context.data.location.model.list() ?? []
  return models
    .filter((model) => model.enabled && model.status !== 'deprecated')
    .map((model) => {
      const ref = formatOpenCodeModelRef({ providerID: model.providerID, id: model.id })
      return { title: model.name, description: ref, value: ref }
    })
}

export function openManagerSessions(context: Context, sessionIDs: string[]): void {
  const first = sessionIDs[0]
  if (!first) return

  if (context.ui.tabs.enabled()) {
    for (const sessionID of sessionIDs) context.ui.tabs.open(sessionID)
    context.ui.tabs.focus(first)
    return
  }

  context.ui.router.navigate({ type: 'session', sessionID: first })
}

function defaultMultiRunName(prompt: string): string {
  return prompt.split('\n')[0].slice(0, 80)
}

function startedSessionIds(run: MultiRun): string[] {
  return run.entries
    .filter((entry): entry is MultiRunEntry & { sessionId: string } => entry.status === 'started' && entry.sessionId !== null)
    .map((entry) => entry.sessionId)
}

function multiRunLaunchToast(run: MultiRun): ToastOptions {
  const started = run.entries.filter((entry) => entry.status === 'started').length
  const failed = run.entries.filter((entry) => entry.status === 'failed')
  const lines = [`Launched ${run.name}: ${started}/${run.entries.length} started`]
  for (const entry of failed) lines.push(`${entry.model}: ${entry.error ?? 'failed'}`)
  return { variant: failed.length > 0 ? 'warning' : 'success', message: lines.join('\n') }
}

function showMultiRunError(context: Context, error: unknown): void {
  if (isManagerRouteMissing(error)) {
    context.ui.toast.show({ variant: 'error', message: MULTI_RUN_ROUTE_MISSING })
    return
  }
  if (error instanceof ManagerApiError) {
    context.ui.toast.show({ variant: 'error', message: error.message })
    return
  }
  context.ui.toast.show({ variant: 'error', message: error instanceof Error ? error.message : String(error) })
}

async function launchMultiRunFlow(context: Context, api: ManagerApi, repoId: number, prompt: string): Promise<void> {
  const name = await promptDialog(context, {
    title: 'Multi-run name',
    description: 'Name this group of runs.',
    placeholder: 'Sweep',
    value: defaultMultiRunName(prompt),
  })
  if (!name) return

  const models = await multiSelectDialog(context, {
    title: 'Models',
    options: await listModelOptions(context),
    min: 1,
    max: MULTI_RUN_MAX_MODELS,
  })
  if (!models) return

  const isolate = await selectDialog<boolean>(context, 'Isolation', [
    { title: 'Isolated worktrees (recommended)', value: true },
    { title: 'Shared repo directory', value: false },
  ])
  if (isolate === undefined) return

  const baseRef = isolate
    ? await promptDialog(context, {
        title: 'Start from',
        description: 'Each isolated workspace starts from this branch.',
        placeholder: 'Current HEAD',
      })
    : undefined

  const request: LaunchMultiRunRequest = {
    repoId,
    name,
    prompt,
    models,
    isolate,
    ...(isolate && baseRef ? { baseRef } : {}),
  }
  const run = await api.launchMultiRun(request)
  context.ui.toast.show(multiRunLaunchToast(run))
  openManagerSessions(context, startedSessionIds(run))
}

export async function runMultiRunCommand(
  context: Context,
  deps: MultiRunCommandDeps,
  input?: string,
): Promise<void> {
  try {
    const remote = deps.remote
    if (!remote?.repoId) {
      context.ui.toast.show({ variant: 'error', message: MULTI_RUN_ATTACH_REQUIRED })
      return
    }

    const auth = await resolveManagerAuth(remote.managerUrl)
    if (!auth.ok) {
      context.ui.toast.show({ variant: 'error', message: auth.message })
      return
    }

    const prompt =
      slashArgument(input, 'multirun') ||
      (await promptDialog(context, {
        title: 'Multi-run prompt',
        description: 'The prompt to send to every model.',
        placeholder: 'Describe the task',
      }))
    if (!prompt) return

    const api = deps.createApi ? deps.createApi(auth) : new ManagerApi(auth.managerUrl, auth.token)

    await launchMultiRunFlow(context, api, remote.repoId, prompt)
  } catch (error) {
    showMultiRunError(context, error)
  }
}
