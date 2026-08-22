export type EnforcementRemovedSections = Record<string, unknown>

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function mergeRecordSections(target: Record<string, unknown>, key: string, value: Record<string, unknown>): void {
  const current = isRecord(target[key]) ? { ...(target[key] as Record<string, unknown>) } : {}
  for (const [name, entry] of Object.entries(value)) {
    if (current[name] === undefined) {
      current[name] = entry
    }
  }
  target[key] = current
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
      mergeRecordSections(restored, 'mcp', value)
      continue
    }
    if (key === 'provider' && isRecord(value)) {
      mergeRecordSections(restored, 'provider', value)
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
