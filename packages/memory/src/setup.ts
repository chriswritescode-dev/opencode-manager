import { readFileSync, existsSync, mkdirSync, copyFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { resolveDataDir, resolveLogPath } from './storage'
import type { PluginConfig, EmbeddingConfig } from './types'

function resolveBundledConfigPath(): string {
  const pluginDir = dirname(fileURLToPath(import.meta.url))
  return join(pluginDir, '..', 'config.json')
}

export function resolveConfigPath(): string {
  const dataDir = resolveDataDir()
  return `${dataDir}/config.json`
}

function ensureGlobalConfig(): void {
  const dataDir = resolveDataDir()
  const globalConfigPath = resolveConfigPath()

  if (existsSync(globalConfigPath)) {
    return
  }

  const bundledConfigPath = resolveBundledConfigPath()
  if (!existsSync(bundledConfigPath)) {
    return
  }

  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true })
  }

  copyFileSync(bundledConfigPath, globalConfigPath)
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

export function loadPluginConfig(): PluginConfig {
  ensureGlobalConfig()
  
  const configPath = resolveConfigPath()

  if (!existsSync(configPath)) {
    return getDefaultConfig()
  }

  try {
    const content = readFileSync(configPath, 'utf-8')
    const sanitized = sanitizeJson(content)
    const parsed = JSON.parse(sanitized)

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

function sanitizeJson(raw: string): string {
  return raw.replace(/,(\s*[}\]])/g, '$1')
}

function normalizeConfig(config: PluginConfig): PluginConfig {
  const normalized: PluginConfig = {
    dataDir: config.dataDir,
    embedding: config.embedding,
    dedupThreshold: config.dedupThreshold,
    logging: config.logging,
    compaction: config.compaction,
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
