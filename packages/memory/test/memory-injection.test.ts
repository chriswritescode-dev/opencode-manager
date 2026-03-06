import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { createMemoryInjectionHook } from '../src/hooks/memory-injection'
import type { MemoryService } from '../src/services/memory'
import type { Logger, Memory, MemoryInjectionConfig, MemorySearchResult } from '../src/types'

const TEST_PROJECT_ID = 'test-project-id'

const mockLogger: Logger = {
  log: (message: string) => {},
  error: (message: string) => {},
}

function createCapturingLogger(): Logger & { logs: string[]; errors: string[] } {
  const logs: string[] = []
  const errors: string[] = []
  return {
    log: (message: string) => { logs.push(message) },
    error: (message: string) => { errors.push(message) },
    debug: (message: string) => {},
    logs,
    errors,
  }
}

function createMockMemoryService(searchResults: MemorySearchResult[]): MemoryService {
  return {
    search: async (query: string, projectId?: string, filters?: { scope?: string; limit?: number }) => {
      return searchResults.slice(0, filters?.limit ?? searchResults.length)
    },
    listByProject: () => [],
    getById: (id: number) => undefined,
    create: async () => ({ id: 1, deduplicated: false }),
    update: async () => {},
    delete: async () => {},
    listAll: () => [],
    getStats: () => ({ projectId: TEST_PROJECT_ID, total: 0, byScope: {} as Record<string, number> }),
    countByProject: () => 0,
    deleteByProject: () => {},
    deleteByFilePath: () => {},
    setDedupThreshold: () => {},
    destroy: () => {},
  } as unknown as MemoryService
}

const mockConvention: Memory = {
  id: 1,
  projectId: TEST_PROJECT_ID,
  scope: 'convention',
  content: 'Use 2 spaces for indentation',
  filePath: null,
  accessCount: 3,
  lastAccessedAt: Date.now(),
  createdAt: Date.now(),
  updatedAt: Date.now(),
}

const mockDecision: Memory = {
  id: 2,
  projectId: TEST_PROJECT_ID,
  scope: 'decision',
  content: 'Use SQLite for local storage',
  filePath: null,
  accessCount: 10,
  lastAccessedAt: Date.now(),
  createdAt: Date.now(),
  updatedAt: Date.now(),
}

const mockContext: Memory = {
  id: 3,
  projectId: TEST_PROJECT_ID,
  scope: 'context',
  content: 'Project uses Bun runtime',
  filePath: null,
  accessCount: 5,
  lastAccessedAt: Date.now(),
  createdAt: Date.now(),
  updatedAt: Date.now(),
}

describe('MemoryInjectionHook', () => {
  test('Injects relevant memories when search returns results below threshold', async () => {
    const searchResults: MemorySearchResult[] = [
      { memory: mockConvention, distance: 0.2 },
      { memory: mockDecision, distance: 0.3 },
    ]
    const memoryService = createMockMemoryService(searchResults)
    const config: MemoryInjectionConfig = {
      enabled: true,
      maxResults: 5,
      distanceThreshold: 0.5,
    }

    const hook = createMemoryInjectionHook({
      projectId: TEST_PROJECT_ID,
      memoryService,
      logger: mockLogger,
      config,
    })

    const result = await hook.handler('How should I format my code?')

    expect(result).not.toBeNull()
    expect(result).toContain('<project-memory>')
    expect(result).toContain('[convention]')
    expect(result).toContain('[decision]')
    expect(result).toContain('Use 2 spaces for indentation')
    expect(result).toContain('Use SQLite for local storage')
    expect(result).toContain('</project-memory>')
  })

  test('Returns null when no memories match (all above threshold)', async () => {
    const searchResults: MemorySearchResult[] = [
      { memory: mockConvention, distance: 0.8 },
      { memory: mockDecision, distance: 0.9 },
    ]
    const memoryService = createMockMemoryService(searchResults)
    const config: MemoryInjectionConfig = {
      enabled: true,
      distanceThreshold: 0.5,
    }

    const hook = createMemoryInjectionHook({
      projectId: TEST_PROJECT_ID,
      memoryService,
      logger: mockLogger,
      config,
    })

    const result = await hook.handler('Random unrelated query')

    expect(result).toBeNull()
  })

  test('Returns null when search returns empty', async () => {
    const memoryService = createMockMemoryService([])
    const hook = createMemoryInjectionHook({
      projectId: TEST_PROJECT_ID,
      memoryService,
      logger: mockLogger,
    })

    const result = await hook.handler('Some query')

    expect(result).toBeNull()
  })

  test('Respects enabled: false', async () => {
    const searchResults: MemorySearchResult[] = [
      { memory: mockConvention, distance: 0.2 },
    ]
    const memoryService = createMockMemoryService(searchResults)
    const config: MemoryInjectionConfig = {
      enabled: false,
    }

    const hook = createMemoryInjectionHook({
      projectId: TEST_PROJECT_ID,
      memoryService,
      logger: mockLogger,
      config,
    })

    const result = await hook.handler('Some query')

    expect(result).toBeNull()
  })

  test('Respects token budget — drops low-relevance items', async () => {
    const longContent = 'This is a very long convention content that takes up many tokens. '.repeat(20)
    const memories: Memory[] = []
    for (let i = 0; i < 5; i++) {
      memories.push({
        id: i,
        projectId: TEST_PROJECT_ID,
        scope: 'convention',
        content: longContent,
        filePath: null,
        accessCount: 1,
        lastAccessedAt: Date.now(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    }

    const searchResults: MemorySearchResult[] = memories.map((m, i) => ({
      memory: m,
      distance: 0.1 + i * 0.05,
    }))

    const memoryService = createMockMemoryService(searchResults)
    const config: MemoryInjectionConfig = {
      enabled: true,
      maxTokens: 50,
    }

    const hook = createMemoryInjectionHook({
      projectId: TEST_PROJECT_ID,
      memoryService,
      logger: mockLogger,
      config,
    })

    const result = await hook.handler('convention query')

    expect(result).not.toBeNull()
    const resultText = result as string
    const bulletCount = (resultText.match(/- \[convention\]/g) || []).length
    expect(bulletCount).toBeLessThan(5)
  })

  test('Caches by user text — second call doesn\'t re-search', async () => {
    let searchCallCount = 0
    const memoryService = {
      search: async (query: string, projectId?: string, filters?: { scope?: string; limit?: number }) => {
        searchCallCount++
        return [
          { memory: mockConvention, distance: 0.2 },
        ]
      },
    } as unknown as MemoryService

    const hook = createMemoryInjectionHook({
      projectId: TEST_PROJECT_ID,
      memoryService,
      logger: mockLogger,
    })

    const userText = 'How should I format code?'
    await hook.handler(userText)
    await hook.handler(userText)

    expect(searchCallCount).toBe(1)
  })

  test('Handles search errors gracefully', async () => {
    const memoryService = {
      search: async () => {
        throw new Error('Database error')
      },
    } as unknown as MemoryService

    const hook = createMemoryInjectionHook({
      projectId: TEST_PROJECT_ID,
      memoryService,
      logger: mockLogger,
    })

    const result = await hook.handler('Some query')

    expect(result).toBeNull()
  })

  test('Different cache keys for different user text', async () => {
    let searchCallCount = 0
    const memoryService = {
      search: async (query: string) => {
        searchCallCount++
        return [
          { memory: mockConvention, distance: 0.2 },
        ]
      },
    } as unknown as MemoryService

    const hook = createMemoryInjectionHook({
      projectId: TEST_PROJECT_ID,
      memoryService,
      logger: mockLogger,
    })

    await hook.handler('text A')
    await hook.handler('text B')

    expect(searchCallCount).toBe(2)
  })

  test('Includes context scope in output', async () => {
    const searchResults: MemorySearchResult[] = [
      { memory: mockContext, distance: 0.2 },
    ]
    const memoryService = createMockMemoryService(searchResults)

    const hook = createMemoryInjectionHook({
      projectId: TEST_PROJECT_ID,
      memoryService,
      logger: mockLogger,
    })

    const result = await hook.handler('What runtime does this project use?')

    expect(result).not.toBeNull()
    expect(result).toContain('[context]')
    expect(result).toContain('Project uses Bun runtime')
  })

  test('Logs closest distance when all results filtered by threshold', async () => {
    const searchResults: MemorySearchResult[] = [
      { memory: mockConvention, distance: 0.7 },
      { memory: mockDecision, distance: 0.8 },
    ]
    const memoryService = createMockMemoryService(searchResults)
    const capturingLogger = createCapturingLogger()
    const config: MemoryInjectionConfig = {
      enabled: true,
      distanceThreshold: 0.5,
    }

    const hook = createMemoryInjectionHook({
      projectId: TEST_PROJECT_ID,
      memoryService,
      logger: capturingLogger,
      config,
    })

    await hook.handler('Some query about code')

    const filterLog = capturingLogger.logs.find(l => l.includes('filtered out'))
    expect(filterLog).toBeDefined()
    expect(filterLog).toContain('closest distance: 0.700')
    expect(filterLog).toContain('threshold: 0.5')
  })

  test('Logs search result count', async () => {
    const searchResults: MemorySearchResult[] = [
      { memory: mockConvention, distance: 0.2 },
    ]
    const memoryService = createMockMemoryService(searchResults)
    const capturingLogger = createCapturingLogger()

    const hook = createMemoryInjectionHook({
      projectId: TEST_PROJECT_ID,
      memoryService,
      logger: capturingLogger,
    })

    await hook.handler('How should I format code?')

    const searchLog = capturingLogger.logs.find(l => l.includes('search returned'))
    expect(searchLog).toBeDefined()
    expect(searchLog).toContain('1 results')
  })

  test('Logs config on first invocation', async () => {
    const memoryService = createMockMemoryService([])
    const capturingLogger = createCapturingLogger()

    const hook = createMemoryInjectionHook({
      projectId: TEST_PROJECT_ID,
      memoryService,
      logger: capturingLogger,
    })

    await hook.handler('First call')
    await hook.handler('Second call different text')

    const initLogs = capturingLogger.logs.filter(l => l.includes('initialized'))
    expect(initLogs.length).toBe(1)
  })
})
