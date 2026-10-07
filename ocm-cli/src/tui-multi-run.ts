import { randomUUID } from 'node:crypto'
import type { Context, ToastOptions } from '@opencode/plugin/tui/context'
import {
  FusionUnavailableDetailsSchema,
  MULTI_RUN_FUSION_MIN_SOURCES,
  MULTI_RUN_MAX_MODELS,
  type FuseMultiRunRequest,
  type LaunchMultiRunRequest,
  type MultiRun,
  type MultiRunEntry,
  type MultiRunEntryStatus,
} from '@opencode-manager/shared/schemas'
import { formatOpenCodeModelRef } from '@opencode-manager/shared/opencode'
import { ManagerApi, ManagerApiError, isManagerRouteMissing } from './manager-api.js'
import { resolveManagerAuth } from './manager-auth.js'
import type { ManagerAuthOk } from './manager-auth.js'
import { confirmDialog, multiSelectDialog, promptDialog, selectDialog, slashArgument } from './tui-dialogs.js'
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

const ENTRY_STATUS_LABELS: Record<MultiRunEntryStatus, string> = {
  starting: 'Starting',
  started: 'Started',
  failed: 'Failed',
  discarded: 'Discarded',
}

export function formatEntryStatus(entry: MultiRunEntry): string {
  const parts = [ENTRY_STATUS_LABELS[entry.status], entry.isolated ? 'isolated' : 'shared directory']
  if (entry.error) parts.push(entry.error)
  return parts.join(' · ')
}

function startedSources(run: MultiRun): (MultiRunEntry & { sessionId: string })[] {
  return run.entries.filter(
    (entry): entry is MultiRunEntry & { sessionId: string } => entry.status === 'started' && entry.sessionId !== null,
  )
}

function startedSessionIds(run: MultiRun): string[] {
  return startedSources(run).map((entry) => entry.sessionId)
}

function runSummary(run: MultiRun): string {
  const started = run.entries.filter((entry) => entry.status === 'started').length
  return `${run.entries.length} models · ${started} started · ${run.fusions.length} fusions`
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
    const unavailable = FusionUnavailableDetailsSchema.safeParse(error.details)
    if (unavailable.success && unavailable.data.unavailableSources.length > 0) {
      context.ui.toast.show({
        variant: 'error',
        message: unavailable.data.unavailableSources.map((source) => `${source.model}: ${source.message}`).join('\n'),
      })
      return
    }
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

type RunChoice = { kind: 'new' } | { kind: 'run'; run: MultiRun }

type RunAction =
  | { kind: 'open'; sessionId: string }
  | { kind: 'fuse' }
  | { kind: 'discard'; entry: MultiRunEntry }

async function discardEntryFlow(context: Context, api: ManagerApi, run: MultiRun, entry: MultiRunEntry): Promise<void> {
  const confirmed = await confirmDialog(context, {
    title: 'Discard run',
    message: entry.isolated
      ? `Discard ${entry.model} and remove its workspace directory? This cannot be undone.`
      : `Discard ${entry.model}? This cannot be undone.`,
  })
  if (!confirmed) return

  await api.discardMultiRunEntry(run.id, entry.id)
  context.ui.toast.show({ variant: 'success', message: `Discarded ${entry.model}` })
}

async function fuseMultiRunFlow(context: Context, api: ManagerApi, run: MultiRun): Promise<void> {
  const entryIds = await multiSelectDialog<number>(context, {
    title: 'Fusion sources',
    options: startedSources(run).map((entry) => ({
      title: entry.model,
      description: formatEntryStatus(entry),
      value: entry.id,
    })),
    min: MULTI_RUN_FUSION_MIN_SOURCES,
    max: MULTI_RUN_MAX_MODELS,
  })
  if (!entryIds) return

  const model = await selectDialog(context, 'Synthesis model', await listModelOptions(context))
  if (!model) return

  const instructions = await promptDialog(context, {
    title: 'Instructions (optional)',
    description: 'Optional guidance for the synthesis.',
    placeholder: 'Optional guidance',
  })

  const requiresIsolation = run.entries.some((entry) => entryIds.includes(entry.id) && !entry.isolated)
  let isolate = true
  if (!requiresIsolation) {
    const chosen = await selectDialog<boolean>(context, 'Isolation', [
      { title: 'Isolated worktree (recommended)', value: true },
      { title: 'Shared repo directory', value: false },
    ])
    if (chosen === undefined) return
    isolate = chosen
  }

  const baseRef = isolate
    ? await promptDialog(context, {
        title: 'Start from',
        description: 'The synthesis workspace starts from this branch.',
        placeholder: 'Current HEAD',
        value: run.baseRef ?? '',
      })
    : undefined

  const requestId = randomUUID()
  const request: FuseMultiRunRequest = {
    requestId,
    entryIds,
    model,
    isolate,
    ...(instructions ? { instructions } : {}),
    ...(isolate && baseRef ? { baseRef } : {}),
  }

  const updated = await api.fuseMultiRun(run.id, request)
  const fusion = updated.fusions.find((candidate) => candidate.requestId === requestId)
  if (!fusion) return
  if (fusion.status === 'failed') {
    context.ui.toast.show({ variant: 'error', message: fusion.error ?? `Fusion of ${fusion.model} failed` })
    return
  }

  context.ui.toast.show({ variant: 'success', message: `Fused ${fusion.model}` })
  if (fusion.sessionId) openManagerSessions(context, [fusion.sessionId])
}

async function browseRunFlow(context: Context, api: ManagerApi, run: MultiRun): Promise<void> {
  const options: { title: string; description?: string; value: RunAction; disabled?: boolean }[] = []
  for (const entry of run.entries) {
    if (entry.sessionId) {
      options.push({
        title: `Open ${entry.model}`,
        description: formatEntryStatus(entry),
        value: { kind: 'open', sessionId: entry.sessionId },
      })
    }
  }
  for (const fusion of run.fusions) {
    if (fusion.sessionId) {
      options.push({ title: `Open fusion ${fusion.model}`, value: { kind: 'open', sessionId: fusion.sessionId } })
    }
  }
  options.push({
    title: 'Fuse results…',
    value: { kind: 'fuse' },
    disabled: startedSources(run).length < MULTI_RUN_FUSION_MIN_SOURCES,
  })
  for (const entry of run.entries) {
    if (entry.status === 'started' || entry.status === 'failed') {
      options.push({ title: `Discard ${entry.model}…`, value: { kind: 'discard', entry } })
    }
  }

  const action = await selectDialog(context, run.name, options)
  if (!action) return

  if (action.kind === 'open') {
    openManagerSessions(context, [action.sessionId])
    return
  }
  if (action.kind === 'discard') {
    await discardEntryFlow(context, api, run, action.entry)
    return
  }
  await fuseMultiRunFlow(context, api, run)
}

async function browseMultiRunsFlow(context: Context, api: ManagerApi, repoId: number): Promise<void> {
  const runs = await api.listMultiRuns(repoId)
  const choice = await selectDialog<RunChoice>(context, 'Multi-runs', [
    { title: 'New multi-run…', value: { kind: 'new' } },
    ...runs.map((run) => ({ title: run.name, description: runSummary(run), value: { kind: 'run' as const, run } })),
  ])
  if (!choice) return

  if (choice.kind === 'new') {
    const prompt = await promptDialog(context, {
      title: 'Multi-run prompt',
      description: 'The prompt to send to every model.',
      placeholder: 'Describe the task',
    })
    if (!prompt) return
    await launchMultiRunFlow(context, api, repoId, prompt)
    return
  }

  await browseRunFlow(context, api, choice.run)
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

    const api = deps.createApi ? deps.createApi(auth) : new ManagerApi(auth.managerUrl, auth.token)

    const prompt = slashArgument(input, 'multirun')
    if (prompt) {
      await launchMultiRunFlow(context, api, remote.repoId, prompt)
      return
    }

    await browseMultiRunsFlow(context, api, remote.repoId)
  } catch (error) {
    showMultiRunError(context, error)
  }
}
