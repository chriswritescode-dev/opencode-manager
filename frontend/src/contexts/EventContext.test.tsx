import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FormInfo, PermissionRequest } from '@opencode-manager/shared/opencode'
import { EventProvider, useEventContext, useForms, usePermissions, useSSEHealth } from './EventContext'

const mocks = vi.hoisted(() => ({
  listRepos: vi.fn(),
  listPendingPermissions: vi.fn(),
  listPendingForms: vi.fn(),
  replyPermission: vi.fn(),
  replyForm: vi.fn(),
  cancelForm: vi.fn(),
  subscribeGlobalMonitor: vi.fn(),
  getHealth: vi.fn(),
}))

vi.mock('@/api/repos', () => ({
  listRepos: mocks.listRepos,
}))

vi.mock('@/api/opencode', () => ({
  listPendingPermissions: mocks.listPendingPermissions,
  listPendingForms: mocks.listPendingForms,
  replyPermission: mocks.replyPermission,
  replyForm: mocks.replyForm,
  cancelForm: mocks.cancelForm,
}))

vi.mock('@/lib/opencode-event-stream', () => ({
  openCodeEventStream: {
    subscribeGlobalMonitor: mocks.subscribeGlobalMonitor,
    getHealth: mocks.getHealth,
  },
}))

vi.mock('@/lib/toast', () => ({
  showToast: {
    error: vi.fn(),
    info: vi.fn(),
  },
}))

const pendingForm: FormInfo = {
  id: 'form-1',
  sessionID: 'session-1',
  title: 'Continue?',
  fields: [
    { key: 'q0', title: 'Confirm', type: 'string', options: [{ value: 'Yes', label: 'Yes' }] },
  ],
}

const secondPendingForm: FormInfo = {
  id: 'form-2',
  sessionID: 'session-2',
  title: 'Deploy?',
  fields: [
    { key: 'q0', title: 'Deploy', type: 'string', options: [{ value: 'Yes', label: 'Yes' }] },
  ],
}

const pendingPermission: PermissionRequest = {
  id: 'permission-1',
  sessionID: 'session-1',
  action: 'shell',
  resources: ['echo hello'],
  metadata: {},
}

const secondPendingPermission: PermissionRequest = {
  id: 'permission-2',
  sessionID: 'session-1',
  action: 'edit',
  resources: ['/tmp/test.txt'],
  metadata: {},
}

function Harness() {
  const { current, pendingCount, syncForSession, navigateToCurrent, cancel, reply, getForSession } = useForms()
  const permissions = usePermissions()
  const location = useLocation()

  return (
    <div>
      <div data-testid="count">{pendingCount}</div>
      <div data-testid="current">{current?.id ?? 'none'}</div>
      <div data-testid="for-session-1">{getForSession('session-1')?.id ?? 'none'}</div>
      <div data-testid="for-session-2">{getForSession('session-2')?.id ?? 'none'}</div>
      <div data-testid="for-session-unknown">{getForSession('session-unknown')?.id ?? 'none'}</div>
      <div data-testid="permission-count">{permissions.pendingCount}</div>
      <div data-testid="permission-current">{permissions.current?.id ?? 'none'}</div>
      <div data-testid="path">{location.pathname}</div>
      <button onClick={() => syncForSession('/repo', 'session-1')}>Sync</button>
      <button onClick={() => permissions.syncForSession('/repo', 'session-1')}>Sync Permissions</button>
      <button onClick={navigateToCurrent}>Navigate</button>
      <button onClick={() => current && cancel(current.id)}>Dismiss</button>
      <button onClick={() => current && reply(current.id, { q0: 'Yes' })}>Reply</button>
      <button onClick={() => permissions.current && permissions.respond(permissions.current.id, permissions.current.sessionID, 'reject')}>Reject Permission</button>
      <button onClick={() => permissions.current && permissions.respond(permissions.current.id, permissions.current.sessionID, 'reject', 'not allowed')}>Reject Permission With Reason</button>
    </div>
  )
}

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
}

function createWrapper(queryClient = createTestQueryClient()) {
  return ({ children }: { children: ReactNode }) => (
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <EventProvider>{children}</EventProvider>
      </QueryClientProvider>
    </MemoryRouter>
  )
}

function CacheResolutionHarness({ sessionID }: { sessionID: string }) {
  const { getRepoIdForSession } = useEventContext()
  const repoId = getRepoIdForSession(sessionID)

  return (
    <div>
      <div data-testid="repo-id">{repoId ?? 'none'}</div>
    </div>
  )
}

describe('EventProvider permissions and forms', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listRepos.mockResolvedValue([])
    mocks.listPendingPermissions.mockResolvedValue([])
    mocks.listPendingForms.mockResolvedValue([])
    mocks.replyPermission.mockResolvedValue(undefined)
    mocks.replyForm.mockResolvedValue(undefined)
    mocks.cancelForm.mockResolvedValue(undefined)
    mocks.getHealth.mockReturnValue({ isConnected: false, isHealthy: false, lastEventAt: null, isStalled: false })
    mocks.subscribeGlobalMonitor.mockReturnValue({
      dispose: vi.fn(),
      updateDirectories: vi.fn(),
      reconnect: vi.fn(),
      reportVisibility: vi.fn(),
    })
  })

  it('syncs missed pending forms for a session', async () => {
    mocks.listPendingForms.mockResolvedValue([pendingForm])

    render(<Harness />, { wrapper: createWrapper() })

    await userEvent.click(screen.getByRole('button', { name: 'Sync' }))

    await waitFor(() => {
      expect(screen.getByTestId('count')).toHaveTextContent('1')
      expect(screen.getByTestId('current')).toHaveTextContent('form-1')
    })
  })

  it('syncs missed pending permissions for a session', async () => {
    mocks.listPendingPermissions.mockResolvedValue([pendingPermission])

    render(<Harness />, { wrapper: createWrapper() })

    await userEvent.click(screen.getByRole('button', { name: 'Sync Permissions' }))

    await waitFor(() => {
      expect(screen.getByTestId('permission-count')).toHaveTextContent('1')
      expect(screen.getByTestId('permission-current')).toHaveTextContent('permission-1')
    })
  })

  it('clears stale pending permissions for a session', async () => {
    mocks.listPendingPermissions
      .mockResolvedValueOnce([pendingPermission])
      .mockResolvedValueOnce([])

    render(<Harness />, { wrapper: createWrapper() })

    await userEvent.click(screen.getByRole('button', { name: 'Sync Permissions' }))

    await waitFor(() => {
      expect(screen.getByTestId('permission-count')).toHaveTextContent('1')
    })

    await userEvent.click(screen.getByRole('button', { name: 'Sync Permissions' }))

    await waitFor(() => {
      expect(screen.getByTestId('permission-count')).toHaveTextContent('0')
      expect(screen.getByTestId('permission-current')).toHaveTextContent('none')
    })
  })

  it('advances to the remaining permission after rejecting the current one of two in the same session', async () => {
    mocks.listPendingPermissions.mockResolvedValue([pendingPermission, secondPendingPermission])

    render(<Harness />, { wrapper: createWrapper() })

    await userEvent.click(screen.getByRole('button', { name: 'Sync Permissions' }))

    await waitFor(() => {
      expect(screen.getByTestId('permission-count')).toHaveTextContent('2')
      expect(screen.getByTestId('permission-current')).toHaveTextContent('permission-1')
    })

    await userEvent.click(screen.getByRole('button', { name: 'Reject Permission' }))

    await waitFor(() => {
      expect(mocks.replyPermission).toHaveBeenCalledTimes(1)
      expect(mocks.replyPermission).toHaveBeenCalledWith('session-1', 'permission-1', 'reject', undefined)
      expect(screen.getByTestId('permission-count')).toHaveTextContent('1')
      expect(screen.getByTestId('permission-current')).toHaveTextContent('permission-2')
    })
  })

  it('forwards an optional rejection message to the facade', async () => {
    mocks.listPendingPermissions.mockResolvedValue([pendingPermission])

    render(<Harness />, { wrapper: createWrapper() })

    await userEvent.click(screen.getByRole('button', { name: 'Sync Permissions' }))

    await waitFor(() => expect(screen.getByTestId('permission-count')).toHaveTextContent('1'))

    await userEvent.click(screen.getByRole('button', { name: 'Reject Permission With Reason' }))

    await waitFor(() =>
      expect(mocks.replyPermission).toHaveBeenCalledWith('session-1', 'permission-1', 'reject', 'not allowed'),
    )
  })

  it('clears stale pending forms for a session', async () => {
    mocks.listPendingForms
      .mockResolvedValueOnce([pendingForm])
      .mockResolvedValueOnce([])

    render(<Harness />, { wrapper: createWrapper() })

    await userEvent.click(screen.getByRole('button', { name: 'Sync' }))

    await waitFor(() => {
      expect(screen.getByTestId('count')).toHaveTextContent('1')
    })

    await userEvent.click(screen.getByRole('button', { name: 'Sync' }))

    await waitFor(() => {
      expect(screen.getByTestId('count')).toHaveTextContent('0')
      expect(screen.getByTestId('current')).toHaveTextContent('none')
    })
  })

  it('reconciles pending forms for the whole directory', async () => {
    mocks.listPendingForms
      .mockResolvedValueOnce([pendingForm, secondPendingForm])
      .mockResolvedValueOnce([pendingForm])

    render(<Harness />, { wrapper: createWrapper() })

    await userEvent.click(screen.getByRole('button', { name: 'Sync' }))

    await waitFor(() => {
      expect(screen.getByTestId('count')).toHaveTextContent('2')
    })

    await userEvent.click(screen.getByRole('button', { name: 'Sync' }))

    await waitFor(() => {
      expect(screen.getByTestId('count')).toHaveTextContent('1')
      expect(screen.getByTestId('current')).toHaveTextContent('form-1')
    })
  })

  it('resolves pending forms per session independently of the global current', async () => {
    mocks.listPendingForms.mockResolvedValue([pendingForm, secondPendingForm])

    render(<Harness />, { wrapper: createWrapper() })

    await userEvent.click(screen.getByRole('button', { name: 'Sync' }))

    await waitFor(() => {
      expect(screen.getByTestId('count')).toHaveTextContent('2')
    })

    expect(screen.getByTestId('current')).toHaveTextContent('form-1')
    expect(screen.getByTestId('for-session-1')).toHaveTextContent('form-1')
    expect(screen.getByTestId('for-session-2')).toHaveTextContent('form-2')
    expect(screen.getByTestId('for-session-unknown')).toHaveTextContent('none')
  })

  it('reconciles stale pending forms after reconnect', async () => {
    mocks.listRepos.mockResolvedValue([{ id: 123, fullPath: '/repo' }])
    mocks.listPendingForms
      .mockResolvedValueOnce([pendingForm])
      .mockResolvedValueOnce([])

    render(<Harness />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(screen.getByTestId('count')).toHaveTextContent('1')
    })

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const handleStatusChange = lastSubscribeCall[0].onStatusChange as (connected: boolean) => void
    handleStatusChange(true)

    await waitFor(() => {
      expect(screen.getByTestId('count')).toHaveTextContent('0')
      expect(screen.getByTestId('current')).toHaveTextContent('none')
    })
  })

  it('clears settled pending actions on an upstream resync while the browser stream stays connected', async () => {
    mocks.listRepos.mockResolvedValue([{ id: 123, fullPath: '/repo' }])
    mocks.listPendingPermissions.mockResolvedValue([])
    mocks.listPendingForms.mockResolvedValue([])

    render(<Harness />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(mocks.listPendingPermissions).toHaveBeenCalledWith('/repo')
      expect(mocks.listPendingForms).toHaveBeenCalledWith('/repo')
    })
    await act(async () => {
      await Promise.resolve()
    })

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onEvent = lastSubscribeCall[0].onEvent as (data: unknown) => void
    const onResync = lastSubscribeCall[0].onResync as (() => void) | undefined

    act(() => {
      onEvent({ type: 'permission.asked', data: pendingPermission, directory: '/repo' })
      onEvent({ type: 'form.created', data: { form: pendingForm }, directory: '/repo' })
    })

    await waitFor(() => {
      expect(screen.getByTestId('permission-count')).toHaveTextContent('1')
      expect(screen.getByTestId('count')).toHaveTextContent('1')
    })

    act(() => {
      onResync?.()
    })

    await waitFor(() => {
      expect(screen.getByTestId('permission-count')).toHaveTextContent('0')
      expect(screen.getByTestId('count')).toHaveTextContent('0')
    })
  })

  it('retains genuinely pending actions on an upstream resync', async () => {
    mocks.listRepos.mockResolvedValue([{ id: 123, fullPath: '/repo' }])
    mocks.listPendingPermissions.mockResolvedValue([pendingPermission])
    mocks.listPendingForms.mockResolvedValue([pendingForm])

    render(<Harness />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled()
    })

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onEvent = lastSubscribeCall[0].onEvent as (data: unknown) => void
    const onResync = lastSubscribeCall[0].onResync as (() => void) | undefined

    act(() => {
      onEvent({ type: 'permission.asked', data: pendingPermission, directory: '/repo' })
      onEvent({ type: 'form.created', data: { form: pendingForm }, directory: '/repo' })
    })

    await waitFor(() => {
      expect(screen.getByTestId('permission-count')).toHaveTextContent('1')
      expect(screen.getByTestId('count')).toHaveTextContent('1')
    })

    act(() => {
      onResync?.()
    })

    await waitFor(() => {
      expect(screen.getByTestId('permission-count')).toHaveTextContent('1')
      expect(screen.getByTestId('count')).toHaveTextContent('1')
    })
  })

  it('reconciles tracked worktree session directories on an upstream resync', async () => {
    mocks.listRepos.mockResolvedValue([{ id: 123, fullPath: '/repo' }])
    mocks.listPendingPermissions.mockResolvedValue([])
    mocks.listPendingForms.mockResolvedValue([])

    render(<Harness />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(mocks.listPendingPermissions).toHaveBeenCalledWith('/repo')
      expect(mocks.listPendingForms).toHaveBeenCalledWith('/repo')
    })
    await act(async () => {
      await Promise.resolve()
    })

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onEvent = lastSubscribeCall[0].onEvent as (data: unknown) => void
    const onResync = lastSubscribeCall[0].onResync as (() => void) | undefined

    act(() => {
      onEvent({ type: 'permission.asked', data: pendingPermission, directory: '/worktrees/wt-1' })
    })

    await waitFor(() => {
      expect(screen.getByTestId('permission-count')).toHaveTextContent('1')
    })

    act(() => {
      onResync?.()
    })

    await waitFor(() => {
      expect(mocks.listPendingPermissions).toHaveBeenCalledWith('/worktrees/wt-1')
      expect(screen.getByTestId('permission-count')).toHaveTextContent('0')
    })
  })

  it('navigates to a synced pending form without session query cache', async () => {
    mocks.listRepos.mockResolvedValue([{ id: 123, fullPath: '/repo' }])
    mocks.listPendingForms.mockResolvedValue([pendingForm])

    render(<Harness />, { wrapper: createWrapper() })

    await userEvent.click(screen.getByRole('button', { name: 'Sync' }))

    await waitFor(() => {
      expect(screen.getByTestId('current')).toHaveTextContent('form-1')
    })

    await userEvent.click(screen.getByRole('button', { name: 'Navigate' }))

    await waitFor(() => {
      expect(screen.getByTestId('path')).toHaveTextContent('/repos/123/sessions/session-1')
    })
  })

  it('clears a pending form after dismiss succeeds', async () => {
    mocks.listPendingForms.mockResolvedValue([pendingForm])

    render(<Harness />, { wrapper: createWrapper() })

    await userEvent.click(screen.getByRole('button', { name: 'Sync' }))

    await waitFor(() => {
      expect(screen.getByTestId('count')).toHaveTextContent('1')
    })

    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))

    await waitFor(() => {
      expect(mocks.cancelForm).toHaveBeenCalledWith('session-1', 'form-1')
      expect(screen.getByTestId('count')).toHaveTextContent('0')
      expect(screen.getByTestId('current')).toHaveTextContent('none')
    })
  })

  it('clears a pending form after reply succeeds', async () => {
    mocks.listPendingForms.mockResolvedValue([pendingForm])

    render(<Harness />, { wrapper: createWrapper() })

    await userEvent.click(screen.getByRole('button', { name: 'Sync' }))

    await waitFor(() => {
      expect(screen.getByTestId('count')).toHaveTextContent('1')
    })

    await userEvent.click(screen.getByRole('button', { name: 'Reply' }))

    await waitFor(() => {
      expect(mocks.replyForm).toHaveBeenCalledWith('session-1', 'form-1', { q0: 'Yes' })
      expect(screen.getByTestId('count')).toHaveTextContent('0')
      expect(screen.getByTestId('current')).toHaveTextContent('none')
    })
  })

  it('adds a pending form received via the global monitor onEvent', async () => {
    mocks.listRepos.mockResolvedValue([{ id: 123, fullPath: '/repo' }])

    render(<Harness />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled()
    })

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onEvent = lastSubscribeCall[0].onEvent as (data: unknown) => void

    act(() => {
      onEvent({
        type: 'form.created',
        data: { form: pendingForm },
        directory: '/repo',
      })
    })

    await waitFor(() => {
      expect(screen.getByTestId('count')).toHaveTextContent('1')
      expect(screen.getByTestId('current')).toHaveTextContent('form-1')
    })
  })

  it('adds a pending permission received via the global monitor onEvent', async () => {
    mocks.listRepos.mockResolvedValue([{ id: 123, fullPath: '/repo' }])

    render(<Harness />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled()
    })

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onEvent = lastSubscribeCall[0].onEvent as (data: unknown) => void

    act(() => {
      onEvent({
        type: 'permission.asked',
        data: pendingPermission,
        directory: '/repo',
      })
    })

    await waitFor(() => {
      expect(screen.getByTestId('permission-count')).toHaveTextContent('1')
      expect(screen.getByTestId('permission-current')).toHaveTextContent('permission-1')
    })

    act(() => {
      onEvent({
        type: 'permission.replied',
        data: { sessionID: 'session-1', requestID: 'permission-1', reply: 'reject' },
        directory: '/repo',
      })
    })

    await waitFor(() => {
      expect(screen.getByTestId('permission-count')).toHaveTextContent('0')
    })
  })

  it('removes a pending form on a form.cancelled event', async () => {
    mocks.listRepos.mockResolvedValue([{ id: 123, fullPath: '/repo' }])
    mocks.listPendingForms.mockResolvedValue([pendingForm])

    render(<Harness />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(screen.getByTestId('count')).toHaveTextContent('1')
    })

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onEvent = lastSubscribeCall[0].onEvent as (data: unknown) => void

    act(() => {
      onEvent({
        type: 'form.cancelled',
        data: { id: 'form-1', sessionID: 'session-1' },
        directory: '/repo',
      })
    })

    await waitFor(() => {
      expect(screen.getByTestId('count')).toHaveTextContent('0')
      expect(screen.getByTestId('current')).toHaveTextContent('none')
    })
  })

  it('does not invalidate the transcript on form reply or cancel events', async () => {
    mocks.listRepos.mockResolvedValue([{ id: 123, fullPath: '/repo' }])
    mocks.listPendingForms.mockResolvedValue([pendingForm, secondPendingForm])
    const queryClient = createTestQueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')

    render(<Harness />, { wrapper: createWrapper(queryClient) })

    await waitFor(() => {
      expect(screen.getByTestId('count')).toHaveTextContent('2')
    })
    invalidateQueries.mockClear()

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onEvent = lastSubscribeCall[0].onEvent as (data: unknown) => void

    act(() => {
      onEvent({ type: 'form.replied', data: { id: 'form-1', sessionID: 'session-1', answer: {} }, directory: '/repo' })
      onEvent({ type: 'form.cancelled', data: { id: 'form-2', sessionID: 'session-2' }, directory: '/repo' })
    })

    await waitFor(() => {
      expect(screen.getByTestId('count')).toHaveTextContent('0')
    })
    expect(invalidateQueries).not.toHaveBeenCalled()
  })

  it.each([
    'credential.updated',
    'credential.switched',
    'integration.updated',
    'provider.updated',
    'model.updated',
  ])('invalidates provider, model, credential, and auth-method caches on a location-less %s event', async (type) => {
    const queryClient = createTestQueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')

    render(<Harness />, { wrapper: createWrapper(queryClient) })

    await waitFor(() => expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled())
    invalidateQueries.mockClear()

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onEvent = lastSubscribeCall[0].onEvent as (data: unknown) => void

    act(() => {
      onEvent({ type, data: {} })
    })

    for (const queryKey of [
      ['providers'],
      ['provider-credentials'],
      ['provider-auth-methods'],
      ['providers-with-models'],
      ['opencode', 'providers'],
    ]) {
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey })
    }
  })

  it('reconciles every tracked directory concurrently on an upstream resync', async () => {
    mocks.listRepos.mockResolvedValue([
      { id: 1, fullPath: '/repo-a' },
      { id: 2, fullPath: '/repo-b' },
    ])

    render(<Harness />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(mocks.listPendingForms).toHaveBeenCalledWith('/repo-b')
    })
    await act(async () => {
      await Promise.resolve()
    })

    const pending = new Map<string, () => void>()
    mocks.listPendingPermissions.mockImplementation(
      (directory: string) =>
        new Promise((resolve) => {
          pending.set(directory, () => resolve([]))
        }),
    )
    mocks.listPendingPermissions.mockClear()
    mocks.listPendingForms.mockClear()

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onResync = lastSubscribeCall[0].onResync as (() => void) | undefined

    act(() => {
      onResync?.()
    })

    expect(mocks.listPendingPermissions).toHaveBeenCalledWith('/repo-a')
    expect(mocks.listPendingPermissions).toHaveBeenCalledWith('/repo-b')
    expect(mocks.listPendingForms).toHaveBeenCalledWith('/repo-a')
    expect(mocks.listPendingForms).toHaveBeenCalledWith('/repo-b')

    await act(async () => {
      pending.forEach((resolve) => resolve())
    })
  })

  it('resolves a session directory from the infinite-query session list cache', async () => {
    mocks.listRepos.mockResolvedValue([{ id: 123, fullPath: '/repo' }])

    const queryClient = createTestQueryClient()

    queryClient.setQueryData(
      ['opencode', 'sessions', '/repo', { search: undefined, limit: 25 }],
      {
        pages: [{
          items: [
            { id: 'ses-infinite', projectID: 'proj-1', title: 'From Infinite Query', location: { directory: '/repo' }, time: { created: 1000, updated: 1000 } },
          ],
          cursors: {},
        }],
        pageParams: [undefined],
      },
    )

    render(<CacheResolutionHarness sessionID="ses-infinite" />, { wrapper: createWrapper(queryClient) })

    await waitFor(() => {
      expect(screen.getByTestId('repo-id')).toHaveTextContent('123')
    })
  })

  it('resolves a session directory from the single-session cache without a remembered event directory', async () => {
    mocks.listRepos.mockResolvedValue([{ id: 123, fullPath: '/repo' }])

    const queryClient = createTestQueryClient()

    queryClient.setQueryData(
      ['opencode', 'session', 'ses-detail', '/repo'],
      {
        id: 'ses-detail',
        projectID: 'proj-1',
        title: 'Session Detail',
        location: { directory: '/repo' },
        time: { created: 1000, updated: 1000 },
      },
    )

    render(<CacheResolutionHarness sessionID="ses-detail" />, { wrapper: createWrapper(queryClient) })

    await waitFor(() => {
      expect(screen.getByTestId('repo-id')).toHaveTextContent('123')
    })
  })

  it('resolves a session in the second directory page of the session list cache', async () => {
    mocks.listRepos.mockResolvedValue([
      { id: 123, fullPath: '/repo-a' },
      { id: 456, fullPath: '/repo-b' },
    ])

    const queryClient = createTestQueryClient()

    queryClient.setQueryData(
      ['opencode', 'sessions', '/repo-a|/repo-b', { search: undefined, limit: 25 }],
      {
        pages: [
          {
            items: [
              { id: 'ses-first', projectID: 'proj-1', title: 'First', location: { directory: '/repo-a' }, time: { created: 1000, updated: 1000 } },
            ],
            cursors: { '/repo-a': 'cursor-a' },
          },
          {
            items: [
              { id: 'ses-second', projectID: 'proj-1', title: 'Second', location: { directory: '/repo-b' }, time: { created: 2000, updated: 2000 } },
            ],
            cursors: {},
          },
        ],
        pageParams: [undefined, { '/repo-a': 'cursor-a' }],
      },
    )

    render(<CacheResolutionHarness sessionID="ses-second" />, { wrapper: createWrapper(queryClient) })

    await waitFor(() => {
      expect(screen.getByTestId('repo-id')).toHaveTextContent('456')
    })
  })

  it('exposes sseHealth through context', async () => {
    mocks.getHealth.mockReturnValue({ isConnected: true, isHealthy: true, lastEventAt: Date.now(), isStalled: false })
    mocks.subscribeGlobalMonitor.mockImplementation(({ onHealthChange }) => {
      onHealthChange({ isConnected: false, isHealthy: false, lastEventAt: null, isStalled: false })
      return {
        dispose: vi.fn(),
        updateDirectories: vi.fn(),
        reconnect: vi.fn(),
        reportVisibility: vi.fn(),
      }
    })

    const TestComponent = () => {
      const { isConnected, isHealthy, isStalled } = useSSEHealth()
      return (
        <div>
          <div data-testid="connected">{String(isConnected)}</div>
          <div data-testid="healthy">{String(isHealthy)}</div>
          <div data-testid="stalled">{String(isStalled)}</div>
        </div>
      )
    }

    render(<TestComponent />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(screen.getByTestId('connected')).toHaveTextContent('false')
      expect(screen.getByTestId('healthy')).toHaveTextContent('false')
    })
  })

  it('does not re-render consumers for health notifications that only change lastEventAt', async () => {
    let onHealthChange: (state: { isConnected: boolean; isHealthy: boolean; lastEventAt: number | null; isStalled: boolean }) => void = () => {}
    mocks.subscribeGlobalMonitor.mockImplementation(({ onHealthChange: handler }) => {
      onHealthChange = handler
      return {
        dispose: vi.fn(),
        updateDirectories: vi.fn(),
        reconnect: vi.fn(),
        reportVisibility: vi.fn(),
      }
    })

    let renderCount = 0

    const Probe = () => {
      renderCount += 1
      const { isConnected } = useSSEHealth()
      return <div data-testid="probe-connected">{String(isConnected)}</div>
    }

    render(<Probe />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(screen.getByTestId('probe-connected')).toHaveTextContent('false')
    })
    const initialRenderCount = renderCount

    act(() => {
      onHealthChange({ isConnected: true, isHealthy: true, lastEventAt: 1, isStalled: false })
    })

    await waitFor(() => {
      expect(screen.getByTestId('probe-connected')).toHaveTextContent('true')
    })
    const afterBooleanChange = renderCount

    act(() => {
      onHealthChange({ isConnected: true, isHealthy: true, lastEventAt: 2, isStalled: false })
      onHealthChange({ isConnected: true, isHealthy: true, lastEventAt: 3, isStalled: false })
    })

    expect(afterBooleanChange).toBe(initialRenderCount + 1)
    expect(renderCount).toBe(afterBooleanChange)
  })
})
