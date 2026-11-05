import { isRecord } from '@opencode-manager/shared/utils'
import type { OpenCodeConfigFile } from '../types/settings'
import { OPENCODE_CONFIG_REDACTED_VALUE } from './opencode-config-file'

const SECRET_KEYS = new Set([
  'apikey',
  'token',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'bearertoken',
  'authtoken',
  'clientsecret',
  'secret',
  'password',
  'passphrase',
  'authorization',
  'credential',
  'credentials',
  'privatekey',
])

const OPAQUE_VALUE_KEYS = new Set(['headers', 'environment'])

export interface RedactedOpenCodeConfigContent {
  content: Record<string, unknown>
  redactedPaths: string[]
}

export interface RedactedOpenCodeConfigFile {
  path: string
  content: Record<string, unknown>
  isValid: boolean
  validationIssues?: OpenCodeConfigFile['validationIssues']
  updatedAt: number
  sources: Array<{
    name: OpenCodeConfigFile['sources'][number]['name']
    path: string
    content: Record<string, unknown>
    isValid: boolean
    validationIssues?: OpenCodeConfigFile['validationIssues']
    updatedAt: number
  }>
  revision: string
  redactedPaths: string[]
}

function normalizeSecretKey(key: string): string {
  return key.toLowerCase().replace(/[-_]/g, '')
}

function isSecretKey(key: string): boolean {
  return SECRET_KEYS.has(normalizeSecretKey(key))
}

/**
 * Reports whether a config path points at a map of user-chosen names (`providers`, `agents`,
 * `commands`, `mcp.servers`), so its keys are treated as names rather than secret keys.
 */
function keysAreNames(path: string[]): boolean {
  const [head] = path
  if (head === 'providers') {
    return path.length === 1 || (path.length === 3 && path[2] === 'models')
  }
  if (head === 'agents' || head === 'commands') {
    return path.length === 1
  }
  if (head === 'mcp') {
    return path.length === 2 && path[1] === 'servers'
  }
  return false
}

function redactOpaqueValue(value: unknown, path: string[], redactedPaths: string[]): unknown {
  if (Array.isArray(value)) {
    return value.map((item, index) => redactOpaqueValue(item, [...path, String(index)], redactedPaths))
  }
  if (!isRecord(value)) {
    if (typeof value !== 'string') return value
    redactedPaths.push(path.join('.'))
    return OPENCODE_CONFIG_REDACTED_VALUE
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, redactOpaqueValue(child, [...path, key], redactedPaths)]),
  )
}

/**
 * Recursively copies a config value with secret-named strings and the contents of `headers` and
 * `environment` replaced by the redaction placeholder, appending each redacted path to `redactedPaths`.
 */
function redactValue(value: unknown, path: string[], redactedPaths: string[]): unknown {
  if (Array.isArray(value)) {
    return value.map((item, index) => redactValue(item, [...path, String(index)], redactedPaths))
  }
  if (!isRecord(value)) return value

  const names = keysAreNames(path)
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => {
      const childPath = [...path, key]
      if (names) {
        return [key, redactValue(child, childPath, redactedPaths)]
      }
      if (OPAQUE_VALUE_KEYS.has(key)) {
        return [key, redactOpaqueValue(child, childPath, redactedPaths)]
      }
      if (isSecretKey(key)) {
        if (typeof child === 'string') {
          redactedPaths.push(childPath.join('.'))
          return [key, OPENCODE_CONFIG_REDACTED_VALUE]
        }
        if (isRecord(child) || Array.isArray(child)) {
          return [key, redactOpaqueValue(child, childPath, redactedPaths)]
        }
        return [key, child]
      }
      return [key, redactValue(child, childPath, redactedPaths)]
    }),
  )
}

function uniqueSortedPaths(paths: string[]): string[] {
  return [...new Set(paths)].toSorted()
}

export function redactOpenCodeConfigContent(
  content: Record<string, unknown>,
): RedactedOpenCodeConfigContent {
  const redactedPaths: string[] = []
  return {
    content: redactValue(content, [], redactedPaths) as Record<string, unknown>,
    redactedPaths: uniqueSortedPaths(redactedPaths),
  }
}

export function redactOpenCodeConfigFile(config: OpenCodeConfigFile): RedactedOpenCodeConfigFile {
  const redacted = redactOpenCodeConfigContent(config.content)
  return {
    path: config.path,
    content: redacted.content,
    isValid: config.isValid,
    ...(config.validationIssues ? { validationIssues: config.validationIssues } : {}),
    updatedAt: config.updatedAt,
    sources: config.sources.map((source) => ({
      name: source.name,
      path: source.path,
      content: redactOpenCodeConfigContent(source.content).content,
      isValid: source.isValid,
      ...(source.validationIssues ? { validationIssues: source.validationIssues } : {}),
      updatedAt: source.updatedAt,
    })),
    revision: config.revision,
    redactedPaths: redacted.redactedPaths,
  }
}
