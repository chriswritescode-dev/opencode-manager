import type { ConfigEntry, ModelInfo, PluginInfo, ProviderInfo } from '@opencode/client'

export type CatalogModelInfo = ModelInfo & { miniMaxCatalogRank?: number }
export type ManagedCatalogPlugin = { id: string; path: string }

const routes: Record<string, { prefix: RegExp; flash: string; m3: string }> = {
  minimax: { prefix: /^MiniMax-M/i, flash: 'MiniMax-M3.1-Flash', m3: 'MiniMax-M3' },
  'minimax-cn': { prefix: /^MiniMax-M/i, flash: 'MiniMax-M3.1-Flash', m3: 'MiniMax-M3' },
  openrouter: { prefix: /^minimax\/minimax-m/i, flash: 'minimax/minimax-m3.1-flash:free', m3: 'minimax/minimax-m3' },
  opencode: { prefix: /^minimax-m/i, flash: 'minimax-m3.1-flash-free', m3: 'minimax-m3' },
}

export function applyMiniMaxCatalogPolicy(
  models: ModelInfo[],
  providers: ProviderInfo[],
  entries: ConfigEntry[],
  plugins: PluginInfo[],
  managedPlugins: ManagedCatalogPlugin[] = [],
): CatalogModelInfo[] {
  const unknownPlugin = plugins.some((plugin) =>
    plugin.source.type !== 'builtin' && !managedPlugins.some((managed) =>
      plugin.id === managed.id && plugin.source.type === 'local' && plugin.source.path === managed.path,
    ),
  )
  if (unknownPlugin) return models
  const documents = entries.filter((entry) => entry.type === 'document')
  if (documents.some((entry) => (entry.info.plugins?.length ?? 0) > 0)) return models
  const configuredProviders = new Set(documents.flatMap((entry) => Object.keys(entry.info.providers ?? {})))
  return models.map((model) => {
    const route = routes[model.providerID]
    const provider = providers.find((entry) => entry.id === model.providerID)
    if (!route || !provider || configuredProviders.has(model.providerID) ||
      (provider.canonical !== undefined && provider.canonical !== model.providerID) ||
      (model.canonical !== undefined && model.canonical !== model.providerID) ||
      model.id !== model.modelID || !route.prefix.test(model.modelID) ||
      !model.capabilities.input.includes('text') ||
      model.capabilities.output.length !== 1 || model.capabilities.output[0] !== 'text') return model
    return {
      ...model,
      miniMaxCatalogRank: model.modelID === route.flash ? 0 : model.modelID === route.m3 ? 1 : -1,
    }
  })
}

export function miniMaxCatalogRank(model: ModelInfo | { miniMaxCatalogRank?: number }): number | undefined {
  return 'miniMaxCatalogRank' in model && typeof model.miniMaxCatalogRank === 'number' ? model.miniMaxCatalogRank : undefined
}

export function ordinaryModelFallback(models: CatalogModelInfo[]): ModelInfo | undefined {
  const enabled = models.filter((model) => model.enabled &&
    (model.miniMaxCatalogRank === undefined || model.status !== 'deprecated'))
  const first = enabled[0]
  if (first?.miniMaxCatalogRank === undefined) return first
  const selectable = enabled.filter((model) => model.miniMaxCatalogRank !== -1)
  return selectable.find((model) => model.providerID === first.providerID && model.miniMaxCatalogRank === 0) ??
    selectable.find((model) => model.providerID === first.providerID && model.miniMaxCatalogRank === 1) ?? selectable[0]
}
