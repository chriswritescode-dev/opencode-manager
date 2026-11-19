import { parseJsonObject, type JsonObject } from '@opencode-manager/shared/utils'

export type EnforcementRemovedSections = JsonObject

function mergeRecordSections(target: JsonObject, key: string, value: JsonObject): void {
  const current = { ...(parseJsonObject(target[key]) ?? {}) }
  for (const [name, entry] of Object.entries(value)) {
    if (current[name] === undefined) {
      current[name] = entry
    }
  }
  target[key] = current
}

export function restoreEnforcementSections(config: JsonObject, removed: JsonObject): JsonObject {
  const restored: JsonObject = { ...config }

  for (const [key, value] of Object.entries(removed)) {
    if (key === 'plugin') {
      if (Array.isArray(value) && value.length > 0 && restored.plugin === undefined) {
        restored.plugin = value
      }
      continue
    }
    const valueSection = parseJsonObject(value)
    if (key === 'mcp' && valueSection !== null) {
      mergeRecordSections(restored, 'mcp', valueSection)
      continue
    }
    if (key === 'provider' && valueSection !== null) {
      mergeRecordSections(restored, 'provider', valueSection)
      continue
    }
    if (key === 'experimentalHook') {
      const experimental = { ...(parseJsonObject(restored.experimental) ?? {}) }
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
