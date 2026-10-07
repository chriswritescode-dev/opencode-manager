import { randomUUID } from 'node:crypto'
import type { Context, ToastOptions } from '@opencode/plugin/tui/context'
import {
  FuseMultiRunRequestSchema,
  FusionRecoveredDetailsSchema,
  FusionUnavailableDetailsSchema,
  LaunchMultiRunRequestSchema,
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
import { slashArgument } from './tui-dialogs.js'
import type { RemoteContext } from './remote-context.js'

export const MULTI_RUN_ATTACH_REQUIRED =
  'Multi-runs run on OpenCode Manager. Attach to a Manager repo with `ocm` first.'
export const MULTI_RUN_ROUTE_MISSING = 'This OpenCode Manager does not expose multi-runs to ocm; upgrade the Manager.'

export type ModelOption = {
  title: string
  description: string
  value: string
}

export type ActionResult<Value> = { ok: true; value: Value } | { ok: false; error: string }

export type LaunchFormInput = {
  prompt: string
  name: string
  models: string[]
  isolate: boolean
  baseRef: string
}

export type FusionFormInput = {
  entryIds: number[]
  model: string
  baseRef: string
  instructions: string
}

/** Multi-run operations the dialogs call. Launch and fuse open the started sessions themselves and resolve to an error message, or null. */
export type MultiRunActions = {
  loadModels(): Promise<ActionResult<ModelOption[]>>
  list(): Promise<ActionResult<MultiRun[]>>
  launch(form: LaunchFormInput): Promise<string | null>
  discard(run: MultiRun, entry: MultiRunEntry): Promise<ActionResult<MultiRun>>
  fuse(run: MultiRun, form: FusionFormInput): Promise<string | null>
  open(sessionId: string): void
}

export type MultiRunLaunchDialogProps = {
  actions: MultiRunActions
  initialPrompt: string
}

export type MultiRunsDialogProps = {
  actions: MultiRunActions
  newRun: () => void
}

export type MultiRunCommandDeps = {
  remote: RemoteContext | undefined
  showLaunchDialog: (props: MultiRunLaunchDialogProps) => void
  showRunsDialog: (props: MultiRunsDialogProps) => void
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

/** Case-insensitive match of every whitespace-separated term against the model name or ref. */
export function filterModelOptions(options: readonly ModelOption[], query: string): ModelOption[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return [...options]
  return options.filter((option) => {
    const haystack = `${option.title} ${option.value}`.toLowerCase()
    return terms.every((term) => haystack.includes(term))
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

export function defaultMultiRunName(prompt: string): string {
  return prompt.trim().split('\n')[0]!.slice(0, 80).trim()
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

export function runSummary(run: MultiRun): string {
  const started = run.entries.filter((entry) => entry.status === 'started').length
  return `${run.entries.length} models · ${started} started · ${run.fusions.length} fusions`
}

/** Started entries backed by a session: the sessions to open and the valid fusion sources. */
export function startedEntries(run: MultiRun): (MultiRunEntry & { sessionId: string })[] {
  return run.entries.filter(
    (entry): entry is MultiRunEntry & { sessionId: string } => entry.status === 'started' && entry.sessionId !== null,
  )
}

export function canDiscard(entry: MultiRunEntry): boolean {
  return entry.status === 'started' || entry.status === 'failed'
}

/** Toggles an entry in the fusion selection, ignoring non-source entries and selections past the model limit. */
export function toggleFusionSource(run: MultiRun, selected: readonly number[], entryId: number): number[] {
  if (selected.includes(entryId)) return selected.filter((id) => id !== entryId)
  if (!startedEntries(run).some((entry) => entry.id === entryId)) return [...selected]
  if (selected.length >= MULTI_RUN_MAX_MODELS) return [...selected]
  return [...selected, entryId]
}

export function parseLaunchForm(form: LaunchFormInput, repoId: number): ActionResult<LaunchMultiRunRequest> {
  const prompt = form.prompt.trim()
  if (!prompt) return { ok: false, error: 'Enter a prompt to send to every model.' }
  const name = form.name.trim() || defaultMultiRunName(prompt)
  if (form.models.length === 0) return { ok: false, error: 'Choose at least one model.' }
  if (form.models.length > MULTI_RUN_MAX_MODELS) return { ok: false, error: `Choose at most ${MULTI_RUN_MAX_MODELS} models.` }

  const baseRef = form.baseRef.trim()
  const parsed = LaunchMultiRunRequestSchema.safeParse({
    repoId,
    name,
    prompt,
    models: form.models,
    isolate: form.isolate,
    ...(form.isolate && baseRef ? { baseRef } : {}),
  })
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid multi-run.' }
  return { ok: true, value: parsed.data }
}

export function parseFusionForm(form: FusionFormInput, requestId: string): ActionResult<FuseMultiRunRequest> {
  if (form.entryIds.length < MULTI_RUN_FUSION_MIN_SOURCES) {
    return { ok: false, error: `Select at least ${MULTI_RUN_FUSION_MIN_SOURCES} started results to fuse.` }
  }
  if (!form.model) return { ok: false, error: 'Choose a synthesis model.' }

  const instructions = form.instructions.trim()
  const baseRef = form.baseRef.trim()
  const parsed = FuseMultiRunRequestSchema.safeParse({
    requestId,
    entryIds: form.entryIds,
    model: form.model,
    ...(instructions ? { instructions } : {}),
    ...(baseRef ? { baseRef } : {}),
  })
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid fusion.' }
  return { ok: true, value: parsed.data }
}

/** Maps a Manager error to a message, plus the session of an earlier fusion attempt the Manager recovered instead. */
export function describeMultiRunError(error: unknown): { message: string; recoveredSessionId?: string } {
  if (isManagerRouteMissing(error)) return { message: MULTI_RUN_ROUTE_MISSING }
  if (!(error instanceof ManagerApiError)) return { message: error instanceof Error ? error.message : String(error) }

  const unavailable = FusionUnavailableDetailsSchema.safeParse(error.details)
  if (unavailable.success && unavailable.data.unavailableSources.length > 0) {
    return { message: unavailable.data.unavailableSources.map((source) => `${source.model}: ${source.message}`).join('\n') }
  }

  const recovered = FusionRecoveredDetailsSchema.safeParse(error.details)
  const recoveredSessionId = recovered.success ? recovered.data.fusions[0]?.sessionId : undefined
  if (recoveredSessionId) return { message: 'An earlier fusion attempt is already running.', recoveredSessionId }

  return { message: error.message }
}

export function multiRunLaunchToast(run: MultiRun): ToastOptions {
  const started = run.entries.filter((entry) => entry.status === 'started').length
  const failed = run.entries.filter((entry) => entry.status === 'failed')
  const lines = [`Launched ${run.name}: ${started}/${run.entries.length} started`]
  for (const entry of failed) lines.push(`${entry.model}: ${entry.error ?? 'failed'}`)
  return { variant: failed.length > 0 ? 'warning' : 'success', message: lines.join('\n') }
}

export async function runMultiRunCommand(context: Context, deps: MultiRunCommandDeps, input?: string): Promise<void> {
  try {
    const repoId = deps.remote?.repoId
    if (!deps.remote || !repoId) {
      context.ui.toast.show({ variant: 'error', message: MULTI_RUN_ATTACH_REQUIRED })
      return
    }

    const auth = await resolveManagerAuth(deps.remote.managerUrl)
    if (!auth.ok) {
      context.ui.toast.show({ variant: 'error', message: auth.message })
      return
    }

    const api = deps.createApi ? deps.createApi(auth) : new ManagerApi(auth.managerUrl, auth.token)
    const actions = createMultiRunActions(context, api, repoId)
    const prompt = slashArgument(input, 'multirun')

    if (prompt) {
      deps.showLaunchDialog({ actions, initialPrompt: prompt })
      return
    }

    deps.showRunsDialog({ actions, newRun: () => deps.showLaunchDialog({ actions, initialPrompt: '' }) })
  } catch (error) {
    context.ui.toast.show({ variant: 'error', message: describeMultiRunError(error).message })
  }
}

function createMultiRunActions(context: Context, api: ManagerApi, repoId: number): MultiRunActions {
  const attempt = async <Value>(operation: () => Promise<Value>): Promise<ActionResult<Value>> => {
    try {
      return { ok: true, value: await operation() }
    } catch (error) {
      return { ok: false, error: describeMultiRunError(error).message }
    }
  }

  return {
    loadModels: () => attempt(() => listModelOptions(context)),
    list: () => attempt(() => api.listMultiRuns(repoId)),
    async launch(form) {
      const parsed = parseLaunchForm(form, repoId)
      if (!parsed.ok) return parsed.error
      const result = await attempt(() => api.launchMultiRun(parsed.value))
      if (!result.ok) return result.error
      context.ui.toast.show(multiRunLaunchToast(result.value))
      openManagerSessions(context, startedEntries(result.value).map((entry) => entry.sessionId))
      return null
    },
    async discard(run, entry) {
      const result = await attempt(() => api.discardMultiRunEntry(run.id, entry.id))
      if (result.ok) context.ui.toast.show({ variant: 'success', message: `Discarded ${entry.model}` })
      return result
    },
    async fuse(run, form) {
      const requestId = randomUUID()
      const parsed = parseFusionForm(form, requestId)
      if (!parsed.ok) return parsed.error
      try {
        const updated = await api.fuseMultiRun(run.id, parsed.value)
        const fusion = updated.fusions.find((candidate) => candidate.requestId === requestId)
        if (fusion?.status === 'failed') return fusion.error ?? `Fusion with ${fusion.model} failed`
        context.ui.toast.show({ variant: 'success', message: `Fusing with ${form.model}` })
        if (fusion?.sessionId) openManagerSessions(context, [fusion.sessionId])
        return null
      } catch (error) {
        const described = describeMultiRunError(error)
        if (!described.recoveredSessionId) return described.message
        context.ui.toast.show({ variant: 'info', message: `${described.message} Opened it instead.` })
        openManagerSessions(context, [described.recoveredSessionId])
        return null
      }
    },
    open: (sessionId) => openManagerSessions(context, [sessionId]),
  }
}
