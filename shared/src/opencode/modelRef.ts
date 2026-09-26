import type { ModelRef } from '@opencode/client'

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
