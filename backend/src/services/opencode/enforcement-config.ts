import { logger } from '../../utils/logger'

export type EnforcementRemovedSections = Record<string, unknown>

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function sanitizeConfigForEnforcement(
  config: Record<string, unknown>,
  enforced: boolean,
): Record<string, unknown> {
  return sanitizeConfigForEnforcementResult(config, enforced).sanitized
}

export function sanitizeConfigForEnforcementResult(
  config: Record<string, unknown>,
  enforced: boolean,
): { sanitized: Record<string, unknown>; removed: EnforcementRemovedSections } {
  if (!enforced) {
    return { sanitized: config, removed: {} }
  }
  const { sanitized, removed } = sanitizeEnforcementSections(config)
  if (Object.keys(removed).length === 0) {
    return { sanitized: config, removed: {} }
  }
  if (Array.isArray(removed.plugin)) {
    logger.warn(`Stripped ${removed.plugin.length} configured OpenCode plugin(s) from the live config while sandbox enforcement is active`)
  }
  if (isRecord(removed.mcp)) {
    logger.warn(`Disabled ${Object.keys(removed.mcp).length} local MCP server(s) from the live config while sandbox enforcement is active`)
  }
  if (isRecord(removed.provider)) {
    logger.warn(`Disabled ${Object.keys(removed.provider).length} custom provider module(s) from the live config while sandbox enforcement is active`)
  }
  if (removed.formatter !== undefined) {
    logger.warn('Disabled formatter execution from the live config while sandbox enforcement is active')
  }
  if (removed.shell !== undefined) {
    logger.warn('Disabled the shell configuration from the live config while sandbox enforcement is active')
  }
  if (removed.lsp !== undefined) {
    logger.warn('Disabled LSP server configuration from the live config while sandbox enforcement is active')
  }
  if (removed.experimentalHook !== undefined) {
    logger.warn('Disabled experimental hook commands from the live config while sandbox enforcement is active')
  }
  return { sanitized, removed }
}

export function isLocalMcpServerEntry(entry: unknown): boolean {
  if (!isRecord(entry)) return false
  return entry.type === 'local' || Array.isArray(entry.command)
}

export function isCustomProviderEntry(entry: unknown): boolean {
  return isRecord(entry) && typeof entry.npm === 'string'
}

export function sanitizeEnforcementSections(config: Record<string, unknown>): {
  sanitized: Record<string, unknown>
  removed: EnforcementRemovedSections
} {
  const sanitized: Record<string, unknown> = { ...config }
  const removed: EnforcementRemovedSections = {}

  if (Array.isArray(config.plugin) && config.plugin.length > 0) {
    delete sanitized.plugin
    removed.plugin = config.plugin
  }

  if (config.formatter !== undefined) {
    delete sanitized.formatter
    removed.formatter = config.formatter
  }

  if (config.shell !== undefined) {
    delete sanitized.shell
    removed.shell = config.shell
  }

  const mcp = config.mcp
  if (isRecord(mcp)) {
    const retained: Record<string, unknown> = {}
    const removedMcp: Record<string, unknown> = {}
    for (const [name, entry] of Object.entries(mcp)) {
      if (isLocalMcpServerEntry(entry)) {
        removedMcp[name] = entry
      } else {
        retained[name] = entry
      }
    }
    if (Object.keys(removedMcp).length > 0) {
      removed.mcp = removedMcp
      if (Object.keys(retained).length > 0) {
        sanitized.mcp = retained
      } else {
        delete sanitized.mcp
      }
    }
  }

  const provider = config.provider
  if (isRecord(provider)) {
    const retainedProvider: Record<string, unknown> = {}
    const removedProvider: Record<string, unknown> = {}
    for (const [name, entry] of Object.entries(provider)) {
      if (isCustomProviderEntry(entry)) {
        removedProvider[name] = entry
      } else {
        retainedProvider[name] = entry
      }
    }
    if (Object.keys(removedProvider).length > 0) {
      removed.provider = removedProvider
      if (Object.keys(retainedProvider).length > 0) {
        sanitized.provider = retainedProvider
      } else {
        delete sanitized.provider
      }
    }
  }

  const lsp = config.lsp
  if (lsp !== undefined && lsp !== false) {
    delete sanitized.lsp
    removed.lsp = lsp
  }

  const experimental = config.experimental
  if (isRecord(experimental) && experimental.hook !== undefined) {
    const retainedExperimental: Record<string, unknown> = { ...experimental }
    delete retainedExperimental.hook
    removed.experimentalHook = experimental.hook
    if (Object.keys(retainedExperimental).length > 0) {
      sanitized.experimental = retainedExperimental
    } else {
      delete sanitized.experimental
    }
  }

  return { sanitized, removed }
}

export function restoreEnforcementSections(
  config: Record<string, unknown>,
  removed: EnforcementRemovedSections,
): Record<string, unknown> {
  const restored: Record<string, unknown> = { ...config }

  for (const [key, value] of Object.entries(removed)) {
    if (key === 'plugin') {
      if (Array.isArray(value) && value.length > 0 && restored.plugin === undefined) {
        restored.plugin = value
      }
      continue
    }
    if (key === 'mcp' && isRecord(value)) {
      const currentMcp = isRecord(restored.mcp) ? { ...(restored.mcp as Record<string, unknown>) } : {}
      for (const [name, entry] of Object.entries(value)) {
        if (currentMcp[name] === undefined) {
          currentMcp[name] = entry
        }
      }
      restored.mcp = currentMcp
      continue
    }
    if (key === 'provider' && isRecord(value)) {
      const currentProvider = isRecord(restored.provider) ? { ...(restored.provider as Record<string, unknown>) } : {}
      for (const [name, entry] of Object.entries(value)) {
        if (currentProvider[name] === undefined) {
          currentProvider[name] = entry
        }
      }
      restored.provider = currentProvider
      continue
    }
    if (key === 'experimentalHook') {
      const experimental = isRecord(restored.experimental)
        ? { ...(restored.experimental as Record<string, unknown>) }
        : {}
      if (experimental.hook === undefined) {
        experimental.hook = value
        restored.experimental = experimental
      }
      continue
    }
    if (restored[key] === undefined) {
      restored[key] = value
    }
  }

  return restored
}
