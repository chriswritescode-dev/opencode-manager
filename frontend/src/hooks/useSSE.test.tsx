import { act, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { JsonObject, JsonValue } from '@opencode-manager/shared/utils'
import type { SessionInfo, SessionStatus } from '@opencode-manager/shared/opencode'
import { useSSE } from './useSSE'
import { useKillShell } from './useSessionShells'
import { openCodeEventStream, TestEventStreamTransport } from '@/lib/opencode-event-stream'
import { clearShellExitRecord, type ShellRecord } from '@/lib/backgroundWork'
import { useSessionStatus } from '@/stores/sessionStatusStore'
import { useSendErrorStore } from '@/stores/sendErrorStore'
import { connectTestEventStream, createTestQueryClient, renderHookWithProviders, type TestProviderOptions } from '@/test/render'
import {
  sessionAgentSelected,
  sessionCreated,
  sessionDeleted,
  sessionExecutionStarted,
  sessionIdle,
  sessionModelSelected,
  sessionMoved,
  sessionRenamed,
  shellCreated,
  shellDeleted,
  shellExited,
} from '@/test/fixtures/events'

interface RenderSseOptions {
  directory?: string
  sessionId?: string
  serverId?: string
}

interface SseHarness {
  transport: TestEventStreamTransport
  fetchFake: ReturnType<typeof renderHookWithProviders>['fetchFake']
  queryClient: ReturnType<typeof createTestQueryClient>
  result: ReturnType<typeof renderHookWithProviders>['result']
  push: (event: JsonObject) => void
}

const invalidationKeys = {
  session: ['opencode', 'session', 'session-1', '/repo'],
  pendingActions: ['opencode', 'pending-actions', 'session-1', '/repo'],
  shells: ['opencode', 'shells', '/repo'],
  reconciliation: ['opencode', 'session-reconcile', 'session-1'],
  sessionList: ['opencode', 'sessions', '/repo'],
} as const

function isInvalidated(harness: SseHarness, key: readonly unknown[]): boolean {
  return harness.queryClient.getQueryState(key)?.isInvalidated === true
}

function seed(harness: SseHarness, key: readonly unknown[], data: JsonValue): void {
  harness.queryClient.setQueryData(key, data)
}

function useSseHook(directory: string, sessionId: string) {
  return useSSE(directory, sessionId)
}

async function renderSse(options: RenderSseOptions = {}): Promise<SseHarness> {
  const transport = new TestEventStreamTransport()
  openCodeEventStream.setTransport(transport)
  const queryClient = createTestQueryClient()
  const directory = options.directory ?? '/repo'
  const sessionId = options.sessionId ?? 'session-1'
  const providerOptions: TestProviderOptions = {
    auth: false,
    theme: false,
    tts: false,
    queryClient,
    fetchRoutes: [
      { method: 'DELETE', path: '/api/opencode/api/shell/:shellId', respond: () => ({ status: 204 }) },
    ],
  }
  if (options.serverId !== undefined) providerOptions.serverId = options.serverId
  const rendered = renderHookWithProviders(() => useSseHook(directory, sessionId), providerOptions)

  await connectTestEventStream(transport)

  return {
    transport,
    fetchFake: rendered.fetchFake,
    queryClient,
    result: rendered.result,
    push: (event) => {
      act(() => {
        transport.message(event)
      })
    },
  }
}

function subscribedDirectories(transport: TestEventStreamTransport): string[] {
  return transport.posts.flatMap((post) => ('directories' in post.body ? post.body.directories : []))
}

const runningShell = {
  id: 'shell-1',
  status: 'running' as const,
  command: 'sleep 1',
  cwd: '/repo',
  shell: 'zsh',
  file: '/tmp/shell-1.log',
  metadata: { sessionID: 'session-1' },
  time: { started: 1 },
}

afterEach(() => {
  clearShellExitRecord('/repo', 'shell-1')
})

describe('useSSE', () => {
  it('invalidates active session data after reconnecting', async () => {
    const harness = await renderSse()

    seed(harness, invalidationKeys.session, { id: 'session-1' })
    seed(harness, invalidationKeys.pendingActions, {})
    seed(harness, invalidationKeys.shells, [])
    seed(harness, invalidationKeys.reconciliation, {})

    act(() => harness.transport.fail())
    await waitFor(() => expect(harness.result.current.isConnected).toBe(false))

    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    await waitFor(() => expect(harness.transport.openedUrls).toHaveLength(2))
    await act(async () => {
      harness.transport.connected('client-2')
    })

    await waitFor(() => expect(isInvalidated(harness, invalidationKeys.session)).toBe(true))
    expect(isInvalidated(harness, invalidationKeys.pendingActions)).toBe(true)
    expect(isInvalidated(harness, invalidationKeys.shells)).toBe(true)
    expect(isInvalidated(harness, invalidationKeys.reconciliation)).toBe(false)
  })

  it('invalidates the cached session query on session.created', async () => {
    const harness = await renderSse()
    const sessionKey = ['opencode', 'session', 'session-2', '/repo'] as const
    seed(harness, sessionKey, { id: 'session-2' })

    harness.push(sessionCreated('session-2', { directory: '/repo' }))

    await waitFor(() => expect(isInvalidated(harness, sessionKey)).toBe(true))
  })

  it('invalidates the cached session query on session.moved so the page follows the new directory', async () => {
    const harness = await renderSse()
    seed(harness, invalidationKeys.session, { id: 'session-1' })

    harness.push(sessionMoved('session-1', '/elsewhere', { directory: '/repo' }))

    await waitFor(() => expect(isInvalidated(harness, invalidationKeys.session)).toBe(true))
  })

  it('invalidates the cached session query on session.renamed', async () => {
    const harness = await renderSse()
    const sessionKey = ['opencode', 'session', 'session-2', '/repo'] as const
    seed(harness, sessionKey, { id: 'session-2' })

    harness.push(sessionRenamed('session-2', 'Renamed', { directory: '/repo' }))

    await waitFor(() => expect(isInvalidated(harness, sessionKey)).toBe(true))
  })

  it('removes the session query on session.deleted', async () => {
    const harness = await renderSse()
    const sessionKey = ['opencode', 'session', 'session-2', '/repo'] as const
    seed(harness, sessionKey, { id: 'session-2' })

    harness.push(sessionDeleted('session-2', { directory: '/repo' }))

    await waitFor(() => expect(harness.queryClient.getQueryData(sessionKey)).toBeUndefined())
  })

  it('reconciles model and agent selection events into the cached session', async () => {
    const harness = await renderSse()
    seed(harness, invalidationKeys.session, {
      id: 'session-1',
      agent: 'build',
      model: { providerID: 'anthropic', id: 'claude' },
    })

    harness.push(sessionModelSelected('session-1', { providerID: 'openai', id: 'gpt-4' }, { directory: '/repo' }))
    harness.push(sessionAgentSelected('session-1', 'plan', { directory: '/repo' }))

    expect(harness.queryClient.getQueryData(invalidationKeys.session)).toMatchObject({
      model: { providerID: 'openai', id: 'gpt-4' },
      agent: 'plan',
    })
  })

  it('patches the cached session revert from revert lifecycle events', async () => {
    const harness = await renderSse()
    seed(harness, invalidationKeys.session, { id: 'session-1' })

    harness.push(sessionRevertStaged('session-1', 'message-3'))
    expect(harness.queryClient.getQueryData(invalidationKeys.session)).toMatchObject({
      revert: { messageID: 'message-3' },
    })

    harness.push(sessionRevertCleared('session-1'))
    expect(readRevert(harness)).toBeUndefined()

    harness.push(sessionRevertStaged('session-1', 'message-4'))
    harness.push(sessionRevertCommitted('session-1'))
    expect(readRevert(harness)).toBeUndefined()
  })

  it('refreshes session lists and the current session on an upstream resync without re-reading pending actions', async () => {
    const harness = await renderSse()
    seed(harness, invalidationKeys.session, { id: 'session-1' })
    seed(harness, invalidationKeys.pendingActions, {})
    seed(harness, invalidationKeys.shells, [])
    seed(harness, invalidationKeys.reconciliation, {})
    seed(harness, invalidationKeys.sessionList, [])

    await act(async () => {
      harness.transport.resync({ timestamp: Date.now() })
    })

    await waitFor(() => expect(isInvalidated(harness, invalidationKeys.session)).toBe(true))
    expect(isInvalidated(harness, invalidationKeys.sessionList)).toBe(true)
    expect(isInvalidated(harness, invalidationKeys.shells)).toBe(true)
    expect(isInvalidated(harness, invalidationKeys.pendingActions)).toBe(false)
    expect(isInvalidated(harness, invalidationKeys.reconciliation)).toBe(false)
  })

  it('ignores a remote resync while the browser stream stays connected', async () => {
    const harness = await renderSse()
    seed(harness, invalidationKeys.session, { id: 'session-1' })
    seed(harness, invalidationKeys.sessionList, [])

    await act(async () => {
      harness.transport.resync({ timestamp: Date.now(), serverId: 'srv_remote' })
    })

    expect(isInvalidated(harness, invalidationKeys.session)).toBe(false)
    expect(isInvalidated(harness, invalidationKeys.sessionList)).toBe(false)
  })

  it('ignores a local resync on a remote server', async () => {
    const harness = await renderSse({ serverId: 'srv_remote' })
    seed(harness, invalidationKeys.session, { id: 'session-1' })
    seed(harness, invalidationKeys.sessionList, [])

    await act(async () => {
      harness.transport.resync({ timestamp: Date.now() })
    })

    expect(isInvalidated(harness, invalidationKeys.session)).toBe(false)
    expect(isInvalidated(harness, invalidationKeys.sessionList)).toBe(false)
  })

  it('tracks background shells from shell lifecycle events without dropping completed shells', async () => {
    const harness = await renderSse()
    seed(harness, invalidationKeys.shells, [runningShell])

    harness.push(shellCreated({ id: 'shell-2', status: 'running', sessionID: 'session-1' }, { directory: '/repo' }))
    harness.push(shellExited('shell-1', 'exited', { directory: '/repo' }))

    const shells = readShells(harness)
    expect(shells.map((shell) => shell.id)).toEqual(['shell-1', 'shell-2'])
    expect(shells[0]?.status).toBe('exited')
    expect(shells[0]?.time.completed).toBeDefined()

    harness.push(shellDeleted('shell-1', { directory: '/repo' }))

    const afterDelete = readShells(harness)
    expect(afterDelete.map((shell) => shell.id)).toEqual(['shell-1', 'shell-2'])
    expect(afterDelete[0]?.status).toBe('exited')
  })

  it('keeps a deleted running shell visible as unavailable', async () => {
    const harness = await renderSse()
    seed(harness, invalidationKeys.shells, [runningShell])

    harness.push(shellDeleted('shell-1', { directory: '/repo' }))

    expect(readShells(harness)[0]).toMatchObject({ id: 'shell-1', status: 'unavailable' })
  })

  it('does not discard a shell exit that arrives before the cache is seeded', async () => {
    const harness = await renderSse()
    seed(harness, invalidationKeys.shells, [])

    harness.push(shellExited('shell-1', 'exited', { directory: '/repo' }))

    await waitFor(() => expect(isInvalidated(harness, invalidationKeys.shells)).toBe(true))
  })

  it('does not resurrect a completed shell from a stale created event', async () => {
    const harness = await renderSse()
    seed(harness, invalidationKeys.shells, [
      { ...runningShell, status: 'exited', exit: 0, time: { started: 1, completed: 2 } },
    ])

    harness.push(shellCreated({ id: 'shell-1', status: 'running', sessionID: 'session-1' }, { directory: '/repo' }))

    expect(readShells(harness)[0]?.status).toBe('exited')
  })

  it('keeps a killed shell killed after a later shell.exited event', async () => {
    const transport = new TestEventStreamTransport()
    openCodeEventStream.setTransport(transport)
    const queryClient = createTestQueryClient()
    queryClient.setQueryData(invalidationKeys.shells, [runningShell])

    const { result } = renderHookWithProviders(
      () => ({ sse: useSSE('/repo', 'session-1'), kill: useKillShell('/repo') }),
      {
        auth: false,
        theme: false,
        tts: false,
        queryClient,
        fetchRoutes: [
          { method: 'DELETE', path: '/api/opencode/api/shell/shell-1', respond: () => ({ status: 204 }) },
        ],
      },
    )
    await connectTestEventStream(transport)
    await waitFor(() => expect(result.current.sse.isConnected).toBe(true))

    await act(async () => {
      await result.current.kill.mutateAsync('shell-1')
    })

    expect(queryClient.getQueryData<Array<{ status: string }>>(invalidationKeys.shells)?.[0]?.status).toBe('killed')

    act(() => {
      transport.message(shellExited('shell-1', 'exited', { directory: '/repo' }))
    })

    expect(queryClient.getQueryData<Array<{ status: string }>>(invalidationKeys.shells)?.[0]?.status).toBe('killed')
  })

  it('does not write session status from stream events', async () => {
    const harness = await renderSse()

    harness.push(sessionStatusEvent('session-1', { type: 'busy' }))
    harness.push(sessionExecutionStarted('session-1', { directory: '/repo' }))
    harness.push(sessionIdle('session-1', { directory: '/repo' }))

    expect(useSessionStatus.getState().getStatus('session-1')).toEqual({ type: 'idle' })
  })

  it('clears the network send error on session.idle', async () => {
    const harness = await renderSse()
    useSendErrorStore.getState().setError({
      sessionID: 'session-1',
      title: 'Failed to send',
      message: 'Network error',
      kind: 'network',
    })

    harness.push(sessionIdle('session-1', { directory: '/repo' }))

    expect(useSendErrorStore.getState().getError('session-1')).toBeNull()
  })

  it('ignores message, todo, and form events', async () => {
    const harness = await renderSse()
    seed(harness, invalidationKeys.session, { id: 'session-1' })
    seed(harness, invalidationKeys.sessionList, [])

    const events: JsonObject[] = [
      {
        id: 'evt_message_updated',
        created: 1,
        type: 'message.updated',
        directory: '/repo',
        data: { info: { id: 'message-1', sessionID: 'session-1' } },
      },
      {
        id: 'evt_message_removed',
        created: 2,
        type: 'message.removed',
        directory: '/repo',
        data: { sessionID: 'session-1', messageID: 'message-1' },
      },
      {
        id: 'evt_todo_updated',
        created: 3,
        type: 'todo.updated',
        directory: '/repo',
        data: { sessionID: 'session-1', todos: [] },
      },
      {
        id: 'evt_form_replied',
        created: 4,
        type: 'form.replied',
        directory: '/repo',
        data: { id: 'form-1', sessionID: 'session-1', answer: {} },
      },
      {
        id: 'evt_form_cancelled',
        created: 5,
        type: 'form.cancelled',
        directory: '/repo',
        data: { id: 'form-1', sessionID: 'session-1' },
      },
    ]
    for (const event of events) harness.push(event)

    expect(isInvalidated(harness, invalidationKeys.session)).toBe(false)
    expect(isInvalidated(harness, invalidationKeys.sessionList)).toBe(false)
    expect(harness.queryClient.getQueryData(invalidationKeys.session)).toEqual({ id: 'session-1' })
  })

  it('does not invalidate the session list on per-token delta events', async () => {
    const harness = await renderSse()
    seed(harness, invalidationKeys.sessionList, [])

    for (const type of ['session.text.delta', 'session.reasoning.delta', 'session.tool.input.delta']) {
      harness.push({
        id: `evt_${type}`,
        created: 1,
        type,
        directory: '/repo',
        data: { sessionID: 'session-2' },
      })
    }

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300))
    })

    expect(isInvalidated(harness, invalidationKeys.sessionList)).toBe(false)
  })

  it('does not show an update toast on installation.update-available', async () => {
    const harness = await renderSse()

    harness.push({
      id: 'evt_update_available',
      created: 1,
      type: 'installation.update-available',
      directory: '/repo',
      data: { version: '2.0.0' },
    })

    expect(screen.queryByText('OpenCode updated to v2.0.0')).toBeNull()
  })

  it('shows an updated toast on installation.updated', async () => {
    const harness = await renderSse()

    harness.push({
      id: 'evt_updated',
      created: 1,
      type: 'installation.updated',
      directory: '/repo',
      data: { version: '2.0.0' },
    })

    expect(await screen.findByText('OpenCode updated to v2.0.0')).toBeInTheDocument()
  })

  it('ignores events belonging to another OpenCode server', async () => {
    const harness = await renderSse()
    const sessionKey = ['opencode', 'session', 'session-2', '/repo'] as const
    seed(harness, sessionKey, { id: 'session-2' })

    harness.push(sessionCreated('session-2', { directory: '/repo', serverId: 'srv_remote' }))
    expect(isInvalidated(harness, sessionKey)).toBe(false)

    harness.push(sessionCreated('session-2', { directory: '/repo' }))
    await waitFor(() => expect(isInvalidated(harness, sessionKey)).toBe(true))
  })

  it('subscribes with the server-scoped directory key for a remote server', async () => {
    const harness = await renderSse({ serverId: 'srv_remote' })

    expect(harness.transport.openedUrls).toHaveLength(1)
    expect(subscribedDirectories(harness.transport)).toEqual(['srv_remote|/repo'])
  })
})

function readShells(harness: SseHarness): ShellRecord[] {
  return harness.queryClient.getQueryData<ShellRecord[]>(invalidationKeys.shells) ?? []
}

function readRevert(harness: SseHarness): SessionInfo['revert'] {
  return harness.queryClient.getQueryData<SessionInfo>(invalidationKeys.session)?.revert
}

function sessionRevertStaged(sessionID: string, messageID: string): JsonObject {
  return {
    id: `evt_revert_staged_${messageID}`,
    created: 1,
    type: 'session.revert.staged',
    directory: '/repo',
    durable: { aggregateID: sessionID, seq: 1, version: 1 },
    data: { sessionID, revert: { messageID } },
  }
}

function sessionRevertCleared(sessionID: string): JsonObject {
  return {
    id: `evt_revert_cleared_${sessionID}`,
    created: 2,
    type: 'session.revert.cleared',
    directory: '/repo',
    durable: { aggregateID: sessionID, seq: 2, version: 1 },
    data: { sessionID },
  }
}

function sessionRevertCommitted(sessionID: string): JsonObject {
  return {
    id: `evt_revert_committed_${sessionID}`,
    created: 3,
    type: 'session.revert.committed',
    directory: '/repo',
    durable: { aggregateID: sessionID, seq: 3, version: 1 },
    data: { sessionID, to: 'message-4' },
  }
}

function sessionStatusEvent(sessionID: string, status: SessionStatus): JsonObject {
  return {
    id: `evt_status_${sessionID}`,
    created: 1,
    type: 'session.status',
    directory: '/repo',
    data: { sessionID, status },
  }
}
