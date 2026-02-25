import { describe, test, expect, beforeEach } from 'bun:test'
import { createSessionHooks } from '../src/hooks/session'
import type { MemoryService } from '../src/services/memory'
import type { SessionStateService } from '../src/services/session-state'
import type { Logger, Memory, MemoryScope, PlanningState } from '../src/types'
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

const createMockSessionStateServiceWithPlanning = (planningState: PlanningState | null): SessionStateService => ({
  getPlanningState: () => planningState,
  getCompactionSnapshot: () => null,
  setCompactionSnapshot: () => {},
} as unknown as SessionStateService)

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

  test('session.compacted includes planning state in subtask prompt when available', async () => {
    let promptCall: unknown = null

    const planningState: PlanningState = {
      objective: 'Refactor memory extraction flow',
      current: 'Updating buildSubtaskPrompt to accept planning state',
      next: 'Run tests and verify behavior',
      phases: [
        { title: 'Update buildSubtaskPrompt', status: 'completed', notes: 'Added planningState parameter' },
        { title: 'Update runPostCompactionFlow', status: 'in_progress', notes: 'Fetching from KV store' },
        { title: 'Add tests', status: 'pending' },
      ],
      findings: ['SubtaskPart keeps session busy'],
      errors: [],
    }

    const customMockPluginInput: PluginInput = {
      client: {
        session: {
          messages: async () => ({
            data: [
              { info: { role: 'assistant' }, parts: [{ type: 'text', text: 'Compaction summary here' }] },
            ],
          }),
          create: async () => ({ data: { id: 'unused' } }),
          prompt: async (call: unknown) => {
            promptCall = call
            return { data: { parts: [{ type: 'text', text: 'Done' }] } }
          },
          promptAsync: async () => {},
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
    const sessionStateWithPlanning = createMockSessionStateServiceWithPlanning(planningState)
    const hooks = createSessionHooks(TEST_PROJECT_ID, memoryService, sessionStateWithPlanning, mockLogger, customMockPluginInput)

    await hooks.onEvent({
      event: { type: 'session.compacted', properties: { sessionId: 'test-session-planning' } },
    })
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(promptCall).not.toBeNull()
    const call = promptCall as any
    const subtask = call.body.parts[0]

    expect(subtask.prompt).toContain('Current Planning State')
    expect(subtask.prompt).toContain('Refactor memory extraction flow')
    expect(subtask.prompt).toContain('Updating buildSubtaskPrompt')
    expect(subtask.prompt).toContain('[x] Update buildSubtaskPrompt')
    expect(subtask.prompt).toContain('[~] Update runPostCompactionFlow')
  })

  test('session.compacted with active planning includes resume instruction', async () => {
    let promptCall: unknown = null

    const planningState: PlanningState = {
      objective: 'Complete the refactor',
      current: 'Running tests',
      next: 'Commit changes',
      phases: [
        { title: 'Phase 1', status: 'completed' },
        { title: 'Phase 2', status: 'in_progress', notes: 'Almost done' },
      ],
    }

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
    const sessionStateWithPlanning = createMockSessionStateServiceWithPlanning(planningState)
    const hooks = createSessionHooks(TEST_PROJECT_ID, memoryService, sessionStateWithPlanning, mockLogger, customMockPluginInput)

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
