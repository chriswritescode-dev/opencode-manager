import type { ConfigEntry, ModelRef } from '@opencode/client'
import { z } from 'zod'
import type { OpenCodeConfigInfo } from './config'

type ConfigDocumentModel = OpenCodeConfigInfo['model']

const ConfigModelRefSchema = z.object({
  providerID: z.string(),
  model: z.string(),
  variant: z.string().optional(),
})

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

  const ref: ModelRef = { providerID, id }
  if (variant) ref.variant = variant
  return ref
}

export function formatOpenCodeModelRef(ref: ModelRef): string {
  return ref.variant ? `${ref.providerID}/${ref.id}#${ref.variant}` : `${ref.providerID}/${ref.id}`
}

export function configModelRef(
  model: string | { providerID: string; model: string; variant?: string } | undefined | null,
): ModelRef | undefined {
  if (!model) return undefined
  const text = z.string().safeParse(model)
  if (text.success) return parseOpenCodeModelRef(text.data)

  const configured = ConfigModelRefSchema.safeParse(model)
  if (!configured.success) return undefined

  const ref: ModelRef = { providerID: configured.data.providerID, id: configured.data.model }
  if (configured.data.variant) ref.variant = configured.data.variant
  return ref
}

export function selectConfiguredModelRef(entries: ConfigEntry[]): ModelRef | undefined {
  const model = entries.reduce<ConfigDocumentModel>(
    (current, entry) => (entry.type === 'document' && entry.info.model ? entry.info.model : current),
    undefined,
  )

  return configModelRef(model)
}
