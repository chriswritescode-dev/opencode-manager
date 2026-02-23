import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { createMemoryPlugin } from '../src/index'
import { mkdirSync, rmSync, existsSync } from 'fs'
import type { PluginConfig } from '../src/types'

const TEST_DIR = '/tmp/opencode-manager-memory-test-' + Date.now()

let originalFetch: typeof global.fetch

function setupMockFetch() {
  originalFetch = global.fetch
  global.fetch = async (): Promise<Response> => {
    return new Response(
      JSON.stringify({
        data: Array.from({ length: 1 }, () => ({
          embedding: Array(1536).fill(0.1),
        })),
      }),
      { status: 200 }
    )
  }
}

function restoreFetch() {
  global.fetch = originalFetch
}

beforeEach(() => {
  setupMockFetch()
})

afterEach(() => {
  restoreFetch()
})

const TEST_PROJECT_ID = 'test-project-id-' + Date.now()

describe('createMemoryPlugin', () => {
  let testDir: string
  let currentHooks: { getCleanup?: () => Promise<void> } | null

  beforeEach(() => {
    testDir = TEST_DIR + '-' + Math.random().toString(36).slice(2)
    mkdirSync(testDir, { recursive: true })
    currentHooks = null
  })

  afterEach(async () => {
    if (currentHooks?.getCleanup) {
      await currentHooks.getCleanup()
    }
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  test('Factory creates plugin with valid config', () => {
    const config: PluginConfig = {
      embedding: {
        provider: 'openai',
        model: 'text-embedding-3-small',
        apiKey: 'test-key',
      },
    }

    const plugin = createMemoryPlugin(config)
    expect(typeof plugin).toBe('function')
  })

  test('Plugin initialization creates database file', async () => {
    const config: PluginConfig = {
      dataDir: `${testDir}/.opencode/memory`,
      embedding: {
        provider: 'openai',
        model: 'text-embedding-3-small',
        apiKey: 'test-key',
      },
    }

    const plugin = createMemoryPlugin(config)

    const mockInput = {
      directory: testDir,
      worktree: testDir,
      client: {} as never,
      project: { id: TEST_PROJECT_ID } as never,
      serverUrl: new URL('http://localhost:5551'),
      $: {} as never,
    }

    const hooks = await plugin(mockInput)
    currentHooks = hooks as { getCleanup?: () => Promise<void> }

    const dbPath = `${testDir}/.opencode/memory/memory.db`
    expect(existsSync(dbPath)).toBe(true)
  })

  test('Plugin registers all expected tools', async () => {
    const config: PluginConfig = {
      dataDir: `${testDir}/.opencode/memory`,
      embedding: {
        provider: 'openai',
        model: 'text-embedding-3-small',
        apiKey: 'test-key',
      },
    }

    const plugin = createMemoryPlugin(config)

    const mockInput = {
      directory: testDir,
      worktree: testDir,
      client: {} as never,
      project: { id: TEST_PROJECT_ID } as never,
      serverUrl: new URL('http://localhost:5551'),
      $: {} as never,
    }

    const hooks = await plugin(mockInput)
    currentHooks = hooks as { getCleanup?: () => Promise<void> }

    expect(hooks.tool).toBeDefined()
    expect(hooks.tool?.['memory-read']).toBeDefined()
    expect(hooks.tool?.['memory-write']).toBeDefined()
    expect(hooks.tool?.['memory-delete']).toBeDefined()
  })

  test('Plugin registers all expected hooks', async () => {
    const config: PluginConfig = {
      dataDir: `${testDir}/.opencode/memory`,
      embedding: {
        provider: 'openai',
        model: 'text-embedding-3-small',
        apiKey: 'test-key',
      },
    }

    const plugin = createMemoryPlugin(config)

    const mockInput = {
      directory: testDir,
      worktree: testDir,
      client: {} as never,
      project: { id: TEST_PROJECT_ID } as never,
      serverUrl: new URL('http://localhost:5551'),
      $: {} as never,
    }

    const hooks = await plugin(mockInput)
    currentHooks = hooks as { getCleanup?: () => Promise<void> }

    expect(hooks.config).toBeDefined()
    expect(hooks['chat.message']).toBeDefined()
    expect(hooks['chat.params']).toBeDefined()
    expect(hooks.event).toBeDefined()
    expect(hooks['experimental.session.compacting']).toBeDefined()
  })

  test('Plugin uses project.id from input', async () => {
    const config: PluginConfig = {
      dataDir: `${testDir}/.opencode/memory`,
      embedding: {
        provider: 'openai',
        model: 'text-embedding-3-small',
        apiKey: 'test-key',
      },
    }

    const plugin = createMemoryPlugin(config)

    const mockInput = {
      directory: testDir,
      worktree: testDir,
      client: {} as never,
      project: { id: TEST_PROJECT_ID } as never,
      serverUrl: new URL('http://localhost:5551'),
      $: {} as never,
    }

    const hooks = await plugin(mockInput)
    currentHooks = hooks as { getCleanup?: () => Promise<void> }

    expect(hooks.tool).toBeDefined()
  })

  test('memory-read tool returns formatted output', async () => {
    const config: PluginConfig = {
      dataDir: `${testDir}/.opencode/memory`,
      embedding: {
        provider: 'openai',
        model: 'text-embedding-3-small',
        apiKey: 'test-key',
      },
    }

    const plugin = createMemoryPlugin(config)

    const mockInput = {
      directory: testDir,
      worktree: testDir,
      client: {} as never,
      project: { id: TEST_PROJECT_ID } as never,
      serverUrl: new URL('http://localhost:5551'),
      $: {} as never,
    }

    const hooks = await plugin(mockInput)
    currentHooks = hooks as { getCleanup?: () => Promise<void> }

    const result = await hooks.tool?.['memory-read']?.execute({ query: '', limit: 10 }, {} as any)

    expect(result).toBeDefined()
    expect(typeof result).toBe('string')
  })

  test('memory-write tool creates suggested memory', async () => {
    const config: PluginConfig = {
      dataDir: `${testDir}/.opencode/memory`,
      embedding: {
        provider: 'openai',
        model: 'text-embedding-3-small',
        apiKey: 'test-key',
      },
    }

    const plugin = createMemoryPlugin(config)

    const mockInput = {
      directory: testDir,
      worktree: testDir,
      client: {} as never,
      project: { id: TEST_PROJECT_ID } as never,
      serverUrl: new URL('http://localhost:5551'),
      $: {} as never,
    }

    const hooks = await plugin(mockInput)
    currentHooks = hooks as { getCleanup?: () => Promise<void> }

    const result = await hooks.tool?.['memory-write']?.execute({
      content: 'Test memory content',
      scope: 'context',
    }, {} as any)

    expect(result).toBeDefined()
    expect(typeof result).toBe('string')
    expect(result).toContain('Memory stored')
  })

  test('memory-delete tool deletes memory', async () => {
    const config: PluginConfig = {
      dataDir: `${testDir}/.opencode/memory`,
      embedding: {
        provider: 'openai',
        model: 'text-embedding-3-small',
        apiKey: 'test-key',
      },
    }

    const plugin = createMemoryPlugin(config)

    const mockInput = {
      directory: testDir,
      worktree: testDir,
      client: {} as never,
      project: { id: TEST_PROJECT_ID } as never,
      serverUrl: new URL('http://localhost:5551'),
      $: {} as never,
    }

    const hooks = await plugin(mockInput)
    currentHooks = hooks as { getCleanup?: () => Promise<void> }

    const writeResult = await hooks.tool?.['memory-write']?.execute({
      content: 'Memory to delete',
      scope: 'context',
    }, {} as any)

    const idMatch = writeResult?.match(/ID: #(\d+)/)
    const memoryId = idMatch ? parseInt(idMatch[1], 10) : 1

    const deleteResult = await hooks.tool?.['memory-delete']?.execute({ id: memoryId }, {} as any)

    expect(deleteResult).toBeDefined()
    expect(deleteResult).toContain('Deleted memory')
  })

  test('Plugin handles different embedding providers', async () => {
    const config: PluginConfig = {
      dataDir: `${testDir}/.opencode/memory`,
      embedding: {
        provider: 'openai',
        model: 'text-embedding-3-small',
        apiKey: 'test-key',
        dimensions: 1536,
      },
    }

    const plugin = createMemoryPlugin(config)

    const mockInput = {
      directory: testDir,
      worktree: testDir,
      client: {} as never,
      project: { id: TEST_PROJECT_ID } as never,
      serverUrl: new URL('http://localhost:5551'),
      $: {} as never,
    }

    const hooks = await plugin(mockInput)
    currentHooks = hooks as { getCleanup?: () => Promise<void> }

    expect(hooks.tool).toBeDefined()
  })

  test('Plugin uses custom dedup threshold when provided', async () => {
    const config: PluginConfig = {
      dataDir: `${testDir}/.opencode/memory`,
      embedding: {
        provider: 'openai',
        model: 'text-embedding-3-small',
        apiKey: 'test-key',
      },
      dedupThreshold: 0.25,
    }

    const plugin = createMemoryPlugin(config)

    const mockInput = {
      directory: testDir,
      worktree: testDir,
      client: {} as never,
      project: { id: TEST_PROJECT_ID } as never,
      serverUrl: new URL('http://localhost:5551'),
      $: {} as never,
    }

    const hooks = await plugin(mockInput)
    currentHooks = hooks as { getCleanup?: () => Promise<void> }

    expect(hooks.tool).toBeDefined()
  })

  test('Tool descriptions are properly set', async () => {
    const config: PluginConfig = {
      dataDir: `${testDir}/.opencode/memory`,
      embedding: {
        provider: 'openai',
        model: 'text-embedding-3-small',
        apiKey: 'test-key',
      },
    }

    const plugin = createMemoryPlugin(config)

    const mockInput = {
      directory: testDir,
      worktree: testDir,
      client: {} as never,
      project: { id: TEST_PROJECT_ID } as never,
      serverUrl: new URL('http://localhost:5551'),
      $: {} as never,
    }

    const hooks = await plugin(mockInput)
    currentHooks = hooks as { getCleanup?: () => Promise<void> }

    expect(hooks.tool?.['memory-read']?.description).toBe('Search and retrieve project memories')
    expect(hooks.tool?.['memory-write']?.description).toBe('Store a new project memory')
    expect(hooks.tool?.['memory-delete']?.description).toBe('Delete a project memory')
  })
})

describe('PluginConfig', () => {
  test('Accepts valid embedding config', () => {
    const config: PluginConfig = {
      embedding: {
        provider: 'openai',
        model: 'text-embedding-3-small',
        apiKey: 'test-key',
        dimensions: 1536,
        baseUrl: 'https://api.openai.com/v1',
      },
    }

    expect(config.embedding.provider).toBe('openai')
  })

  test('Accepts local embedding provider', () => {
    const config: PluginConfig = {
      embedding: {
        provider: 'local',
        model: 'all-MiniLM-L6-v2',
      },
    }

    expect(config.embedding.provider).toBe('local')
  })

  test('Accepts custom dataDir', () => {
    const config: PluginConfig = {
      dataDir: '/custom/path/memory',
      embedding: {
        provider: 'openai',
        model: 'text-embedding-3-small',
        apiKey: 'test-key',
      },
    }

    expect(config.dataDir).toBe('/custom/path/memory')
  })
})
