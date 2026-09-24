import type { ModelInfo } from '@opencode-manager/shared/opencode'
import { openCodeLocation } from '@opencode-manager/shared/opencode'
import type { OpenCodeClient } from './opencode/client'

export interface ResolvedOpenCodeModel {
  providerID: string
  id: string
  variant?: string
  model: string
}

interface ModelRef {
  providerID: string
  id: string
  variant?: string
}

function normalizeModelCandidate(model: string | null | undefined): string | null {
  if (!model) {
    return null
  }

  const normalized = model.trim()
  return normalized ? normalized : null
}

function parseModelRef(model: string): ModelRef | null {
  const providerEnd = model.indexOf('/')
  if (providerEnd <= 0) {
    return null
  }

  const providerID = model.slice(0, providerEnd)
  const variantStart = model.indexOf('#', providerEnd + 1)
  const id = model.slice(providerEnd + 1, variantStart === -1 ? undefined : variantStart)
  const variant = variantStart === -1 ? undefined : model.slice(variantStart + 1)

  if (!id || providerID.includes('#') || (variant !== undefined && (!variant || variant.includes('#')))) {
    return null
  }

  return { providerID, id, ...(variant ? { variant } : {}) }
}

function formatModelRef(ref: ModelRef): string {
  return ref.variant ? `${ref.providerID}/${ref.id}#${ref.variant}` : `${ref.providerID}/${ref.id}`
}

function toResolvedModel(ref: ModelRef): ResolvedOpenCodeModel {
  return {
    providerID: ref.providerID,
    id: ref.id,
    ...(ref.variant ? { variant: ref.variant } : {}),
    model: formatModelRef(ref),
  }
}

function findAvailable(models: ModelInfo[], ref: ModelRef): ModelInfo | undefined {
  return models.find((model) => model.providerID === ref.providerID && model.id === ref.id)
}

export async function resolveOpenCodeModel(
  client: OpenCodeClient,
  directory: string,
  options?: {
    preferredModel?: string | null
  },
): Promise<ResolvedOpenCodeModel> {
  const location = openCodeLocation(directory)
  const [modelsResponse, defaultResponse] = await Promise.all([
    client.api.model.list(location),
    client.api.model.default(location),
  ])
  const models = modelsResponse.data

  const preferred = normalizeModelCandidate(options?.preferredModel)
  if (preferred) {
    const parsedPreferred = parseModelRef(preferred)
    if (parsedPreferred && findAvailable(models, parsedPreferred)) {
      return toResolvedModel(parsedPreferred)
    }
  }

  const defaultModel = defaultResponse.data
  if (defaultModel) {
    const defaultRef: ModelRef = { providerID: defaultModel.providerID, id: defaultModel.id }
    if (findAvailable(models, defaultRef)) {
      return toResolvedModel(defaultRef)
    }
  }

  const fallback = models.find((model) => model.enabled)
  if (fallback) {
    return toResolvedModel({ providerID: fallback.providerID, id: fallback.id })
  }

  throw new Error('No configured OpenCode models are available')
}
