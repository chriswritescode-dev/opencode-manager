import type { ModelInfo, ModelRef } from '@opencode-manager/shared/opencode'
import { formatOpenCodeModelRef, openCodeLocation, parseOpenCodeModelRef, selectConfiguredModelRef } from '@opencode-manager/shared/opencode'
import type { OpenCodeClient } from './opencode/client'

export interface ResolvedOpenCodeModel {
  providerID: string
  id: string
  variant?: string
  model: string
}

export interface ResolveOpenCodeModelOptions {
  preferredModel?: string | null
  signal?: AbortSignal
}

export const MODEL_LOAD_TIMEOUT_MS = 15_000
export const MODEL_LOAD_POLL_MS = 500

function normalizeModelCandidate(model: string | null | undefined): string | null {
  if (!model) {
    return null
  }

  const normalized = model.trim()
  return normalized ? normalized : null
}

function toResolvedModel(ref: ModelRef): ResolvedOpenCodeModel {
  return {
    providerID: ref.providerID,
    id: ref.id,
    ...(ref.variant ? { variant: ref.variant } : {}),
    model: formatOpenCodeModelRef(ref),
  }
}

function findAvailable(models: ModelInfo[], ref: ModelRef): ModelInfo | undefined {
  return models.find((model) => model.providerID === ref.providerID && model.id === ref.id)
}

function isTargetLoaded(models: ModelInfo[], targetRef: ModelRef | undefined): boolean {
  return !targetRef || findAvailable(models, targetRef) !== undefined
}

function resolveFromLoadedModels(
  models: ModelInfo[],
  defaultModel: ModelInfo | null,
  configuredRef: ModelRef | undefined,
  preferredRef: ModelRef | undefined,
): ResolvedOpenCodeModel | null {
  if (preferredRef && findAvailable(models, preferredRef)) {
    return toResolvedModel(preferredRef)
  }

  if (configuredRef && findAvailable(models, configuredRef)) {
    return toResolvedModel(configuredRef)
  }

  if (defaultModel) {
    const defaultRef: ModelRef = { providerID: defaultModel.providerID, id: defaultModel.id }
    if (findAvailable(models, defaultRef)) {
      return toResolvedModel(defaultRef)
    }
  }

  const fallback = models.find((model) => model.enabled)
  return fallback ? toResolvedModel({ providerID: fallback.providerID, id: fallback.id }) : null
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }

    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)

    function onAbort(): void {
      clearTimeout(timer)
      resolve()
    }

    signal.addEventListener('abort', onAbort, { once: true })

    if (signal.aborted) {
      onAbort()
    }
  })
}

type PollingResult<T> = { ok: true; value: T } | { ok: false }

function isAbortLike(error: unknown, signal: AbortSignal): boolean {
  if (error === signal.reason) {
    return true
  }

  if (typeof error !== 'object' || error === null) {
    return false
  }

  if ((error as { name?: unknown }).name === 'AbortError') {
    return true
  }

  const cause = (error as { cause?: unknown }).cause
  return cause !== undefined && cause !== error && isAbortLike(cause, signal)
}

async function runPollingRequest<T>(
  request: () => Promise<T>,
  external: AbortSignal | undefined,
  deadline: AbortSignal,
): Promise<PollingResult<T>> {
  try {
    return { ok: true, value: await request() }
  } catch (error) {
    external?.throwIfAborted()

    if (deadline.aborted && isAbortLike(error, deadline)) {
      return { ok: false }
    }

    throw error
  }
}

async function readConfiguredRef(
  client: OpenCodeClient,
  location: ReturnType<typeof openCodeLocation>,
  signal: AbortSignal,
): Promise<ModelRef | undefined> {
  const entries = await client.api.config.get(location, { signal })
  return selectConfiguredModelRef(entries)
}

export async function resolveOpenCodeModel(
  client: OpenCodeClient,
  directory: string,
  options?: ResolveOpenCodeModelOptions,
): Promise<ResolvedOpenCodeModel> {
  const location = openCodeLocation(directory)
  const preferred = normalizeModelCandidate(options?.preferredModel)
  const preferredRef = preferred ? parseOpenCodeModelRef(preferred) : undefined
  const external = options?.signal

  const timeoutController = new AbortController()
  const timeoutId = setTimeout(() => {
    timeoutController.abort(new Error('Timed out waiting for the OpenCode model catalog to load'))
  }, MODEL_LOAD_TIMEOUT_MS)
  const signal = external ? AbortSignal.any([external, timeoutController.signal]) : timeoutController.signal

  let models: ModelInfo[] = []
  let defaultModel: ModelInfo | null = null

  try {
    external?.throwIfAborted()

    const configuredRef = await readConfiguredRef(client, location, signal)
    const targetRef = preferredRef ?? configuredRef

    for (;;) {
      external?.throwIfAborted()

      if (timeoutController.signal.aborted) {
        break
      }

      const [listResult, defaultResult] = await Promise.all([
        runPollingRequest(
          () => client.api.model.list(location, { signal }),
          external,
          timeoutController.signal,
        ),
        runPollingRequest(
          () => client.api.model.default(location, { signal }),
          external,
          timeoutController.signal,
        ),
      ])

      if (listResult.ok) {
        models = listResult.value.data
      }

      if (defaultResult.ok) {
        defaultModel = defaultResult.value.data
      }

      if (!listResult.ok || !defaultResult.ok) {
        break
      }

      external?.throwIfAborted()

      if (timeoutController.signal.aborted) {
        break
      }

      const resolved = resolveFromLoadedModels(models, defaultModel, configuredRef, preferredRef)
      if (resolved && isTargetLoaded(models, targetRef)) {
        return resolved
      }

      await sleep(MODEL_LOAD_POLL_MS, signal)
    }

    external?.throwIfAborted()

    const resolved = resolveFromLoadedModels(models, defaultModel, configuredRef, preferredRef)
    if (resolved) {
      return resolved
    }

    if (models.length === 0) {
      throw timeoutController.signal.reason instanceof Error
        ? timeoutController.signal.reason
        : new Error('Timed out waiting for the OpenCode model catalog to load')
    }

    throw new Error('No configured OpenCode models are available')
  } finally {
    clearTimeout(timeoutId)
  }
}
