import { V1_ENTITY_PATHS, type OpenCodeConfigV1EntityPath } from './opencode-config-file'
import { parseJsonObject, parseJsonString, type JsonObject, type JsonValue } from '@opencode-manager/shared/utils'

const CONFIG_REFERENCE_PATTERN = /\{(?:env|file):[^}]+\}/

type FieldAlias = readonly [v2Prefix: readonly string[], v1Prefix: readonly string[]]

const V1_FIELD_ALIASES = new Map<string, readonly FieldAlias[]>([
  [
    'agents',
    [
      [['system'], ['prompt']],
      [['request', 'body', 'temperature'], ['temperature']],
      [['request', 'body', 'top_p'], ['top_p']],
      [['request', 'body'], ['options']],
    ],
  ],
  [
    'providers',
    [
      [['settings', 'baseURL'], ['api']],
      [['headers'], ['options', 'headers']],
      [['body'], ['options', 'body']],
      [['settings'], ['options']],
    ],
  ],
  [
    'mcp.servers',
    [
      [['oauth', 'client_id'], ['oauth', 'clientId']],
      [['oauth', 'client_secret'], ['oauth', 'clientSecret']],
      [['oauth', 'redirect_uri'], ['oauth', 'redirectUri']],
    ],
  ],
])

interface RawEntityCandidate {
  entity: JsonValue | undefined
  aliases: readonly FieldAlias[]
}

export function readConfigValueAtPath(value: JsonValue | undefined, path: readonly string[]): JsonValue | undefined {
  let current: JsonValue | undefined = Array.isArray(value)
    ? value
    : parseJsonString(value) ?? parseJsonObject(value) ?? undefined
  for (const segment of path) {
    if (Array.isArray(current)) {
      current = current[Number(segment)]
      continue
    }
    const container = parseJsonObject(current)
    if (container === null || !Object.prototype.hasOwnProperty.call(container, segment)) return undefined
    current = container[segment]
  }
  return current
}

function startsWithPath(path: readonly string[], prefix: readonly string[]): boolean {
  return prefix.length <= path.length && prefix.every((segment, index) => path[index] === segment)
}

function readRawReference(candidates: readonly RawEntityCandidate[], path: readonly string[]): string | undefined {
  for (const candidate of candidates) {
    const paths = [
      path,
      ...candidate.aliases
        .filter(([v2Prefix]) => startsWithPath(path, v2Prefix))
        .map(([v2Prefix, v1Prefix]) => [...v1Prefix, ...path.slice(v2Prefix.length)]),
    ]
    for (const rawPath of paths) {
      const raw = readConfigValueAtPath(candidate.entity, rawPath)
      const reference = parseJsonString(raw)
      if (reference !== null && CONFIG_REFERENCE_PATTERN.test(reference)) return reference
    }
  }
  return undefined
}

function restoreEntityReferences(
  next: JsonValue | undefined,
  path: readonly string[],
  resolvedEntity: JsonValue | undefined,
  candidates: readonly RawEntityCandidate[],
): JsonValue | undefined {
  const text = parseJsonString(next)
  if (text !== null) {
    if (readConfigValueAtPath(resolvedEntity, path) !== text) return text
    return readRawReference(candidates, path) ?? text
  }
  if (Array.isArray(next)) {
    const restored: JsonValue[] = []
    next.forEach((item, index) => {
      const restoredItem = restoreEntityReferences(item, [...path, String(index)], resolvedEntity, candidates)
      if (restoredItem !== undefined) restored.push(restoredItem)
    })
    return restored
  }
  const container = parseJsonObject(next)
  if (container !== null) {
    const restored: JsonObject = {}
    for (const [key, value] of Object.entries(container)) {
      const restoredValue = restoreEntityReferences(value, [...path, key], resolvedEntity, candidates)
      if (restoredValue !== undefined) restored[key] = restoredValue
    }
    return restored
  }
  return next
}

function findRenameSource(patchContainer: JsonObject, resolvedContainer: JsonObject): string | undefined {
  const removed = Object.keys(patchContainer).filter(
    (name) => patchContainer[name] === null && Object.prototype.hasOwnProperty.call(resolvedContainer, name),
  )
  return removed.length === 1 ? removed[0] : undefined
}

function restoreContainerReferences(
  mapping: OpenCodeConfigV1EntityPath,
  patchContainer: JsonObject,
  resolved: JsonValue | undefined,
  raw: JsonValue | undefined,
): JsonObject {
  const resolvedContainer = parseJsonObject(readConfigValueAtPath(resolved, mapping.v2Path))
  if (resolvedContainer === null) return patchContainer
  const rawV2Container = parseJsonObject(readConfigValueAtPath(raw, mapping.v2Path))
  const rawV1Container = parseJsonObject(readConfigValueAtPath(raw, mapping.v1Path))
  const aliases = V1_FIELD_ALIASES.get(mapping.v2Path.join('.')) ?? []

  const restored: JsonObject = {}
  for (const [name, value] of Object.entries(patchContainer)) {
    const entity = parseJsonObject(value)
    if (entity === null) {
      restored[name] = value
      continue
    }
    const sourceName = Object.prototype.hasOwnProperty.call(resolvedContainer, name)
      ? name
      : findRenameSource(patchContainer, resolvedContainer)
    if (sourceName === undefined) {
      restored[name] = value
      continue
    }

    const candidates: RawEntityCandidate[] = [
      { entity: rawV2Container === null ? undefined : rawV2Container[sourceName], aliases: [] },
    ]
    if (!mapping.reservedNames?.includes(sourceName)) {
      candidates.push({ entity: rawV1Container === null ? undefined : rawV1Container[sourceName], aliases })
    }
    const restoredEntity = restoreEntityReferences(entity, [], resolvedContainer[sourceName], candidates)
    if (restoredEntity !== undefined) restored[name] = restoredEntity
  }
  return restored
}

function setValueAtPath(target: JsonObject, path: readonly string[], value: JsonValue): JsonObject {
  const [head, ...rest] = path
  if (head === undefined) return target
  const child = parseJsonObject(target[head]) ?? {}
  return {
    ...target,
    [head]: rest.length === 0 ? value : setValueAtPath(child, rest, value),
  }
}

export function patchNamesOpenCodeConfigEntities(patch: JsonValue | undefined): boolean {
  return V1_ENTITY_PATHS.some(
    (mapping) => mapping.named && parseJsonObject(readConfigValueAtPath(patch, mapping.v2Path)) !== null,
  )
}

export function restoreOpenCodeConfigReferences(
  patch: JsonObject,
  resolved: JsonValue | undefined,
  raw: JsonValue | undefined,
): JsonObject {
  return V1_ENTITY_PATHS.filter((mapping) => mapping.named).reduce((current, mapping) => {
    const patchContainer = parseJsonObject(readConfigValueAtPath(current, mapping.v2Path))
    if (patchContainer === null) return current
    return setValueAtPath(current, mapping.v2Path, restoreContainerReferences(mapping, patchContainer, resolved, raw))
  }, patch)
}
