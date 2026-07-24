import { createHash } from 'crypto'
import { readFile, writeFile, stat, unlink } from 'fs/promises'
import { join } from 'path'
import { logger } from './logger'
import { mkdirSafe } from './fs-safe'
import { getWorkspacePath } from '@opencode-manager/shared/config/env'

const DISCOVERY_CACHE_DIR = join(getWorkspacePath(), 'cache', 'discovery')
const DISCOVERY_CACHE_TTL_MS = 60 * 60 * 1000

export function normalizeToBaseUrl(endpoint: string): string {
  return endpoint
    .replace(/\/v1\/audio\/speech$/, '')
    .replace(/\/audio\/speech$/, '')
    .replace(/\/v1\/audio\/transcriptions$/, '')
    .replace(/\/audio\/transcriptions$/, '')
    .replace(/\/$/, '')
}

async function ensureDiscoveryCacheDir(): Promise<void> {
  await mkdirSafe(DISCOVERY_CACHE_DIR)
}

async function getCachedDiscovery<T>(cacheKey: string): Promise<T | null> {
  try {
    const filePath = join(DISCOVERY_CACHE_DIR, `${cacheKey}.json`)
    const fileStat = await stat(filePath)

    if (Date.now() - fileStat.mtimeMs > DISCOVERY_CACHE_TTL_MS) {
      await unlink(filePath)
      return null
    }

    const content = await readFile(filePath, 'utf-8')
    return JSON.parse(content) as T
  } catch {
    return null
  }
}

async function cacheDiscovery<T>(cacheKey: string, data: T): Promise<void> {
  try {
    await ensureDiscoveryCacheDir()
    const filePath = join(DISCOVERY_CACHE_DIR, `${cacheKey}.json`)
    await writeFile(filePath, JSON.stringify(data))
  } catch (error) {
    logger.error(`Failed to cache discovery data for ${cacheKey}:`, error)
  }
}

function generateDiscoveryCacheKey(baseUrl: string, apiKey: string, type: string): string {
  const hash = createHash('sha256')
  hash.update(`${baseUrl}|${apiKey}|${type}`)
  return hash.digest('hex')
}

async function fetchAvailableModels(
  baseUrl: string,
  apiKey: string,
  filterPattern: RegExp,
  defaultModels: string[],
): Promise<string[]> {
  const normalizedUrl = normalizeToBaseUrl(baseUrl)
  const endpointVariations = [
    `${normalizedUrl}/v1/models`,
    `${normalizedUrl}/models`,
  ]

  for (const modelEndpoint of endpointVariations) {
    try {
      const response = await fetch(modelEndpoint, {
        headers: {
          ...(apiKey && { 'Authorization': `Bearer ${apiKey}` }),
          'Content-Type': 'application/json',
        },
      })

      if (response.ok) {
        const data = await response.json() as { data?: { id?: string }[] } | unknown[]

        if ('data' in data && Array.isArray(data.data)) {
          const filtered = data.data
            .filter((model) => model.id && typeof model.id === 'string')
            .filter((model) => filterPattern.test(model.id!.toLowerCase()))
            .map((model) => model.id!)

          if (filtered.length > 0) {
            return filtered
          }
        } else if (Array.isArray(data)) {
          const filtered = data.filter((item): item is string =>
            typeof item === 'string' && filterPattern.test(item.toLowerCase())
          )
          if (filtered.length > 0) {
            return filtered
          }
        }
      }
    } catch (error) {
      logger.warn(`Failed to fetch models from ${modelEndpoint}:`, error)
      continue
    }
  }

  return defaultModels
}

export async function discoverCached<T>(opts: {
  baseUrl: string
  apiKey: string
  type: string
  forceRefresh: boolean
  fetcher: () => Promise<T>
}): Promise<{ value: T; cached: boolean }> {
  const cacheKey = generateDiscoveryCacheKey(opts.baseUrl, opts.apiKey, opts.type)

  if (!opts.forceRefresh) {
    const cached = await getCachedDiscovery<T>(cacheKey)
    if (cached) return { value: cached, cached: true }
  }

  await ensureDiscoveryCacheDir()
  logger.info(`Discovering ${opts.type} from ${opts.baseUrl}`)

  const value = await opts.fetcher()
  await cacheDiscovery(cacheKey, value)

  return { value, cached: false }
}

export async function discoverModelsCached(opts: {
  baseUrl: string
  apiKey: string
  type: string
  filterPattern: RegExp
  defaultModels: string[]
  forceRefresh: boolean
}): Promise<{ models: string[]; cached: boolean }> {
  const { value, cached } = await discoverCached({
    baseUrl: opts.baseUrl,
    apiKey: opts.apiKey,
    type: opts.type,
    forceRefresh: opts.forceRefresh,
    fetcher: () => fetchAvailableModels(opts.baseUrl, opts.apiKey, opts.filterPattern, opts.defaultModels),
  })
  return { models: value, cached }
}
