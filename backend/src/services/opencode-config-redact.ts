import type { OpenCodeConfigFile } from '../types/settings'
import { parseJsonObject, parseJsonString, type JsonObject, type JsonValue } from '@opencode-manager/shared/utils'
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
  content: JsonObject
  redactedPaths: string[]
}

export interface RedactedOpenCodeConfigSource {
  name: OpenCodeConfigFile['sources'][number]['name']
  path: string
  content: JsonObject
  isValid: boolean
  validationIssues?: OpenCodeConfigFile['validationIssues']
  updatedAt: number
}

export interface RedactedOpenCodeConfigFile {
  path: string
  content: JsonObject
  isValid: boolean
  validationIssues?: OpenCodeConfigFile['validationIssues']
  updatedAt: number
  sources: RedactedOpenCodeConfigSource[]
  revision: string
  redactedPaths: string[]
}

function normalizeSecretKey(key: string): string {
  return key.toLowerCase().replace(/[-_]/g, '')
}

function isSecretKey(key: string): boolean {
  return SECRET_KEYS.has(normalizeSecretKey(key))
}

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

function setIfPresent(target: JsonObject, key: string, value: JsonValue | undefined): void {
  if (value !== undefined) target[key] = value
}

function redactOpaqueValue(value: JsonValue | undefined, path: string[], redactedPaths: string[]): JsonValue | undefined {
  if (Array.isArray(value)) {
    const redacted: JsonValue[] = []
    value.forEach((item, index) => {
      const redactedItem = redactOpaqueValue(item, [...path, String(index)], redactedPaths)
      if (redactedItem !== undefined) redacted.push(redactedItem)
    })
    return redacted
  }
  const text = parseJsonString(value)
  if (text !== null) {
    redactedPaths.push(path.join('.'))
    return OPENCODE_CONFIG_REDACTED_VALUE
  }
  const container = parseJsonObject(value)
  if (container === null) return value
  const redacted: JsonObject = {}
  for (const [key, child] of Object.entries(container)) {
    setIfPresent(redacted, key, redactOpaqueValue(child, [...path, key], redactedPaths))
  }
  return redacted
}

function redactValue(value: JsonValue | undefined, path: string[], redactedPaths: string[]): JsonValue | undefined {
  if (Array.isArray(value)) {
    const redacted: JsonValue[] = []
    value.forEach((item, index) => {
      const redactedItem = redactValue(item, [...path, String(index)], redactedPaths)
      if (redactedItem !== undefined) redacted.push(redactedItem)
    })
    return redacted
  }
  const container = parseJsonObject(value)
  if (container === null) return value

  const names = keysAreNames(path)
  const redacted: JsonObject = {}
  for (const [key, child] of Object.entries(container)) {
    const childPath = [...path, key]
    if (names) {
      setIfPresent(redacted, key, redactValue(child, childPath, redactedPaths))
      continue
    }
    if (OPAQUE_VALUE_KEYS.has(key)) {
      setIfPresent(redacted, key, redactOpaqueValue(child, childPath, redactedPaths))
      continue
    }
    if (isSecretKey(key)) {
      if (parseJsonString(child) !== null) {
        redactedPaths.push(childPath.join('.'))
        redacted[key] = OPENCODE_CONFIG_REDACTED_VALUE
        continue
      }
      if (parseJsonObject(child) !== null || Array.isArray(child)) {
        setIfPresent(redacted, key, redactOpaqueValue(child, childPath, redactedPaths))
        continue
      }
      setIfPresent(redacted, key, child)
      continue
    }
    setIfPresent(redacted, key, redactValue(child, childPath, redactedPaths))
  }
  return redacted
}

function uniqueSortedPaths(paths: string[]): string[] {
  return [...new Set(paths)].toSorted()
}

export function redactOpenCodeConfigContent(content: JsonValue | undefined): RedactedOpenCodeConfigContent {
  const redactedPaths: string[] = []
  return {
    content: parseJsonObject(redactValue(parseJsonObject(content) ?? {}, [], redactedPaths)) ?? {},
    redactedPaths: uniqueSortedPaths(redactedPaths),
  }
}

export function redactOpenCodeConfigFile(config: OpenCodeConfigFile): RedactedOpenCodeConfigFile {
  const redacted = redactOpenCodeConfigContent(config.content)
  const redactedFile: RedactedOpenCodeConfigFile = {
    path: config.path,
    content: redacted.content,
    isValid: config.isValid,
    updatedAt: config.updatedAt,
    sources: config.sources.map((source): RedactedOpenCodeConfigSource => {
      const redactedSource: RedactedOpenCodeConfigSource = {
        name: source.name,
        path: source.path,
        content: redactOpenCodeConfigContent(source.content).content,
        isValid: source.isValid,
        updatedAt: source.updatedAt,
      }
      if (source.validationIssues) redactedSource.validationIssues = source.validationIssues
      return redactedSource
    }),
    revision: config.revision,
    redactedPaths: redacted.redactedPaths,
  }
  if (config.validationIssues) redactedFile.validationIssues = config.validationIssues
  return redactedFile
}
