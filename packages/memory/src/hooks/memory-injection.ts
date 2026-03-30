import type { MemoryService } from '../services/memory'
import type { MemoryInjectionConfig, Logger, MemorySearchResult } from '../types'
import { InMemoryCacheService } from '../cache/memory-cache'
import { estimateTokens } from './compaction-utils'

async function sha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message)
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

interface MemoryInjectionDeps {
  projectId: string
  memoryService: MemoryService
  logger: Logger
  config?: MemoryInjectionConfig
}

export interface MemoryInjectionHook {
  handler: (userText: string) => Promise<string | null>
  clearCache: () => Promise<void>
  destroy: () => void
}

export function createMemoryInjectionHook(deps: MemoryInjectionDeps): MemoryInjectionHook {
  const { projectId, memoryService, logger, config } = deps

  const enabled = config?.enabled ?? true
  const debug = config?.debug ?? false
  const maxResults = config?.maxResults ?? 5
  const distanceThreshold = config?.distanceThreshold ?? 0.5
  const maxTokens = config?.maxTokens ?? 2000
  const cacheTtlMs = config?.cacheTtlMs ?? 30000

  const cache = new InMemoryCacheService()

  let initialized = false

  const handler = async (userText: string): Promise<string | null> => {
    if (!enabled) {
      return null
    }

    if (!initialized) {
      logger.log(`memory-injection: initialized (enabled=${enabled}, maxResults=${maxResults}, distanceThreshold=${distanceThreshold}, maxTokens=${maxTokens}, cacheTtlMs=${cacheTtlMs})`)
      initialized = true
    }

    if (debug) {
      logger.debug('memory-injection: hook invoked', { projectId, userTextLength: userText.length })
    }

    try {
      const hash = await sha256(userText)
      const cacheKey = `memory-injection:${hash}`

      const cached = await cache.get<string>(cacheKey)
      if (cached !== null) {
        if (debug) {
          logger.debug('memory-injection: cache hit', { projectId, hash })
        }
        return cached === '' ? null : cached
      }

      if (debug) {
        logger.debug('memory-injection: cache miss', { projectId, hash })
      }

      const searchResults = await memoryService.search(userText, projectId, { limit: maxResults })

      logger.log(`memory-injection: search returned ${searchResults.length} results for project ${projectId}`)

      if (debug && searchResults.length > 0) {
        const distances = searchResults.map((r: MemorySearchResult) => `#${r.memory.id}(${r.memory.scope}):${r.distance.toFixed(3)}`)
        logger.debug('memory-injection: result distances', { distances, distanceThreshold })
      }

      const filteredResults = searchResults.filter((result: MemorySearchResult) => result.distance <= distanceThreshold)

      if (searchResults.length > 0 && filteredResults.length === 0) {
        const closest = Math.min(...searchResults.map((r: MemorySearchResult) => r.distance))
        logger.log(`memory-injection: all ${searchResults.length} results filtered out (closest distance: ${closest.toFixed(3)}, threshold: ${distanceThreshold})`)
      }

      if (searchResults.length === 0) {
        logger.log('memory-injection: search returned 0 results (vec may be unavailable)')
      }

      if (filteredResults.length === 0) {
        await cache.set(cacheKey, '', cacheTtlMs / 1000)
        if (debug) {
          logger.debug('memory-injection: no matching memories found', { projectId })
        }
        return null
      }

      const sections: string[] = []
      sections.push('<project-memory>')

      for (const result of filteredResults) {
        const { memory } = result
        sections.push(`- #${memory.id} [${memory.scope}] ${memory.content}`)
      }

      sections.push('</project-memory>')

      let formatted = sections.join('\n')
      let tokens = estimateTokens(formatted)

      if (tokens > maxTokens) {
        const trimmedSections: string[] = []
        trimmedSections.push('<project-memory>')

        let currentTokens = estimateTokens('<project-memory>')
        for (const result of filteredResults) {
          const line = `- #${result.memory.id} [${result.memory.scope}] ${result.memory.content}`
          const lineTokens = estimateTokens(line)

          if (currentTokens + lineTokens > maxTokens - estimateTokens('</project-memory>')) {
            break
          }

          trimmedSections.push(line)
          currentTokens += lineTokens
        }

        trimmedSections.push('</project-memory>')
        formatted = trimmedSections.join('\n')
        tokens = estimateTokens(formatted)

        if (debug) {
          logger.debug('memory-injection: trimmed to token limit', { tokens })
        }
      }

      await cache.set(cacheKey, formatted, cacheTtlMs / 1000)

      logger.log(`memory-injection: injected ${filteredResults.length} relevant memories (${tokens} tokens) for query`)

      return formatted
    } catch (error) {
      logger.error('memory-injection: failed to inject memories', error)
      return null
    }
  }

  return {
    handler,
    clearCache: () => cache.invalidatePattern('memory-injection:'),
    destroy: () => cache.destroy(),
  }
}
