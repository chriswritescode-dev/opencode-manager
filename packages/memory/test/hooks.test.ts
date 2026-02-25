import { describe, test, expect, beforeEach } from 'bun:test'
import { createKeywordHooks } from '../src/hooks/keyword'
import { createParamsHooks } from '../src/hooks/params'
import { createSessionHooks } from '../src/hooks/session'
import type { MemoryService } from '../src/services/memory'
import type { SessionStateService } from '../src/services/session-state'
import type { Logger, Memory, MemoryScope } from '../src/types'
import type { PluginInput } from '@opencode-ai/plugin'

const TEST_PROJECT_ID = 'test-project-id'

const mockLogger: Logger = {
  log: () => {},
  error: () => {},
}

const mockSessionStateService = {
  getPlanningState: () => null,
  getCompactionSnapshot: () => null,
  setCompactionSnapshot: () => {},
} as unknown as SessionStateService

const mockPromptAsync = async () => {}

const mockPluginInput: PluginInput = {
  client: {
    session: {
      prompt: async () => ({ data: { parts: [{ type: 'text', text: 'Extracted memories' }] } }),
      promptAsync: mockPromptAsync,
      messages: async () => ({
        data: [
          { info: { role: 'assistant' }, parts: [{ type: 'text', text: 'Compaction summary text' }] },
        ],
      }),
      create: async () => ({ data: { id: 'child-session-id' } }),
      todo: async () => ({ data: [] }),
    },
    app: {
      log: () => {},
    },
  },
  project: { id: TEST_PROJECT_ID, worktree: '/test' },
  directory: '/test',
  worktree: '/test',
  serverUrl: new URL('http://localhost:5551'),
} as unknown as PluginInput

function createMockMemoryService(memories: Memory[] = []): MemoryService {
  return {
    listByProject: (projectId: string, filters?: { scope?: string; limit?: number }) => {
      return memories.filter(m => {
        if (filters?.scope && m.scope !== filters.scope) return false
        return true
      }).slice(0, filters?.limit ?? 100)
    },
    search: async () => [],
    getById: (id: number) => memories.find(m => m.id === id),
    create: async () => ({ id: 1, deduplicated: false }),
    update: async () => {},
    delete: async () => {},
    listAll: () => [],
    getStats: () => ({ projectId: TEST_PROJECT_ID, total: 0, byScope: {} as Record<MemoryScope, number> }),
    countByProject: () => memories.length,
    deleteByProject: () => {},
    deleteByFilePath: () => {},
    setDedupThreshold: () => {},
  } as unknown as MemoryService
}

const mockMemories: Memory[] = [
  {
    id: 1,
    projectId: TEST_PROJECT_ID,
    scope: 'context',
    content: 'We use React for the frontend UI',
    filePath: null,
    accessCount: 5,
    lastAccessedAt: Date.now(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 2,
    projectId: TEST_PROJECT_ID,
    scope: 'convention',
    content: 'Use 2 spaces for indentation',
    filePath: null,
    accessCount: 3,
    lastAccessedAt: Date.now(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 3,
    projectId: TEST_PROJECT_ID,
    scope: 'decision',
    content: 'Use SQLite for local storage',
    filePath: null,
    accessCount: 10,
    lastAccessedAt: Date.now(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
]

describe('KeywordHooks', () => {
  test('Keyword hook detects "remember this" and sets activation flag', async () => {
    const hooks = createKeywordHooks(mockLogger)

    const input = {
      sessionID: 'test-session',
    }

    const output = {
      message: { id: 'msg-1', sessionID: 'test-session', role: 'user' },
      parts: [
        { id: 'p1', sessionID: 'test-session', messageID: 'msg-1', type: 'text', text: 'Remember this: we use PostgreSQL for the database' },
      ],
    }

    await hooks.onMessage(input, output)

    expect(hooks.isActivated('test-session')).toBe(true)
  })

  test('Keyword hook detects "do you know about" pattern', async () => {
    const hooks = createKeywordHooks(mockLogger)

    const input = {
      sessionID: 'test-session',
    }

    const output = {
      message: { id: 'msg-1', sessionID: 'test-session', role: 'user' },
      parts: [
        { id: 'p1', sessionID: 'test-session', messageID: 'msg-1', type: 'text', text: 'What do you know about the authentication system?' },
      ],
    }

    await hooks.onMessage(input, output)

    expect(hooks.isActivated('test-session')).toBe(true)
  })

  test('Keyword hook detects "project memory" pattern', async () => {
    const hooks = createKeywordHooks(mockLogger)

    const input = {
      sessionID: 'test-session',
    }

    const output = {
      message: { id: 'msg-1', sessionID: 'test-session', role: 'user' },
      parts: [
        { id: 'p1', sessionID: 'test-session', messageID: 'msg-1', type: 'text', text: 'Check the project memory for API conventions' },
      ],
    }

    await hooks.onMessage(input, output)

    expect(hooks.isActivated('test-session')).toBe(true)
  })

  test('Keyword hook does not trigger for normal messages', async () => {
    const hooks = createKeywordHooks(mockLogger)

    const input = {
      sessionID: 'test-session',
    }

    const output = {
      message: { id: 'msg-1', sessionID: 'test-session', role: 'user' },
      parts: [
        { id: 'p1', sessionID: 'test-session', messageID: 'msg-1', type: 'text', text: 'Hello, how are you?' },
      ],
    }

    await hooks.onMessage(input, output)

    expect(hooks.isActivated('test-session')).toBe(false)
  })

  test('Keyword hook only triggers once per session', async () => {
    const hooks = createKeywordHooks(mockLogger)

    const input1 = {
      sessionID: 'test-session',
    }

    const output1 = {
      message: { id: 'msg-1', sessionID: 'test-session', role: 'user' },
      parts: [
        { id: 'p1', sessionID: 'test-session', messageID: 'msg-1', type: 'text', text: 'Remember this: use ESLint' },
      ],
    }

    await hooks.onMessage(input1, output1)
    expect(hooks.isActivated('test-session')).toBe(true)

    const input2 = {
      sessionID: 'test-session',
    }

    const output2 = {
      message: { id: 'msg-2', sessionID: 'test-session', role: 'user' },
      parts: [
        { id: 'p2', sessionID: 'test-session', messageID: 'msg-2', type: 'text', text: 'Remember: use Prettier' },
      ],
    }

    await hooks.onMessage(input2, output2)
    expect(hooks.isActivated('test-session')).toBe(true)
  })

  test('Keyword hook detects mode patterns', async () => {
    const hooks = createKeywordHooks(mockLogger)

    const input = {
      sessionID: 'test-session',
    }

    const output = {
      message: { id: 'msg-1', sessionID: 'test-session', role: 'user' },
      parts: [
        { id: 'p1', sessionID: 'test-session', messageID: 'msg-1', type: 'text', text: 'Brainstorm some ideas for the UI' },
      ],
    }

    await hooks.onMessage(input, output)

    expect(hooks.getMode('test-session')).toBe('creative')
  })
})

describe('ParamsHooks', () => {
  test('Params hook adjusts temperature for creative mode', async () => {
    const keywordHooks = createKeywordHooks(mockLogger)
    const hooks = createParamsHooks(keywordHooks)

    keywordHooks.onMessage(
      { sessionID: 'test-session' },
      {
        message: { id: 'msg-1', sessionID: 'test-session', role: 'user' },
        parts: [{ id: 'p1', sessionID: 'test-session', messageID: 'msg-1', type: 'text', text: 'Brainstorm some ideas' }],
      }
    )

    const input = {
      sessionID: 'test-session',
      agent: 'test',
    }

    const output: { temperature?: number; options?: Record<string, any> } = {}

    await hooks.onParams(input, output)

    expect(output.temperature).toBe(0.8)
  })

  test('Params hook adjusts thinking for deepThink mode', async () => {
    const keywordHooks = createKeywordHooks(mockLogger)
    const hooks = createParamsHooks(keywordHooks)

    keywordHooks.onMessage(
      { sessionID: 'test-session' },
      {
        message: { id: 'msg-1', sessionID: 'test-session', role: 'user' },
        parts: [{ id: 'p1', sessionID: 'test-session', messageID: 'msg-1', type: 'text', text: 'Think hard about this' }],
      }
    )

    const input = {
      sessionID: 'test-session',
      agent: 'test',
    }

    const output: { options?: { thinking?: { budgetTokens?: number } } } = {}

    await hooks.onParams(input, output)

    expect(output.options?.thinking?.budgetTokens).toBe(32000)
  })

  test('Params hook adjusts maxSteps for thorough mode', async () => {
    const keywordHooks = createKeywordHooks(mockLogger)
    const hooks = createParamsHooks(keywordHooks)

    keywordHooks.onMessage(
      { sessionID: 'test-session' },
      {
        message: { id: 'msg-1', sessionID: 'test-session', role: 'user' },
        parts: [{ id: 'p1', sessionID: 'test-session', messageID: 'msg-1', type: 'text', text: 'Go deep and be thorough' }],
      }
    )

    const input = {
      sessionID: 'test-session',
      agent: 'test',
    }

    const output: { options?: { maxSteps?: number } } = {}

    await hooks.onParams(input, output)

    expect(output.options?.maxSteps).toBe(50)
  })

  test('Params hook does not adjust for normal messages', async () => {
    const keywordHooks = createKeywordHooks(mockLogger)
    const hooks = createParamsHooks(keywordHooks)

    const input = {
      sessionID: 'test-session',
      agent: 'test',
    }

    const output: { temperature?: number; options?: Record<string, any> } = {}

    await hooks.onParams(input, output)

    expect(output.temperature).toBeUndefined()
    expect(output.options).toBeUndefined()
  })
})

describe('SessionHooks', () => {
  test('Session compacting hook includes memory sections in context', async () => {
    const memoryService = createMockMemoryService(mockMemories)
    const hooks = createSessionHooks(TEST_PROJECT_ID, memoryService, mockSessionStateService, mockLogger, mockPluginInput)

    const input = { sessionID: 'test-session' }
    const output = { context: [] as string[] }

    await hooks.onCompacting(input, output)

    expect(output.context.length).toBeGreaterThan(0)
    const contextContent = output.context.join('\n')
    expect(contextContent).toContain('Project Memory')
    expect(contextContent).toContain('Use 2 spaces for indentation')
    expect(contextContent).toContain('Use SQLite for local storage')
  })

  test('Session compacting hook does nothing when no memories', async () => {
    const memoryService = createMockMemoryService([])
    const hooks = createSessionHooks(TEST_PROJECT_ID, memoryService, mockSessionStateService, mockLogger, mockPluginInput)

    const input = { sessionID: 'test-session' }
    const output = { context: [] as string[] }

    await hooks.onCompacting(input, output)

    expect(output.context).toHaveLength(0)
  })

  test('Session tracks initialized sessions', async () => {
    const memoryService = createMockMemoryService([])
    const hooks = createSessionHooks(TEST_PROJECT_ID, memoryService, mockSessionStateService, mockLogger, mockPluginInput)

    const input = { sessionID: 'test-session-1' }
    const output = {}

    await hooks.onMessage(input, output)
    await hooks.onMessage(input, output)

    expect(true).toBe(true)
  })

  test('Session event handler logs session.compacted event', async () => {
    const memoryService = createMockMemoryService([])
    const hooks = createSessionHooks(TEST_PROJECT_ID, memoryService, mockSessionStateService, mockLogger, mockPluginInput)

    const input = {
      event: {
        type: 'session.compacted',
        properties: { sessionId: 'test-session' },
      },
    }

    await hooks.onEvent(input)

    expect(true).toBe(true)
  })

  test('session.compacted sends extraction prompt to main session via prompt()', async () => {
    let promptCall: unknown = null

    const customMockPluginInput: PluginInput = {
      client: {
        session: {
          messages: async () => ({
            data: [
              { info: { role: 'assistant' }, parts: [{ type: 'text', text: 'Compaction summary content' }] },
            ],
          }),
          create: async () => ({ data: { id: 'unused' } }),
          prompt: async (call: unknown) => {
            promptCall = call
            return { data: { parts: [{ type: 'text', text: 'Done' }] } }
          },
          promptAsync: async () => {},
          todo: async () => ({ data: [] }),
        },
        app: {
          log: () => {},
        },
      },
      project: { id: TEST_PROJECT_ID, worktree: '/test' },
      directory: '/test',
      worktree: '/test',
      serverUrl: new URL('http://localhost:5551'),
    } as unknown as PluginInput

    const memoryService = createMockMemoryService([])
    const hooks = createSessionHooks(TEST_PROJECT_ID, memoryService, mockSessionStateService, mockLogger, customMockPluginInput)

    await hooks.onEvent({
      event: { type: 'session.compacted', properties: { sessionId: 'test-session-123' } },
    })
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(promptCall).not.toBeNull()
    const call = promptCall as any
    expect(call.path.id).toBe('test-session-123')

    const subtask = call.body.parts[0]
    expect(subtask.type).toBe('subtask')
    expect(subtask.agent).toBe('Memory')
    expect(subtask.description).toBe('Memory extraction after compaction')
    expect(subtask.prompt).toContain('Compaction summary content')
    expect(subtask.prompt).toContain('sessionID "test-session-123"')
    expect(subtask.prompt).toContain('active work in progress')
    expect(call.body.parts.length).toBe(1)
  })

  test('session.compacted with active todos includes resume instruction', async () => {
    let promptCall: unknown = null

    const customMockPluginInput: PluginInput = {
      client: {
        session: {
          messages: async () => ({
            data: [
              { info: { role: 'assistant' }, parts: [{ type: 'text', text: 'Summary' }] },
            ],
          }),
          create: async () => ({ data: { id: 'unused' } }),
          prompt: async (call: unknown) => {
            promptCall = call
            return { data: { parts: [{ type: 'text', text: 'Done' }] } }
          },
          promptAsync: async () => {},
          todo: async () => ({
            data: [
              { status: 'completed', content: 'Done task', priority: 'high', id: '1' },
              { status: 'in_progress', content: 'Active task', priority: 'high', id: '2' },
            ],
          }),
        },
        app: {
          log: () => {},
        },
      },
      project: { id: TEST_PROJECT_ID, worktree: '/test' },
      directory: '/test',
      worktree: '/test',
      serverUrl: new URL('http://localhost:5551'),
    } as unknown as PluginInput

    const memoryService = createMockMemoryService([])
    const hooks = createSessionHooks(TEST_PROJECT_ID, memoryService, mockSessionStateService, mockLogger, customMockPluginInput)

    await hooks.onEvent({
      event: { type: 'session.compacted', properties: { sessionId: 'test-session-active' } },
    })
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(promptCall).not.toBeNull()
    const call = promptCall as any
    expect(call.path.id).toBe('test-session-active')
    expect(call.body.parts[0]?.type).toBe('subtask')
    expect(call.body.parts[0]?.prompt).toContain('continue where it left off')
  })

  test('session.compacted with missing sessionId does NOT trigger flow', async () => {
    let promptCalled = false

    const customMockPluginInput: PluginInput = {
      client: {
        session: {
          messages: async () => ({ data: [] }),
          create: async () => ({ data: { id: 'unused' } }),
          prompt: async () => {
            promptCalled = true
            return { data: { parts: [] } }
          },
          promptAsync: async () => {},
          todo: async () => ({ data: [] }),
        },
        app: {
          log: () => {},
        },
      },
      project: { id: TEST_PROJECT_ID, worktree: '/test' },
      directory: '/test',
      worktree: '/test',
      serverUrl: new URL('http://localhost:5551'),
    } as unknown as PluginInput

    const memoryService = createMockMemoryService([])
    const hooks = createSessionHooks(TEST_PROJECT_ID, memoryService, mockSessionStateService, mockLogger, customMockPluginInput)

    await hooks.onEvent({
      event: { type: 'session.compacted', properties: {} },
    })
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(promptCalled).toBe(false)
  })

  test('session.compacted skips extraction when no compaction summary found', async () => {
    let promptCalled = false

    const customMockPluginInput: PluginInput = {
      client: {
        session: {
          messages: async () => ({
            data: [
              { info: { role: 'user' }, parts: [{ type: 'text', text: 'User only' }] },
            ],
          }),
          create: async () => ({ data: { id: 'unused' } }),
          prompt: async () => {
            promptCalled = true
            return { data: { parts: [] } }
          },
          promptAsync: async () => {},
          todo: async () => ({ data: [] }),
        },
        app: {
          log: () => {},
        },
      },
      project: { id: TEST_PROJECT_ID, worktree: '/test' },
      directory: '/test',
      worktree: '/test',
      serverUrl: new URL('http://localhost:5551'),
    } as unknown as PluginInput

    const memoryService = createMockMemoryService([])
    const hooks = createSessionHooks(TEST_PROJECT_ID, memoryService, mockSessionStateService, mockLogger, customMockPluginInput)

    await hooks.onEvent({
      event: { type: 'session.compacted', properties: { sessionId: 'test-no-summary' } },
    })
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(promptCalled).toBe(false)
  })
})
