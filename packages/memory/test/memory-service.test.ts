import { describe, test, expect, beforeEach, beforeAll } from 'bun:test'
import { Database } from 'bun:sqlite'
import { MemoryService } from '../src/services/memory'
import { createMemoryQuery } from '../src/storage/memory-queries'
import { initializeVecTables } from '../src/storage/vec'
import type { EmbeddingProvider } from '../src/embedding'
import type { CacheService } from '../src/cache/types'
import type { MemoryScope } from '../src/types'

const TEST_PROJECT_ID = 'test-project-id'
const TEST_PROJECT_ID_2 = 'test-project-id-2'

function createDeterministicEmbeddingProvider(dimensions = 1536): EmbeddingProvider {
  let callCount = 0
  return {
    dimensions,
    name: 'mock',
    embed: async (texts: string[]) => {
      return texts.map((text) => {
        const vector = new Array(dimensions).fill(0)
        vector[0] = callCount++
        if (text.toLowerCase().includes('react')) {
          vector[1] = 1
        }
        if (text.toLowerCase().includes('api') || text.toLowerCase().includes('json')) {
          vector[2] = 1
        }
        return vector
      })
    },
    test: async () => true,
  }
}

function createMockCache(): CacheService {
  const store = new Map<string, { value: unknown; expiry: number }>()

  return {
    async get<T>(key: string): Promise<T | null> {
      const entry = store.get(key)
      if (!entry) return null
      if (entry.expiry && entry.expiry < Date.now()) {
        store.delete(key)
        return null
      }
      return entry.value as T
    },
    async set<T>(key: string, value: T, ttlSeconds = 0): Promise<void> {
      const expiry = ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : 0
      store.set(key, { value, expiry })
    },
    async del(key: string): Promise<void> {
      store.delete(key)
    },
    async invalidatePattern(pattern: string): Promise<void> {
      const regex = new RegExp(pattern.replace('*', '.*'))
      for (const key of store.keys()) {
        if (regex.test(key)) {
          store.delete(key)
        }
      }
    },
  }
}

function createTestDb(): Database {
  const db = new Database(':memory:')

  db.run(`
    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      content TEXT NOT NULL,
      file_path TEXT,
      access_count INTEGER NOT NULL DEFAULT 0,
      last_accessed_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)

  db.run(`CREATE INDEX IF NOT EXISTS idx_memories_project_id ON memories(project_id)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope)`)

  return db
}

describe('MemoryService', () => {
  let db: Database
  let memoryService: MemoryService
  let mockEmbeddingProvider: EmbeddingProvider
  let mockCache: CacheService

  beforeAll(() => {
    mockEmbeddingProvider = createDeterministicEmbeddingProvider(1536)
    mockCache = createMockCache()
  })

  beforeEach(() => {
    db = createTestDb()
    initializeVecTables(db, 1536)

    const queries = createMemoryQuery(db)
    memoryService = new MemoryService({
      db,
      embeddingService: {
        embedText: async (text: string) => {
          const results = await mockEmbeddingProvider.embed([text])
          return results[0]
        },
        embedTexts: mockEmbeddingProvider.embed.bind(mockEmbeddingProvider),
      },
      cache: mockCache,
    })
  })

  test('create memory → verify it is stored and retrievable', async () => {
    const input = {
      projectId: TEST_PROJECT_ID,
      scope: 'decision' as MemoryScope,
      content: 'This is a test memory about a decision',
    }

    const result = await memoryService.create(input)
    expect(result.deduplicated).toBe(false)
    expect(result.id).toBeGreaterThan(0)

    const retrieved = memoryService.getById(result.id)
    expect(retrieved).toBeDefined()
    expect(retrieved?.content).toBe(input.content)
    expect(retrieved?.scope).toBe(input.scope)
  })

  test('update memory content → verify re-embedding', async () => {
    const input = {
      projectId: TEST_PROJECT_ID,
      scope: 'context' as MemoryScope,
      content: 'Original content',
    }

    const result = await memoryService.create(input)
    const newContent = 'Updated content for testing'
    await memoryService.update(result.id, { content: newContent })

    const updated = memoryService.getById(result.id)
    expect(updated?.content).toBe(newContent)
  })

  test('delete memory → verify removal', async () => {
    const input = {
      projectId: TEST_PROJECT_ID,
      scope: 'context' as MemoryScope,
      content: 'Memory to be deleted',
    }

    const result = await memoryService.create(input)
    expect(memoryService.getById(result.id)).toBeDefined()

    await memoryService.delete(result.id)
    expect(memoryService.getById(result.id)).toBeUndefined()
  })

  test('dedup detection — create duplicate content, verify it returns existing ID', async () => {
    const input = {
      projectId: TEST_PROJECT_ID,
      scope: 'convention' as MemoryScope,
      content: 'Exact duplicate test content',
    }

    const result1 = await memoryService.create(input)
    const result2 = await memoryService.create(input)

    expect(result1.id).toBe(result2.id)
    expect(result2.deduplicated).toBe(true)
  })

  test('semantic search — embed a query, find relevant memories', async () => {
    const input1 = {
      projectId: TEST_PROJECT_ID,
      scope: 'context' as MemoryScope,
      content: 'We use React for the frontend UI components',
    }

    const input2 = {
      projectId: TEST_PROJECT_ID,
      scope: 'convention' as MemoryScope,
      content: 'All API endpoints return JSON responses',
    }

    await memoryService.create(input1)
    await memoryService.create(input2)

    const results = await memoryService.search('React UI framework', TEST_PROJECT_ID)

    expect(results.length).toBeGreaterThan(0)
    expect(results[0]?.memory.scope).toBe('context')
  })

  test('stats — verify counts by scope', async () => {
    await memoryService.create({
      projectId: TEST_PROJECT_ID,
      scope: 'decision' as MemoryScope,
      content: 'Stats test 1',
    })

    await memoryService.create({
      projectId: TEST_PROJECT_ID,
      scope: 'convention' as MemoryScope,
      content: 'Stats test 2',
    })

    const stats = memoryService.getStats(TEST_PROJECT_ID)

    expect(stats.total).toBe(2)
    expect(stats.byScope.decision).toBe(1)
    expect(stats.byScope.convention).toBe(1)
  })

  test('project isolation — memories for projectId=1 do not appear in projectId=2 queries', async () => {
    await memoryService.create({
      projectId: TEST_PROJECT_ID,
      scope: 'decision' as MemoryScope,
      content: 'Memory for repo 1',
    })

    await memoryService.create({
      projectId: TEST_PROJECT_ID_2,
      scope: 'decision' as MemoryScope,
      content: 'Memory for repo 2',
    })

    const repo1Memories = memoryService.listByProject(TEST_PROJECT_ID)
    const repo2Memories = memoryService.listByProject(TEST_PROJECT_ID_2)

    expect(repo1Memories.length).toBe(1)
    expect(repo1Memories[0]?.content).toBe('Memory for repo 1')

    expect(repo2Memories.length).toBe(1)
    expect(repo2Memories[0]?.content).toBe('Memory for repo 2')
  })

  test('countByProject returns correct count', async () => {
    await memoryService.create({
      projectId: TEST_PROJECT_ID,
      scope: 'decision' as MemoryScope,
      content: 'Count test 1',
    })

    await memoryService.create({
      projectId: TEST_PROJECT_ID,
      scope: 'decision' as MemoryScope,
      content: 'Count test 2',
    })

    expect(memoryService.countByProject(TEST_PROJECT_ID)).toBe(2)
    expect(memoryService.countByProject(TEST_PROJECT_ID_2)).toBe(0)
  })

  test('deleteByProject removes all memories for a repo', async () => {
    await memoryService.create({
      projectId: TEST_PROJECT_ID,
      scope: 'decision' as MemoryScope,
      content: 'Delete by repo test',
    })

    expect(memoryService.countByProject(TEST_PROJECT_ID)).toBe(1)

    memoryService.deleteByProject(TEST_PROJECT_ID)

    expect(memoryService.countByProject(TEST_PROJECT_ID)).toBe(0)
  })

  test('setDedupThreshold clamps threshold to valid range', () => {
    memoryService.setDedupThreshold(0.02)
    expect(() => memoryService.setDedupThreshold(0.02)).not.toThrow()

    memoryService.setDedupThreshold(0.5)
    expect(() => memoryService.setDedupThreshold(0.5)).not.toThrow()

    memoryService.setDedupThreshold(0.6)
    expect(() => memoryService.setDedupThreshold(0.6)).not.toThrow()
  })

  test('listAll returns memories across repos when no repoId filter', async () => {
    await memoryService.create({
      projectId: TEST_PROJECT_ID,
      scope: 'decision' as MemoryScope,
      content: 'Repo 1 memory',
    })

    await memoryService.create({
      projectId: TEST_PROJECT_ID_2,
      scope: 'decision' as MemoryScope,
      content: 'Repo 2 memory',
    })

    const allMemories = memoryService.listAll()

    expect(allMemories.length).toBe(2)
  })

  test('listAll with repoId filter returns only memories for that repo', async () => {
    await memoryService.create({
      projectId: TEST_PROJECT_ID,
      scope: 'decision' as MemoryScope,
      content: 'Repo 1 memory',
    })

    await memoryService.create({
      projectId: TEST_PROJECT_ID_2,
      scope: 'decision' as MemoryScope,
      content: 'Repo 2 memory',
    })

    const repo1Memories = memoryService.listAll({ projectId: TEST_PROJECT_ID })

    expect(repo1Memories.length).toBe(1)
    expect(repo1Memories[0]?.content).toBe('Repo 1 memory')
  })

  test('reindex processes all memories and returns correct counts', async () => {
    for (let i = 0; i < 10; i++) {
      await memoryService.create({
        projectId: TEST_PROJECT_ID,
        scope: 'context' as MemoryScope,
        content: `Memory content ${i}`,
      })
    }

    const result = await memoryService.reindex()

    expect(result.total).toBe(10)
    expect(result.success).toBe(10)
    expect(result.failed).toBe(0)
  })

  test('reindex with projectId filters to that project only', async () => {
    await memoryService.create({
      projectId: TEST_PROJECT_ID,
      scope: 'context' as MemoryScope,
      content: 'Memory for project 1',
    })

    await memoryService.create({
      projectId: TEST_PROJECT_ID,
      scope: 'context' as MemoryScope,
      content: 'Memory 2 for project 1',
    })

    await memoryService.create({
      projectId: TEST_PROJECT_ID_2,
      scope: 'context' as MemoryScope,
      content: 'Memory for project 2',
    })

    const resultForProject1 = await memoryService.reindex(TEST_PROJECT_ID)
    expect(resultForProject1.total).toBe(2)
    expect(resultForProject1.success).toBe(2)

    const resultForProject2 = await memoryService.reindex(TEST_PROJECT_ID_2)
    expect(resultForProject2.total).toBe(1)
    expect(resultForProject2.success).toBe(1)
  })

  test('reindex handles cases where vec service is unavailable', async () => {
    for (let i = 0; i < 3; i++) {
      await memoryService.create({
        projectId: TEST_PROJECT_ID,
        scope: 'context' as MemoryScope,
        content: `Memory ${i}`,
      })
    }

    const result = await memoryService.reindex()

    expect(result.total).toBe(3)
    expect(result.success).toBe(3)
    expect(result.failed).toBe(0)
  })

  test('reindex uses batched embedTexts instead of individual embedText calls', async () => {
    let embedTextsCallCount = 0
    let embedTextsCalls: string[][] = []

    const trackingProvider = createDeterministicEmbeddingProvider(1536)
    const originalEmbed = trackingProvider.embed.bind(trackingProvider)
    trackingProvider.embed = async (texts: string[]) => {
      embedTextsCallCount++
      embedTextsCalls.push([...texts])
      return originalEmbed(texts)
    }

    const db2 = createTestDb()
    initializeVecTables(db2, 1536)

    const trackingService = new MemoryService({
      db: db2,
      embeddingService: {
        embedText: async (text: string) => {
          const results = await trackingProvider.embed([text])
          return results[0]
        },
        embedTexts: trackingProvider.embed.bind(trackingProvider),
      },
      cache: mockCache,
    })

    for (let i = 0; i < 55; i++) {
      await trackingService.create({
        projectId: TEST_PROJECT_ID,
        scope: 'context' as MemoryScope,
        content: `Memory ${i}`,
      })
    }

    embedTextsCallCount = 0
    embedTextsCalls = []

    await trackingService.reindex()

    expect(embedTextsCallCount).toBeGreaterThan(1)
    expect(embedTextsCalls.length).toBeGreaterThan(1)
    expect(embedTextsCalls[0]!.length).toBeLessThanOrEqual(50)
  })
})
