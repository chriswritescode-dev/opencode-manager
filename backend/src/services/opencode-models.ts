import { proxyToOpenCodeWithDirectory } from './proxy'

interface OpenCodeConfigResponse {
  model?: string
  small_model?: string
}

interface OpenCodeProviderResponse {
  providers?: Array<{
    id: string
    models?: Record<string, unknown>
  }>
  default?: Record<string, string>
}

export interface ResolvedOpenCodeModel {
  providerID: string
  modelID: string
  model: string
}

function normalizeModelCandidate(model: string | null | undefined): string | null {
  if (!model) {
    return null
  }

  const normalized = model.trim()
  return normalized ? normalized : null
}

function parseModel(model: string): ResolvedOpenCodeModel | null {
  const [providerID, ...modelParts] = model.split('/')
  const modelID = modelParts.join('/')

  if (!providerID || !modelID) {
    return null
  }

  return {
    providerID,
    modelID,
    model: `${providerID}/${modelID}`,
  }
}

function buildAvailableModels(response: OpenCodeProviderResponse): Set<string> {
  const availableModels = new Set<string>()

  for (const provider of response.providers ?? []) {
    for (const modelID of Object.keys(provider.models ?? {})) {
      availableModels.add(`${provider.id}/${modelID}`)
    }
  }

  return availableModels
}

function uniqueCandidates(candidates: Array<string | null | undefined>): string[] {
  const normalizedCandidates = candidates
    .map(normalizeModelCandidate)
    .filter((candidate): candidate is string => candidate !== null)

  return [...new Set(normalizedCandidates)]
}

async function fetchOpenCodeConfig(directory?: string): Promise<OpenCodeConfigResponse> {
  const response = await proxyToOpenCodeWithDirectory('/config', 'GET', directory)

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(errorText || 'Failed to fetch OpenCode config')
  }

  return await response.json() as OpenCodeConfigResponse
}

async function fetchOpenCodeProviders(directory?: string): Promise<OpenCodeProviderResponse> {
  const response = await proxyToOpenCodeWithDirectory('/config/providers', 'GET', directory)

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(errorText || 'Failed to fetch OpenCode providers')
  }

  return await response.json() as OpenCodeProviderResponse
}

export async function resolveOpenCodeModel(
  directory: string | undefined,
  options?: {
    preferredModel?: string | null
    preferSmallModel?: boolean
  },
): Promise<ResolvedOpenCodeModel> {
  const [config, providersResponse] = await Promise.all([
    fetchOpenCodeConfig(directory),
    fetchOpenCodeProviders(directory),
  ])

  const availableModels = buildAvailableModels(providersResponse)
  const defaultModels = providersResponse.default ?? {}
  const configCandidates = options?.preferSmallModel
    ? [config.small_model, config.model]
    : [config.model, config.small_model]
  const candidates = uniqueCandidates([options?.preferredModel, ...configCandidates])

  for (const candidate of candidates) {
    if (availableModels.has(candidate)) {
      const parsedCandidate = parseModel(candidate)
      if (parsedCandidate) {
        return parsedCandidate
      }
    }

    const parsedCandidate = parseModel(candidate)
    if (!parsedCandidate) {
      continue
    }

    const providerDefaultModel = defaultModels[parsedCandidate.providerID]
    if (!providerDefaultModel) {
      continue
    }

    const providerDefault = `${parsedCandidate.providerID}/${providerDefaultModel}`
    if (availableModels.has(providerDefault)) {
      return {
        providerID: parsedCandidate.providerID,
        modelID: providerDefaultModel,
        model: providerDefault,
      }
    }
  }

  for (const [providerID, modelID] of Object.entries(defaultModels)) {
    const model = `${providerID}/${modelID}`
    if (availableModels.has(model)) {
      return {
        providerID,
        modelID,
        model,
      }
    }
  }

  for (const provider of providersResponse.providers ?? []) {
    const firstModelID = Object.keys(provider.models ?? {})[0]
    if (firstModelID) {
      return {
        providerID: provider.id,
        modelID: firstModelID,
        model: `${provider.id}/${firstModelID}`,
      }
    }
  }

  throw new Error('No configured OpenCode models are available')
}
