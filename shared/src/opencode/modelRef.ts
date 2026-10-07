import type { ConfigEntry, ModelRef } from '@opencode/client'

type ConfigDocumentModel = Extract<ConfigEntry, { type: 'document' }>['info']['model']

export function parseOpenCodeModelRef(model: string): ModelRef | undefined {
  const providerEnd = model.indexOf('/')
  if (providerEnd <= 0) return undefined

  const providerID = model.slice(0, providerEnd)
  const variantStart = model.indexOf('#', providerEnd + 1)
  const id = model.slice(providerEnd + 1, variantStart === -1 ? undefined : variantStart)
  const variant = variantStart === -1 ? undefined : model.slice(variantStart + 1)

  if (!id || providerID.includes('#') || (variant !== undefined && (!variant || variant.includes('#')))) {
    return undefined
  }

  return { providerID, id, ...(variant ? { variant } : {}) }
}

export function formatOpenCodeModelRef(ref: ModelRef): string {
  return ref.variant ? `${ref.providerID}/${ref.id}#${ref.variant}` : `${ref.providerID}/${ref.id}`
}

export function configModelRef(
  model: string | { providerID: string; model: string; variant?: string } | undefined | null,
): ModelRef | undefined {
  if (!model) return undefined
  if (typeof model === 'string') return parseOpenCodeModelRef(model)

  return {
    providerID: model.providerID,
    id: model.model,
    ...(model.variant ? { variant: model.variant } : {}),
  }
}

export function selectConfiguredModelRef(entries: ConfigEntry[]): ModelRef | undefined {
  const model = entries.reduce<ConfigDocumentModel>(
    (current, entry) => (entry.type === 'document' && entry.info.model ? entry.info.model : current),
    undefined,
  )

  return configModelRef(model)
}
