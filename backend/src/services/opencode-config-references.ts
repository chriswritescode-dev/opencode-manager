import { isRecord } from '@opencode-manager/shared/utils'
import { V1_ENTITY_PATHS, type OpenCodeConfigV1EntityPath } from './opencode-config-file'

const CONFIG_REFERENCE_PATTERN = /\{(?:env|file):[^}]+\}/

type FieldAlias = readonly [v2Prefix: readonly string[], v1Prefix: readonly string[]]

const V1_FIELD_ALIASES: Readonly<Record<string, readonly FieldAlias[]>> = {
  agents: [
    [['system'], ['prompt']],
    [['request', 'body', 'temperature'], ['temperature']],
    [['request', 'body', 'top_p'], ['top_p']],
    [['request', 'body'], ['options']],
  ],
  providers: [
    [['settings', 'baseURL'], ['api']],
    [['headers'], ['options', 'headers']],
    [['body'], ['options', 'body']],
    [['settings'], ['options']],
  ],
  'mcp.servers': [
    [['oauth', 'client_id'], ['oauth', 'clientId']],
    [['oauth', 'client_secret'], ['oauth', 'clientSecret']],
    [['oauth', 'redirect_uri'], ['oauth', 'redirectUri']],
  ],
}

interface RawEntityCandidate {
  entity: unknown
  aliases: readonly FieldAlias[]
}

/** Reads a nested config value by object keys and array indices, or `undefined` when absent. */
export function readConfigValueAtPath(value: unknown, path: readonly string[]): unknown {
  let current = value
  for (const segment of path) {
    if (Array.isArray(current)) {
      current = current[Number(segment)]
      continue
    }
    if (!isRecord(current) || !Object.prototype.hasOwnProperty.call(current, segment)) return undefined
    current = current[segment]
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
      if (typeof raw === 'string' && CONFIG_REFERENCE_PATTERN.test(raw)) return raw
    }
  }
  return undefined
}

function restoreEntityReferences(
  next: unknown,
  path: readonly string[],
  resolvedEntity: unknown,
  candidates: readonly RawEntityCandidate[],
): unknown {
  if (typeof next === 'string') {
    if (readConfigValueAtPath(resolvedEntity, path) !== next) return next
    return readRawReference(candidates, path) ?? next
  }
  if (Array.isArray(next)) {
    return next.map((item, index) => restoreEntityReferences(item, [...path, String(index)], resolvedEntity, candidates))
  }
  if (isRecord(next)) {
    return Object.fromEntries(
      Object.entries(next).map(([key, value]) => [key, restoreEntityReferences(value, [...path, key], resolvedEntity, candidates)]),
    )
  }
  return next
}

function findRenameSource(
  patchContainer: Record<string, unknown>,
  resolvedContainer: Record<string, unknown>,
): string | undefined {
  const removed = Object.keys(patchContainer).filter(
    (name) => patchContainer[name] === null && Object.prototype.hasOwnProperty.call(resolvedContainer, name),
  )
  return removed.length === 1 ? removed[0] : undefined
}

function restoreContainerReferences(
  mapping: OpenCodeConfigV1EntityPath,
  patchContainer: Record<string, unknown>,
  resolved: Record<string, unknown>,
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const resolvedContainer = readConfigValueAtPath(resolved, mapping.v2Path)
  if (!isRecord(resolvedContainer)) return patchContainer
  const rawV2Container = readConfigValueAtPath(raw, mapping.v2Path)
  const rawV1Container = readConfigValueAtPath(raw, mapping.v1Path)
  const aliases = V1_FIELD_ALIASES[mapping.v2Path.join('.')] ?? []

  return Object.fromEntries(
    Object.entries(patchContainer).map(([name, value]) => {
      if (!isRecord(value)) return [name, value]
      const sourceName = Object.prototype.hasOwnProperty.call(resolvedContainer, name)
        ? name
        : findRenameSource(patchContainer, resolvedContainer)
      if (sourceName === undefined) return [name, value]

      const candidates: RawEntityCandidate[] = [
        { entity: isRecord(rawV2Container) ? rawV2Container[sourceName] : undefined, aliases: [] },
      ]
      if (!mapping.reservedNames?.includes(sourceName)) {
        candidates.push({ entity: isRecord(rawV1Container) ? rawV1Container[sourceName] : undefined, aliases })
      }
      return [name, restoreEntityReferences(value, [], resolvedContainer[sourceName], candidates)]
    }),
  )
}

function setValueAtPath(target: Record<string, unknown>, path: readonly string[], value: unknown): Record<string, unknown> {
  const [head, ...rest] = path
  if (head === undefined) return target
  const child = target[head]
  return {
    ...target,
    [head]: rest.length === 0 ? value : setValueAtPath(isRecord(child) ? child : {}, rest, value),
  }
}

/**
 * Keeps `{env:…}` and `{file:…}` references in a merge patch of named config entities.
 *
 * Settings edits entities from OpenCode's resolved config, so an untouched field arrives with its
 * substituted value. A string that still equals the resolved value is replaced by the reference
 * stored in the raw config: the same entity, the entity being renamed, or its v1 definition.
 */
export function restoreOpenCodeConfigReferences(
  patch: Record<string, unknown>,
  resolved: Record<string, unknown>,
  raw: Record<string, unknown>,
): Record<string, unknown> {
  return V1_ENTITY_PATHS.filter((mapping) => mapping.named).reduce((current, mapping) => {
    const patchContainer = readConfigValueAtPath(current, mapping.v2Path)
    if (!isRecord(patchContainer)) return current
    return setValueAtPath(current, mapping.v2Path, restoreContainerReferences(mapping, patchContainer, resolved, raw))
  }, patch)
}
