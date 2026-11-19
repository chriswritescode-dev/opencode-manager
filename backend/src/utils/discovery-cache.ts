import { createHash } from 'crypto'
import { readFile, writeFile, stat, unlink } from 'fs/promises'
import { join } from 'path'
import { z } from 'zod'
import type { ZodType } from 'zod'
import { logger } from './logger'
import { mkdirSafe } from './fs-safe'
import { getWorkspacePath } from '@opencode-manager/shared/config/env'

const discoveryCacheDir = (): string => join(getWorkspacePath(), 'cache', 'discovery')
const DISCOVERY_CACHE_TTL_MS = 60 * 60 * 1000

const ModelsResponseSchema = z.union([
  z.object({ data: z.array(z.object({ id: z.string().optional() })) }),
  z.array(z.string()),
])

export function normalizeToBaseUrl(endpoint: string): string {
  return endpoint
    .replace(/\/v1\/audio\/speech$/, '')
    .replace(/\/audio\/speech$/, '')
    .replace(/\/v1\/audio\/transcriptions$/, '')
    .replace(/\/audio\/transcriptions$/, '')
    .replace(/\/$/, '')
    .replace(/\/v1$/, '')
}

async function ensureDiscoveryCacheDir(): Promise<void> {
  await mkdirSafe(discoveryCacheDir())
}

async function getCachedDiscovery<T>(cacheKey: string, schema: ZodType<T>): Promise<T | null> {
  try {
    const filePath = join(discoveryCacheDir(), `${cacheKey}.json`)
    const fileStat = await stat(filePath)

    if (Date.now() - fileStat.mtimeMs > DISCOVERY_CACHE_TTL_MS) {
      await unlink(filePath)
      return null
    }

    const content = await readFile(filePath, 'utf-8')
    const parsed = schema.safeParse(JSON.parse(content))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

async function cacheDiscovery<T>(cacheKey: string, data: T): Promise<void> {
  try {
    await ensureDiscoveryCacheDir()
    const filePath = join(discoveryCacheDir(), `${cacheKey}.json`)
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
        const parsed = ModelsResponseSchema.safeParse(await response.json())

        if (parsed.success) {
          const candidates = Array.isArray(parsed.data)
            ? parsed.data
            : parsed.data.data.flatMap((model) => (model.id === undefined ? [] : [model.id]))
          const filtered = candidates.filter((id) => filterPattern.test(id.toLowerCase()))

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
  schema: ZodType<T>
  fetcher: () => Promise<T>
}): Promise<{ value: T; cached: boolean }> {
  const cacheKey = generateDiscoveryCacheKey(opts.baseUrl, opts.apiKey, opts.type)

  if (!opts.forceRefresh) {
    const cached = await getCachedDiscovery(cacheKey, opts.schema)
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
    schema: z.array(z.string()),
    fetcher: () => fetchAvailableModels(opts.baseUrl, opts.apiKey, opts.filterPattern, opts.defaultModels),
  })
  return { models: value, cached }
}
