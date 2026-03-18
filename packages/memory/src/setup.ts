import { readFileSync, existsSync, mkdirSync, copyFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { homedir, platform } from 'os'
import { resolveDataDir, resolveLogPath } from './storage'
import type { PluginConfig, EmbeddingConfig } from './types'
import { parse as parseJsoncLib, type ParseError } from 'jsonc-parser'

function resolveBundledConfigPath(): string {
  const pluginDir = dirname(fileURLToPath(import.meta.url))
  return join(pluginDir, '..', 'config.jsonc')
}

function resolveConfigDir(): string {
  const defaultBase = join(homedir(), platform() === 'win32' ? 'AppData' : '.config')
  const xdgConfigHome = process.env['XDG_CONFIG_HOME'] || defaultBase
  return join(xdgConfigHome, 'opencode')
}

export function resolveConfigPath(): string {
  return join(resolveConfigDir(), 'memory-config.jsonc')
}

function resolveOldConfigPath(): string {
  const dataDir = resolveDataDir()
  return join(dataDir, 'config.json')
}

function ensureGlobalConfig(): void {
  const configDir = resolveConfigDir()
  const newConfigPath = resolveConfigPath()

  if (existsSync(newConfigPath)) {
    return
  }

  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true })
  }

  const oldConfigPath = resolveOldConfigPath()
  if (existsSync(oldConfigPath)) {
    copyFileSync(oldConfigPath, newConfigPath)
    return
  }

  const bundledConfigPath = resolveBundledConfigPath()
  if (existsSync(bundledConfigPath)) {
    copyFileSync(bundledConfigPath, newConfigPath)
  }
}

function getDefaultEmbeddingConfig(): EmbeddingConfig {
  return {
    provider: 'local',
    model: 'all-MiniLM-L6-v2',
    dimensions: 384,
  }
}

function getDefaultConfig(): PluginConfig {
  return {
    embedding: getDefaultEmbeddingConfig(),
    logging: {
      enabled: false,
      file: resolveLogPath(),
    },
  }
}

function isValidPluginConfig(config: unknown): config is PluginConfig {
  if (!config || typeof config !== 'object') return false

  const obj = config as Record<string, unknown>

  if (!obj.embedding || typeof obj.embedding !== 'object') return false

  const embedding = obj.embedding as Record<string, unknown>
  if (
    typeof embedding.provider !== 'string' ||
    !['openai', 'voyage', 'local'].includes(embedding.provider)
  ) {
    return false
  }

  if (typeof embedding.model !== 'string') return false

  return true
}

function parseJsonc<T = unknown>(content: string): T {
  const errors: ParseError[] = []
  const result = parseJsoncLib(content, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  })
  if (errors.length > 0) {
    throw new SyntaxError(`Invalid JSONC at offset ${errors[0]!.offset}`)
  }
  return result as T
}

export function loadPluginConfig(): PluginConfig {
  ensureGlobalConfig()
  
  const configPath = resolveConfigPath()

  if (!existsSync(configPath)) {
    return getDefaultConfig()
  }

  try {
    const content = readFileSync(configPath, 'utf-8')
    const parsed = parseJsonc(content)

    if (!isValidPluginConfig(parsed)) {
      console.warn(`[memory] Invalid config at ${configPath}, using defaults`)
      return getDefaultConfig()
    }

    return normalizeConfig(parsed)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn(`[memory] Failed to load config at ${configPath}: ${message}, using defaults`)
    return getDefaultConfig()
  }
}

function normalizeConfig(config: PluginConfig): PluginConfig {
  const normalized: PluginConfig = {
    dataDir: config.dataDir,
    embedding: config.embedding,
    dedupThreshold: config.dedupThreshold,
    logging: config.logging,
    compaction: config.compaction,
    memoryInjection: config.memoryInjection,
    messagesTransform: config.messagesTransform,
    executionModel: config.executionModel,
    auditorModel: config.auditorModel,
    ralph: config.ralph,
  }
  
  if (normalized.embedding) {
    const embedding = { ...normalized.embedding }
    
    if (embedding.baseUrl === '') {
      delete embedding.baseUrl
    }
    
    if (embedding.apiKey === '') {
      delete embedding.apiKey
    }
    
    normalized.embedding = embedding
  }
  
  return normalized
}
