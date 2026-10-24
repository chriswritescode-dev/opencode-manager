import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState, type ReactNode } from 'react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FormInfo, PermissionRequest } from '@opencode-manager/shared/opencode'
import { FetchError } from '@opencode-manager/shared'
import { showToast } from '@/lib/toast'
import { useSessionStatus, hasBackgroundActivity } from '@/stores/sessionStatusStore'
import { changeWalkthroughQueryKey } from '@/hooks/useChangeWalkthrough'
import { EventProvider, selectActiveSessionDirectoriesKey, useEventContext, useForms, usePermissions, useSSEHealth } from './EventContext'

const mocks = vi.hoisted(() => ({
  listRepos: vi.fn(),
  listPendingPermissions: vi.fn(),
  listPendingForms: vi.fn(),
  listActiveSessions: vi.fn(),
  listShells: vi.fn(),
  getSession: vi.fn(),
  replyPermission: vi.fn(),
  replyForm: vi.fn(),
  cancelForm: vi.fn(),
  subscribeGlobalMonitor: vi.fn(),
  getHealth: vi.fn(),
  listProjects: vi.fn(),
  servers: [] as Array<{ id: string; enabled: boolean }>,
  serversLoaded: false,
  isAuthenticated: true,
}))

vi.mock('@/api/repos', () => ({
  listRepos: mocks.listRepos,
}))

vi.mock('@/api/opencode', () => ({
  listActiveSessions: mocks.listActiveSessions,
  listPendingPermissions: mocks.listPendingPermissions,
  listPendingForms: mocks.listPendingForms,
  listProjects: mocks.listProjects,
  listShells: mocks.listShells,
  getSession: mocks.getSession,
  replyPermission: mocks.replyPermission,
  replyForm: mocks.replyForm,
  cancelForm: mocks.cancelForm,
}))

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ isAuthenticated: mocks.isAuthenticated }),
}))

vi.mock('@/hooks/useOpenCodeServers', () => ({
  useOpenCodeServers: () => ({ servers: mocks.servers, isSuccess: mocks.serversLoaded }),
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

const sourcedPermission: PermissionRequest = {
  id: 'permission-3',
  sessionID: 'session-1',
  action: 'shell',
  resources: ['echo hello'],
  metadata: {},
  source: { type: 'tool', messageID: 'msg_1', id: 'call_1' },
}

const viewedSessionPermission: PermissionRequest = {
  id: 'permission-view',
  sessionID: 'session-view',
  action: 'shell',
  resources: ['echo view'],
  metadata: {},
}

const otherSessionPermission: PermissionRequest = {
  id: 'permission-other',
  sessionID: 'session-other',
  action: 'shell',
  resources: ['echo other'],
  metadata: {},
}

const childSessionPermission: PermissionRequest = {
  id: 'permission-child',
  sessionID: 'child-1',
  action: 'shell',
  resources: ['echo child'],
  metadata: {},
}

const viewedSessionForm: FormInfo = {
  id: 'form-view',
  sessionID: 'session-view',
  title: 'Continue view',
  fields: [
    { key: 'q0', title: 'Confirm', type: 'string', options: [{ value: 'Yes', label: 'Yes' }] },
  ],
}

const otherSessionForm: FormInfo = {
  id: 'form-other',
  sessionID: 'session-other',
  title: 'Continue other',
  fields: [
    { key: 'q0', title: 'Confirm', type: 'string', options: [{ value: 'Yes', label: 'Yes' }] },
  ],
}

const childSessionForm: FormInfo = {
  id: 'form-child',
  sessionID: 'child-1',
  title: 'Continue child',
  fields: [
    { key: 'q0', title: 'Confirm', type: 'string', options: [{ value: 'Yes', label: 'Yes' }] },
  ],
}

function Harness() {
  const { current, pendingCount, syncForSession, navigateToCurrent, cancel, reply, getForSession } = useForms()
  const permissions = usePermissions()
  const location = useLocation()
  const [rejection, setRejection] = useState('none')
  const recordRejection = (action: Promise<void>) => {
    action.catch((error: unknown) => setRejection(error instanceof FetchError ? error.code ?? 'unknown' : 'unknown'))
  }

  return (
    <div>
      <div data-testid="rejection">{rejection}</div>
      <div data-testid="count">{pendingCount}</div>
      <div data-testid="current">{current?.id ?? 'none'}</div>
      <div data-testid="for-session-1">{getForSession('session-1')?.id ?? 'none'}</div>
      <div data-testid="for-session-2">{getForSession('session-2')?.id ?? 'none'}</div>
      <div data-testid="for-session-unknown">{getForSession('session-unknown')?.id ?? 'none'}</div>
      <div data-testid="permission-count">{permissions.pendingCount}</div>
      <div data-testid="permission-current">{permissions.current?.id ?? 'none'}</div>
      <div data-testid="permission-directory">{permissions.currentDirectory ?? 'none'}</div>
      <div data-testid="permission-different">{String(permissions.currentIsFromDifferentSession)}</div>
      <div data-testid="permission-tool-call">{permissions.getForToolCall('call_1', 'msg_1')?.id ?? 'none'}</div>
      <div data-testid="permission-tool-call-other-message">
        {permissions.getForToolCall('call_1', 'msg_other')?.id ?? 'none'}
      </div>
      <div data-testid="permission-tool-call-other-id">
        {permissions.getForToolCall('call_other', 'msg_1')?.id ?? 'none'}
      </div>
      <div data-testid="path">{location.pathname}</div>
      <div data-testid="search">{location.search}</div>
      <div data-testid="location-key">{location.key}</div>
      <button onClick={() => syncForSession('/repo', 'session-1')}>Sync</button>
      <button onClick={() => permissions.syncForSession('/repo', 'session-1')}>Sync Permissions</button>
      <button onClick={navigateToCurrent}>Navigate</button>
      <button onClick={permissions.navigateToCurrent}>Navigate Permission</button>
      <button onClick={() => current && recordRejection(cancel(current.id))}>Dismiss</button>
      <button onClick={() => current && recordRejection(reply(current.id, { q0: 'Yes' }))}>Reply</button>
      <button onClick={() => permissions.current && recordRejection(permissions.respond(permissions.current.id, permissions.current.sessionID, 'reject'))}>Reject Permission</button>
      <button onClick={() => permissions.current && permissions.respond(permissions.current.id, permissions.current.sessionID, 'reject', 'not allowed')}>Reject Permission With Reason</button>
    </div>
  )
}

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function createWrapper(queryClient = createTestQueryClient(), initialPath = '/') {
  return ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[initialPath]}>
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
    window.history.pushState({}, '', '/')
    mocks.isAuthenticated = true
    mocks.listRepos.mockResolvedValue([])
    mocks.listProjects.mockResolvedValue([])
    mocks.servers = []
    mocks.serversLoaded = false
    mocks.listPendingPermissions.mockResolvedValue([])
    mocks.listPendingForms.mockResolvedValue([])
    mocks.listActiveSessions.mockResolvedValue({})
    mocks.listShells.mockResolvedValue([])
    mocks.getSession.mockRejectedValue(new Error('Session not found'))
    mocks.replyPermission.mockResolvedValue(undefined)
    mocks.replyForm.mockResolvedValue(undefined)
    mocks.cancelForm.mockResolvedValue(undefined)
    mocks.getHealth.mockReturnValue({ isConnected: false, isHealthy: false, lastEventAt: null, isStalled: false })
    useSessionStatus.setState({ statuses: new Map(), statusCache: new Map(), statusRevisions: new Map(), knownSessions: new Set(), outcomes: new Map(), parents: new Map(), directories: new Map(), sessionServers: new Map(), runningShells: new Map(), shellRevisions: new Map(), shellRevision: 0, revision: 0 })
    mocks.subscribeGlobalMonitor.mockReturnValue({
      dispose: vi.fn(),
      updateDirectories: vi.fn(),
      reconnect: vi.fn(),
      reportVisibility: vi.fn(),
    })
  })

  it('defers authenticated bootstrap reads and the event stream until a session exists', () => {
    mocks.isAuthenticated = false

    render(<Harness />, { wrapper: createWrapper() })

    expect(mocks.listRepos).not.toHaveBeenCalled()
    expect(mocks.subscribeGlobalMonitor).not.toHaveBeenCalled()
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

  it('records the session directory for a pending permission loaded without an SSE status event', async () => {
    mocks.listRepos.mockResolvedValue([{ id: 123, fullPath: '/repo' }])
    mocks.listPendingPermissions.mockResolvedValue([pendingPermission])

    render(<Harness />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(useSessionStatus.getState().directories.get('session-1')).toBe('/repo')
    })
    expect(useSessionStatus.getState().statuses.has('session-1')).toBe(false)
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
      expect(mocks.replyPermission).toHaveBeenCalledWith('session-1', 'permission-1', 'reject', undefined, 'local')
      expect(screen.getByTestId('permission-count')).toHaveTextContent('1')
      expect(screen.getByTestId('permission-current')).toHaveTextContent('permission-2')
    })
  })

  it('removes a permission the server no longer knows about when replying', async () => {
    mocks.listPendingPermissions.mockResolvedValue([pendingPermission])
    mocks.replyPermission.mockRejectedValue(new FetchError('Permission request not found', 404, 'PermissionNotFoundError'))

    render(<Harness />, { wrapper: createWrapper() })

    await userEvent.click(screen.getByRole('button', { name: 'Sync Permissions' }))

    await waitFor(() => expect(screen.getByTestId('permission-count')).toHaveTextContent('1'))

    await userEvent.click(screen.getByRole('button', { name: 'Reject Permission' }))

    await waitFor(() => {
      expect(screen.getByTestId('permission-count')).toHaveTextContent('0')
      expect(screen.getByTestId('permission-current')).toHaveTextContent('none')
    })
    expect(showToast.info).toHaveBeenCalledWith('Permission request expired')
    expect(screen.getByTestId('rejection')).toHaveTextContent('none')
  })

  it('keeps a permission and rejects when the reply fails for another reason', async () => {
    mocks.listPendingPermissions.mockResolvedValue([pendingPermission])
    mocks.replyPermission.mockRejectedValue(new FetchError('Session not found', 404, 'SessionNotFoundError'))

    render(<Harness />, { wrapper: createWrapper() })

    await userEvent.click(screen.getByRole('button', { name: 'Sync Permissions' }))

    await waitFor(() => expect(screen.getByTestId('permission-count')).toHaveTextContent('1'))

    await userEvent.click(screen.getByRole('button', { name: 'Reject Permission' }))

    await waitFor(() => expect(screen.getByTestId('rejection')).toHaveTextContent('SessionNotFoundError'))
    expect(screen.getByTestId('permission-count')).toHaveTextContent('1')
    expect(screen.getByTestId('permission-current')).toHaveTextContent('permission-1')
    expect(showToast.info).not.toHaveBeenCalled()
  })

  it.each([
    ['Reply', 'replyForm'],
    ['Dismiss', 'cancelForm'],
  ] as const)('removes a form the server no longer knows about on %s', async (button, mock) => {
    mocks.listPendingForms.mockResolvedValue([pendingForm])
    mocks[mock].mockRejectedValue(new FetchError('Form not found', 404, 'FormNotFoundError'))

    render(<Harness />, { wrapper: createWrapper() })

    await userEvent.click(screen.getByRole('button', { name: 'Sync' }))

    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('1'))

    await userEvent.click(screen.getByRole('button', { name: button }))

    await waitFor(() => {
      expect(screen.getByTestId('count')).toHaveTextContent('0')
      expect(screen.getByTestId('current')).toHaveTextContent('none')
    })
    expect(showToast.info).toHaveBeenCalledWith('Form expired')
    expect(screen.getByTestId('rejection')).toHaveTextContent('none')
  })

  it.each([
    ['Reply', 'replyForm'],
    ['Dismiss', 'cancelForm'],
  ] as const)('keeps a form and rejects when %s fails for another reason', async (button, mock) => {
    mocks.listPendingForms.mockResolvedValue([pendingForm])
    mocks[mock].mockRejectedValue(new FetchError('Form already settled', 409, 'FormAlreadySettledError'))

    render(<Harness />, { wrapper: createWrapper() })

    await userEvent.click(screen.getByRole('button', { name: 'Sync' }))

    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('1'))

    await userEvent.click(screen.getByRole('button', { name: button }))

    await waitFor(() => expect(screen.getByTestId('rejection')).toHaveTextContent('FormAlreadySettledError'))
    expect(screen.getByTestId('count')).toHaveTextContent('1')
    expect(screen.getByTestId('current')).toHaveTextContent('form-1')
    expect(showToast.info).not.toHaveBeenCalled()
  })

  it('forwards an optional rejection message to the facade', async () => {
    mocks.listPendingPermissions.mockResolvedValue([pendingPermission])

    render(<Harness />, { wrapper: createWrapper() })

    await userEvent.click(screen.getByRole('button', { name: 'Sync Permissions' }))

    await waitFor(() => expect(screen.getByTestId('permission-count')).toHaveTextContent('1'))

    await userEvent.click(screen.getByRole('button', { name: 'Reject Permission With Reason' }))

    await waitFor(() =>
      expect(mocks.replyPermission).toHaveBeenCalledWith('session-1', 'permission-1', 'reject', 'not allowed', 'local'),
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

  it('reconciles a remembered remote directory on reconnect', async () => {
    mocks.servers = [{ id: 'srv_remote', enabled: true }]
    mocks.serversLoaded = true

    render(<Harness />, { wrapper: createWrapper() })

    await waitFor(() => expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled())

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onEvent = lastSubscribeCall[0].onEvent as (data: unknown) => void
    const handleStatusChange = lastSubscribeCall[0].onStatusChange as (connected: boolean) => void

    act(() => {
      onEvent({ type: 'form.created', data: { form: pendingForm }, directory: '/srv/app', serverId: 'srv_remote' })
    })

    await waitFor(() => {
      expect(screen.getByTestId('count')).toHaveTextContent('1')
    })

    act(() => {
      handleStatusChange(true)
    })

    await waitFor(() => {
      expect(mocks.listPendingForms).toHaveBeenCalledWith('/srv/app', 'srv_remote')
      expect(screen.getByTestId('count')).toHaveTextContent('0')
      expect(screen.getByTestId('current')).toHaveTextContent('none')
    })
  })

  it('reconciles a linked server enabled after the browser stream connects', async () => {
    const busySessionID = 'session-remote-busy'
    mocks.listActiveSessions.mockImplementation((serverId?: string) =>
      Promise.resolve(serverId === 'srv_remote' ? { [busySessionID]: {} } : {}),
    )

    const { rerender } = render(<Harness />, { wrapper: createWrapper() })

    await waitFor(() => expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled())
    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const handleStatusChange = lastSubscribeCall[0].onStatusChange as (connected: boolean) => void

    act(() => {
      handleStatusChange(true)
    })

    expect(mocks.listActiveSessions).not.toHaveBeenCalledWith('srv_remote')

    mocks.servers = [{ id: 'srv_remote', enabled: true }]
    rerender(<Harness />)

    await waitFor(() => {
      expect(useSessionStatus.getState().statuses.get(busySessionID)).toEqual({ type: 'busy' })
    })
    const remoteFetches = () =>
      mocks.listActiveSessions.mock.calls.filter(([serverId]) => serverId === 'srv_remote')
    expect(remoteFetches()).toHaveLength(1)

    await userEvent.click(screen.getByRole('button', { name: 'Sync' }))
    mocks.servers = [{ id: 'srv_remote', enabled: true }]
    rerender(<Harness />)

    expect(remoteFetches()).toHaveLength(1)
  })

  it('clears settled pending actions on an upstream resync while the browser stream stays connected', async () => {
    mocks.listRepos.mockResolvedValue([{ id: 123, fullPath: '/repo' }])
    mocks.listPendingPermissions.mockResolvedValue([])
    mocks.listPendingForms.mockResolvedValue([])

    render(<Harness />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(mocks.listPendingPermissions).toHaveBeenCalledWith('/repo', 'local')
      expect(mocks.listPendingForms).toHaveBeenCalledWith('/repo', 'local')
    })
    await act(async () => {
      await Promise.resolve()
    })

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onEvent = lastSubscribeCall[0].onEvent as (data: unknown) => void
    const onResync = lastSubscribeCall[0].onResync as ((directories: string[]) => void) | undefined

    act(() => {
      onEvent({ type: 'permission.asked', data: pendingPermission, directory: '/repo' })
      onEvent({ type: 'form.created', data: { form: pendingForm }, directory: '/repo' })
    })

    await waitFor(() => {
      expect(screen.getByTestId('permission-count')).toHaveTextContent('1')
      expect(screen.getByTestId('count')).toHaveTextContent('1')
    })

    act(() => {
      onResync?.([])
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
    const onResync = lastSubscribeCall[0].onResync as ((directories: string[]) => void) | undefined

    act(() => {
      onEvent({ type: 'permission.asked', data: pendingPermission, directory: '/repo' })
      onEvent({ type: 'form.created', data: { form: pendingForm }, directory: '/repo' })
    })

    await waitFor(() => {
      expect(screen.getByTestId('permission-count')).toHaveTextContent('1')
      expect(screen.getByTestId('count')).toHaveTextContent('1')
    })

    act(() => {
      onResync?.([])
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
      expect(mocks.listPendingPermissions).toHaveBeenCalledWith('/repo', 'local')
      expect(mocks.listPendingForms).toHaveBeenCalledWith('/repo', 'local')
    })
    await act(async () => {
      await Promise.resolve()
    })

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onEvent = lastSubscribeCall[0].onEvent as (data: unknown) => void
    const onResync = lastSubscribeCall[0].onResync as ((directories: string[]) => void) | undefined

    act(() => {
      onEvent({ type: 'permission.asked', data: pendingPermission, directory: '/worktrees/wt-1' })
    })

    await waitFor(() => {
      expect(screen.getByTestId('permission-count')).toHaveTextContent('1')
    })

    act(() => {
      onResync?.([])
    })

    await waitFor(() => {
      expect(mocks.listPendingPermissions).toHaveBeenCalledWith('/worktrees/wt-1', 'local')
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

  it('navigates an assistant-session permission to the assistant session path', async () => {
    mocks.listRepos.mockResolvedValue([{ id: 0, fullPath: '/assistant' }])

    render(<Harness />, { wrapper: createWrapper() })

    await waitFor(() => expect(mocks.listPendingPermissions).toHaveBeenCalledWith('/assistant', 'local'))

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onEvent = lastSubscribeCall[0].onEvent as (data: unknown) => void

    act(() => {
      onEvent({ type: 'permission.asked', data: pendingPermission, directory: '/assistant' })
    })

    await waitFor(() => {
      expect(screen.getByTestId('permission-current')).toHaveTextContent('permission-1')
    })

    await userEvent.click(screen.getByRole('button', { name: 'Navigate Permission' }))

    await waitFor(() => {
      expect(screen.getByTestId('path')).toHaveTextContent('/repos/0/sessions/session-1')
      expect(screen.getByTestId('search')).toHaveTextContent('?assistant=1')
    })
  })

  it('navigates a normal-repo permission without the assistant query', async () => {
    mocks.listRepos.mockResolvedValue([{ id: 123, fullPath: '/repo' }])

    render(<Harness />, { wrapper: createWrapper() })

    await waitFor(() => expect(mocks.listPendingPermissions).toHaveBeenCalledWith('/repo', 'local'))

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onEvent = lastSubscribeCall[0].onEvent as (data: unknown) => void

    act(() => {
      onEvent({ type: 'permission.asked', data: pendingPermission, directory: '/repo' })
    })

    await waitFor(() => {
      expect(screen.getByTestId('permission-current')).toHaveTextContent('permission-1')
    })

    await userEvent.click(screen.getByRole('button', { name: 'Navigate Permission' }))

    await waitFor(() => {
      expect(screen.getByTestId('path')).toHaveTextContent('/repos/123/sessions/session-1')
    })
    expect(screen.getByTestId('search').textContent).toBe('')
  })

  it('navigates a linked-server permission without a Manager repo for its directory', async () => {
    render(<Harness />, { wrapper: createWrapper() })

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onEvent = lastSubscribeCall[0].onEvent as (data: unknown) => void

    act(() => {
      onEvent({ type: 'permission.asked', data: pendingPermission, directory: '/srv/app', serverId: 'srv_kitchen' })
    })

    await waitFor(() => {
      expect(screen.getByTestId('permission-current')).toHaveTextContent('permission-1')
    })

    await userEvent.click(screen.getByRole('button', { name: 'Navigate Permission' }))

    await waitFor(() => {
      expect(screen.getByTestId('path')).toHaveTextContent('/servers/srv_kitchen/sessions/session-1')
    })
    expect(screen.getByTestId('search').textContent).toBe('')
  })

  it('navigates a linked-server form to its server session route', async () => {
    render(<Harness />, { wrapper: createWrapper() })

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onEvent = lastSubscribeCall[0].onEvent as (data: unknown) => void

    act(() => {
      onEvent({ type: 'form.created', data: { form: pendingForm }, directory: '/srv/app', serverId: 'srv_kitchen' })
    })

    await waitFor(() => {
      expect(screen.getByTestId('current')).toHaveTextContent('form-1')
    })

    await userEvent.click(screen.getByRole('button', { name: 'Navigate' }))

    await waitFor(() => {
      expect(screen.getByTestId('path')).toHaveTextContent('/servers/srv_kitchen/sessions/session-1')
    })
  })

  it('does not navigate when already on the target session path', async () => {
    mocks.listRepos.mockResolvedValue([{ id: 123, fullPath: '/repo' }])
    window.history.pushState({}, '', '/repos/123/sessions/session-1')

    render(<Harness />, {
      wrapper: createWrapper(createTestQueryClient(), '/repos/123/sessions/session-1'),
    })

    await waitFor(() => expect(mocks.listPendingPermissions).toHaveBeenCalledWith('/repo', 'local'))

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onEvent = lastSubscribeCall[0].onEvent as (data: unknown) => void

    act(() => {
      onEvent({ type: 'permission.asked', data: pendingPermission, directory: '/repo' })
    })

    await waitFor(() => {
      expect(screen.getByTestId('permission-current')).toHaveTextContent('permission-1')
    })

    const keyBefore = screen.getByTestId('location-key').textContent

    await userEvent.click(screen.getByRole('button', { name: 'Navigate Permission' }))

    expect(screen.getByTestId('location-key')).toHaveTextContent(keyBefore ?? '')
    expect(screen.getByTestId('path')).toHaveTextContent('/repos/123/sessions/session-1')
  })

  it('navigates an assistant-session form to the assistant session path', async () => {
    mocks.listRepos.mockResolvedValue([{ id: 0, fullPath: '/repo' }])
    mocks.listPendingForms.mockResolvedValue([pendingForm])

    render(<Harness />, { wrapper: createWrapper() })

    await userEvent.click(screen.getByRole('button', { name: 'Sync' }))

    await waitFor(() => {
      expect(screen.getByTestId('current')).toHaveTextContent('form-1')
    })

    await userEvent.click(screen.getByRole('button', { name: 'Navigate' }))

    await waitFor(() => {
      expect(screen.getByTestId('path')).toHaveTextContent('/repos/0/sessions/session-1')
      expect(screen.getByTestId('search')).toHaveTextContent('?assistant=1')
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
      expect(mocks.cancelForm).toHaveBeenCalledWith('session-1', 'form-1', 'local')
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
      expect(mocks.replyForm).toHaveBeenCalledWith('session-1', 'form-1', { q0: 'Yes' }, 'local')
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

  it('resolves a pending permission by its source tool call and message', async () => {
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
        data: sourcedPermission,
        directory: '/repo',
      })
    })

    await waitFor(() => {
      expect(screen.getByTestId('permission-tool-call')).toHaveTextContent('permission-3')
    })
    expect(screen.getByTestId('permission-tool-call-other-message')).toHaveTextContent('none')
    expect(screen.getByTestId('permission-tool-call-other-id')).toHaveTextContent('none')
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

  it('clears pending forms and permissions for a deleted session', async () => {
    render(<Harness />, { wrapper: createWrapper() })

    await waitFor(() => expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled())

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onEvent = lastSubscribeCall[0].onEvent as (data: unknown) => void

    act(() => {
      onEvent({ type: 'form.created', data: { form: pendingForm }, directory: '/repo' })
      onEvent({ type: 'permission.asked', data: pendingPermission, directory: '/repo' })
    })

    await waitFor(() => {
      expect(screen.getByTestId('count')).toHaveTextContent('1')
      expect(screen.getByTestId('permission-count')).toHaveTextContent('1')
    })

    act(() => {
      onEvent({ type: 'session.deleted', data: { sessionID: 'session-1' }, directory: '/repo' })
    })

    await waitFor(() => {
      expect(screen.getByTestId('count')).toHaveTextContent('0')
      expect(screen.getByTestId('permission-count')).toHaveTextContent('0')
      expect(screen.getByTestId('current')).toHaveTextContent('none')
      expect(screen.getByTestId('permission-current')).toHaveTextContent('none')
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
  ])('invalidates provider caches on a location-less %s event', async (type) => {
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

    await waitFor(() => {
      for (const queryKey of [
        ['provider-credentials'],
        ['provider-auth-methods'],
        ['opencode', 'providers'],
      ]) {
        expect(invalidateQueries).toHaveBeenCalledWith({ queryKey })
      }
    })
    expect(invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ['providers'] })
    expect(invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ['providers-for-execution-model'] })
  })

  it('collapses a burst of provider events into a single provider invalidation flush', async () => {
    const queryClient = createTestQueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')

    render(<Harness />, { wrapper: createWrapper(queryClient) })

    await waitFor(() => expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled())
    invalidateQueries.mockClear()

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onEvent = lastSubscribeCall[0].onEvent as (data: unknown) => void

    act(() => {
      onEvent({ type: 'credential.updated', data: {} })
      onEvent({ type: 'provider.updated', data: {} })
      onEvent({ type: 'model.updated', data: {} })
      onEvent({ type: 'integration.updated', data: {} })
      onEvent({ type: 'credential.switched', data: {} })
      onEvent({ type: 'provider.updated', data: {} })
    })

    await waitFor(() => {
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['opencode', 'providers'] })
    })
    expect(invalidateQueries).toHaveBeenCalledTimes(3)
  })

  it.each<[string, string[]]>([
    ['agent.updated', ['opencode', 'agents']],
    ['command.updated', ['opencode', 'commands']],
    ['skill.updated', ['opencode', 'skills']],
  ])('invalidates the %s cache', async (type, queryKey) => {
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

    await waitFor(() => {
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey })
    })
  })

  it('invalidates the location catalog caches on an upstream resync', async () => {
    const queryClient = createTestQueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')

    render(<Harness />, { wrapper: createWrapper(queryClient) })

    await waitFor(() => expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled())
    invalidateQueries.mockClear()

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onResync = lastSubscribeCall[0].onResync as ((directories: string[]) => void) | undefined

    act(() => {
      onResync?.([])
    })

    await waitFor(() => {
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['opencode', 'commands'] })
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['opencode', 'agents'] })
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['opencode', 'skills'] })
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['opencode', 'providers'] })
    })
  })

  it('invalidates the location catalog caches when the browser stream reconnects', async () => {
    const queryClient = createTestQueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')

    render(<Harness />, { wrapper: createWrapper(queryClient) })

    await waitFor(() => expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled())
    invalidateQueries.mockClear()

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const handleStatusChange = lastSubscribeCall[0].onStatusChange as (connected: boolean) => void

    act(() => {
      handleStatusChange(false)
      handleStatusChange(true)
    })

    await waitFor(() => {
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['opencode', 'commands'] })
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['opencode', 'agents'] })
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['opencode', 'skills'] })
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['opencode', 'providers'] })
    })
  })

  it('invalidates both config caches on config.updated', async () => {
    const queryClient = createTestQueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')

    render(<Harness />, { wrapper: createWrapper(queryClient) })

    await waitFor(() => expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled())
    invalidateQueries.mockClear()

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onEvent = lastSubscribeCall[0].onEvent as (data: unknown) => void

    act(() => {
      onEvent({ type: 'config.updated', data: {} })
    })

    await waitFor(() => {
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['opencode', 'config'] })
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['opencode-config'] })
    })
  })

  it('invalidates the sibling caches when a branch changes outside a repo row', async () => {
    mocks.listRepos.mockResolvedValue([])

    const queryClient = createTestQueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')

    render(<Harness />, { wrapper: createWrapper(queryClient) })

    await waitFor(() => expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled())
    invalidateQueries.mockClear()

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onEvent = lastSubscribeCall[0].onEvent as (data: unknown) => void

    act(() => {
      onEvent({ type: 'vcs.branch.updated', data: { branch: 'feature' }, directory: '/repos/a/.worktrees/feat' })
    })

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['repo', 'siblings'] })
  })

  it('updates the repo branch and refreshes the sibling caches on vcs.branch.updated', async () => {
    mocks.listRepos.mockResolvedValue([{ id: 1, fullPath: '/repo-a' }])

    const updateDirectories = vi.fn()
    mocks.subscribeGlobalMonitor.mockReturnValue({
      dispose: vi.fn(),
      updateDirectories,
      reconnect: vi.fn(),
      reportVisibility: vi.fn(),
    })

    const queryClient = createTestQueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')

    render(<Harness />, { wrapper: createWrapper(queryClient) })

    await waitFor(() => expect(queryClient.getQueryData(['repos'])).toBeDefined())
    await waitFor(() => expect(updateDirectories).toHaveBeenCalledWith(expect.arrayContaining(['/repo-a'])))
    invalidateQueries.mockClear()

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onEvent = lastSubscribeCall[0].onEvent as (data: unknown) => void

    act(() => {
      onEvent({ type: 'vcs.branch.updated', data: { branch: 'feature' }, directory: '/repo-a' })
    })

    expect(queryClient.getQueryData<{ currentBranch?: string; branch?: string }>(['repo', 1]))
      .toMatchObject({ currentBranch: 'feature', branch: 'feature' })
    await waitFor(() => {
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['repo', 'siblings'] })
    })
  })

  it('reconciles every tracked directory concurrently on an upstream resync', async () => {
    mocks.listRepos.mockResolvedValue([
      { id: 1, fullPath: '/repo-a' },
      { id: 2, fullPath: '/repo-b' },
    ])

    render(<Harness />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(mocks.listPendingForms).toHaveBeenCalledWith('/repo-b', 'local')
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
    const onResync = lastSubscribeCall[0].onResync as ((directories: string[]) => void) | undefined

    act(() => {
      onResync?.([])
    })

    expect(mocks.listPendingPermissions).toHaveBeenCalledWith('/repo-a', 'local')
    expect(mocks.listPendingPermissions).toHaveBeenCalledWith('/repo-b', 'local')
    expect(mocks.listPendingForms).toHaveBeenCalledWith('/repo-a', 'local')
    expect(mocks.listPendingForms).toHaveBeenCalledWith('/repo-b', 'local')

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

  it('prioritizes the viewed session permission over an earlier unrelated one', async () => {
    render(<Harness />, {
      wrapper: createWrapper(createTestQueryClient(), '/repos/123/sessions/session-view'),
    })

    await waitFor(() => expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled())

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onEvent = lastSubscribeCall[0].onEvent as (data: unknown) => void

    act(() => {
      onEvent({ type: 'permission.asked', data: otherSessionPermission, directory: '/repo' })
      onEvent({ type: 'permission.asked', data: viewedSessionPermission, directory: '/repo' })
    })

    await waitFor(() => {
      expect(screen.getByTestId('permission-count')).toHaveTextContent('2')
      expect(screen.getByTestId('permission-current')).toHaveTextContent('permission-view')
    })
    expect(screen.getByTestId('permission-different')).toHaveTextContent('false')
  })

  it('prefers a descendant session permission when viewing its parent', async () => {
    act(() => {
      useSessionStatus.getState().setSessionParent('child-1', 'parent-1')
    })

    render(<Harness />, {
      wrapper: createWrapper(createTestQueryClient(), '/repos/123/sessions/parent-1'),
    })

    await waitFor(() => expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled())

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onEvent = lastSubscribeCall[0].onEvent as (data: unknown) => void

    act(() => {
      onEvent({ type: 'permission.asked', data: otherSessionPermission, directory: '/repo' })
      onEvent({ type: 'permission.asked', data: childSessionPermission, directory: '/repo' })
    })

    await waitFor(() => {
      expect(screen.getByTestId('permission-current')).toHaveTextContent('permission-child')
    })
    expect(screen.getByTestId('permission-different')).toHaveTextContent('false')
  })

  it('falls back to the first pending permission when the viewed session has none', async () => {
    render(<Harness />, {
      wrapper: createWrapper(createTestQueryClient(), '/repos/123/sessions/session-view'),
    })

    await waitFor(() => expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled())

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onEvent = lastSubscribeCall[0].onEvent as (data: unknown) => void

    act(() => {
      onEvent({ type: 'permission.asked', data: otherSessionPermission, directory: '/repo' })
      onEvent({ type: 'permission.asked', data: pendingPermission, directory: '/repo' })
    })

    await waitFor(() => {
      expect(screen.getByTestId('permission-count')).toHaveTextContent('2')
      expect(screen.getByTestId('permission-current')).toHaveTextContent('permission-other')
    })
    expect(screen.getByTestId('permission-different')).toHaveTextContent('true')
  })

  it('resolves the current permission directory from the query cache', async () => {
    mocks.listRepos.mockResolvedValue([{ id: 123, fullPath: '/repo' }])
    const queryClient = createTestQueryClient()
    queryClient.setQueryData(
      ['opencode', 'session', 'session-1', '/repo'],
      {
        id: 'session-1',
        projectID: 'proj-1',
        title: 'Fix permission dialog',
        location: { directory: '/repo' },
        time: { created: 1000, updated: 1000 },
      },
    )

    render(<Harness />, { wrapper: createWrapper(queryClient) })

    await waitFor(() => expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled())

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onEvent = lastSubscribeCall[0].onEvent as (data: unknown) => void

    act(() => {
      onEvent({ type: 'permission.asked', data: pendingPermission, directory: '/repo' })
    })

    await waitFor(() => {
      expect(screen.getByTestId('permission-current')).toHaveTextContent('permission-1')
      expect(screen.getByTestId('permission-directory')).toHaveTextContent('/repo')
    })
  })

  it('replaces a pinned out-of-view permission with the viewed-session one, then advances to the remaining pinned one', async () => {
    render(<Harness />, {
      wrapper: createWrapper(createTestQueryClient(), '/repos/123/sessions/session-view'),
    })

    await waitFor(() => expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled())

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onEvent = lastSubscribeCall[0].onEvent as (data: unknown) => void

    act(() => {
      onEvent({ type: 'permission.asked', data: otherSessionPermission, directory: '/repo' })
    })

    await waitFor(() => {
      expect(screen.getByTestId('permission-current')).toHaveTextContent('permission-other')
    })

    act(() => {
      onEvent({ type: 'permission.asked', data: viewedSessionPermission, directory: '/repo' })
    })

    await waitFor(() => {
      expect(screen.getByTestId('permission-count')).toHaveTextContent('2')
      expect(screen.getByTestId('permission-current')).toHaveTextContent('permission-view')
    })

    act(() => {
      onEvent({
        type: 'permission.replied',
        data: { sessionID: 'session-view', requestID: 'permission-view', reply: 'reject' },
        directory: '/repo',
      })
    })

    await waitFor(() => {
      expect(screen.getByTestId('permission-count')).toHaveTextContent('1')
      expect(screen.getByTestId('permission-current')).toHaveTextContent('permission-other')
    })
  })

  it('keeps a shown in-view permission when another in-view permission arrives', async () => {
    act(() => {
      useSessionStatus.getState().setSessionParent('child-1', 'session-view')
    })

    render(<Harness />, {
      wrapper: createWrapper(createTestQueryClient(), '/repos/123/sessions/session-view'),
    })

    await waitFor(() => expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled())

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onEvent = lastSubscribeCall[0].onEvent as (data: unknown) => void

    act(() => {
      onEvent({ type: 'permission.asked', data: viewedSessionPermission, directory: '/repo' })
    })

    await waitFor(() => {
      expect(screen.getByTestId('permission-current')).toHaveTextContent('permission-view')
    })

    act(() => {
      onEvent({ type: 'permission.asked', data: childSessionPermission, directory: '/repo' })
    })

    await waitFor(() => {
      expect(screen.getByTestId('permission-count')).toHaveTextContent('2')
    })
    expect(screen.getByTestId('permission-current')).toHaveTextContent('permission-view')
  })

  it('prioritizes the viewed session form over an earlier unrelated one', async () => {
    render(<Harness />, {
      wrapper: createWrapper(createTestQueryClient(), '/repos/123/sessions/session-view'),
    })

    await waitFor(() => expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled())

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onEvent = lastSubscribeCall[0].onEvent as (data: unknown) => void

    act(() => {
      onEvent({ type: 'form.created', data: { form: otherSessionForm }, directory: '/repo' })
      onEvent({ type: 'form.created', data: { form: viewedSessionForm }, directory: '/repo' })
    })

    await waitFor(() => {
      expect(screen.getByTestId('count')).toHaveTextContent('2')
      expect(screen.getByTestId('current')).toHaveTextContent('form-view')
    })
  })

  it('prefers a descendant session form when viewing its parent', async () => {
    act(() => {
      useSessionStatus.getState().setSessionParent('child-1', 'parent-1')
    })

    render(<Harness />, {
      wrapper: createWrapper(createTestQueryClient(), '/repos/123/sessions/parent-1'),
    })

    await waitFor(() => expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled())

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onEvent = lastSubscribeCall[0].onEvent as (data: unknown) => void

    act(() => {
      onEvent({ type: 'form.created', data: { form: otherSessionForm }, directory: '/repo' })
      onEvent({ type: 'form.created', data: { form: childSessionForm }, directory: '/repo' })
    })

    await waitFor(() => {
      expect(screen.getByTestId('current')).toHaveTextContent('form-child')
    })
  })

  it('falls back to the first pending form when the viewed session has none', async () => {
    render(<Harness />, {
      wrapper: createWrapper(createTestQueryClient(), '/repos/123/sessions/session-view'),
    })

    await waitFor(() => expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled())

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onEvent = lastSubscribeCall[0].onEvent as (data: unknown) => void

    act(() => {
      onEvent({ type: 'form.created', data: { form: otherSessionForm }, directory: '/repo' })
      onEvent({ type: 'form.created', data: { form: pendingForm }, directory: '/repo' })
    })

    await waitFor(() => {
      expect(screen.getByTestId('count')).toHaveTextContent('2')
      expect(screen.getByTestId('current')).toHaveTextContent('form-other')
    })
  })

  it('replaces a pinned out-of-view form with the viewed-session one, then advances to the remaining pinned one', async () => {
    render(<Harness />, {
      wrapper: createWrapper(createTestQueryClient(), '/repos/123/sessions/session-view'),
    })

    await waitFor(() => expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled())

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onEvent = lastSubscribeCall[0].onEvent as (data: unknown) => void

    act(() => {
      onEvent({ type: 'form.created', data: { form: otherSessionForm }, directory: '/repo' })
    })

    await waitFor(() => {
      expect(screen.getByTestId('current')).toHaveTextContent('form-other')
    })

    act(() => {
      onEvent({ type: 'form.created', data: { form: viewedSessionForm }, directory: '/repo' })
    })

    await waitFor(() => {
      expect(screen.getByTestId('count')).toHaveTextContent('2')
      expect(screen.getByTestId('current')).toHaveTextContent('form-view')
    })

    act(() => {
      onEvent({
        type: 'form.cancelled',
        data: { id: 'form-view', sessionID: 'session-view' },
        directory: '/repo',
      })
    })

    await waitFor(() => {
      expect(screen.getByTestId('count')).toHaveTextContent('1')
      expect(screen.getByTestId('current')).toHaveTextContent('form-other')
    })
  })

  it('resolves ancestry when a permission arrives for an unknown session', async () => {
    mocks.getSession.mockImplementation((sessionID: string) => {
      if (sessionID === 'child-1') return Promise.resolve({ id: 'child-1', parentID: 'parent-1', location: { directory: '/repo' } })
      if (sessionID === 'parent-1') return Promise.resolve({ id: 'parent-1', location: { directory: '/repo' } })
      return Promise.reject(new Error('Session not found'))
    })

    render(<Harness />, {
      wrapper: createWrapper(createTestQueryClient(), '/repos/123/sessions/parent-1'),
    })

    await waitFor(() => expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled())

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onEvent = lastSubscribeCall[0].onEvent as (data: unknown) => void

    act(() => {
      onEvent({ type: 'permission.asked', data: childSessionPermission, directory: '/repo' })
    })

    await waitFor(() => {
      expect(mocks.getSession).toHaveBeenCalledWith('child-1', 'local')
      expect(useSessionStatus.getState().parents.get('child-1')).toBe('parent-1')
    })
    expect(screen.getByTestId('permission-current')).toHaveTextContent('permission-child')
    expect(screen.getByTestId('permission-different')).toHaveTextContent('false')
  })

  it('resolves ancestry when a form arrives for an unknown session', async () => {
    mocks.getSession.mockImplementation((sessionID: string) => {
      if (sessionID === 'child-1') return Promise.resolve({ id: 'child-1', parentID: 'parent-1', location: { directory: '/repo' } })
      if (sessionID === 'parent-1') return Promise.resolve({ id: 'parent-1', location: { directory: '/repo' } })
      return Promise.reject(new Error('Session not found'))
    })

    render(<Harness />, {
      wrapper: createWrapper(createTestQueryClient(), '/repos/123/sessions/parent-1'),
    })

    await waitFor(() => expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled())

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onEvent = lastSubscribeCall[0].onEvent as (data: unknown) => void

    act(() => {
      onEvent({ type: 'form.created', data: { form: childSessionForm }, directory: '/repo' })
    })

    await waitFor(() => {
      expect(mocks.getSession).toHaveBeenCalledWith('child-1', 'local')
      expect(useSessionStatus.getState().parents.get('child-1')).toBe('parent-1')
    })
    expect(screen.getByTestId('current')).toHaveTextContent('form-child')
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

  it('applies a session.status event from the global monitor to the status store', async () => {
    render(<Harness />, { wrapper: createWrapper() })

    await waitFor(() => expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled())

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onEvent = lastSubscribeCall[0].onEvent as (data: unknown) => void

    act(() => {
      onEvent({
        type: 'session.status',
        data: { sessionID: 'session-9', status: { type: 'busy' } },
        directory: '/repo',
      })
    })

    expect(useSessionStatus.getState().getStatus('session-9')).toEqual({ type: 'busy' })
  })

  it('applies execution lifecycle and idle events from the global monitor to the status store', async () => {
    render(<Harness />, { wrapper: createWrapper() })

    await waitFor(() => expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled())

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onEvent = lastSubscribeCall[0].onEvent as (data: unknown) => void

    act(() => {
      onEvent({ type: 'session.execution.started', data: { sessionID: 'session-9' }, directory: '/repo' })
    })
    expect(useSessionStatus.getState().getStatus('session-9')).toEqual({ type: 'busy' })

    act(() => {
      onEvent({ type: 'session.execution.succeeded', data: { sessionID: 'session-9' }, directory: '/repo' })
    })
    expect(useSessionStatus.getState().getStatus('session-9')).toEqual({ type: 'idle' })

    act(() => {
      onEvent({ type: 'session.execution.started', data: { sessionID: 'session-9' }, directory: '/repo' })
      onEvent({ type: 'session.idle', data: { sessionID: 'session-9' }, directory: '/repo' })
    })
    expect(useSessionStatus.getState().getStatus('session-9')).toEqual({ type: 'idle' })
  })

  it.each([
    ['session.execution.succeeded', { sessionID: 'session-9' }],
    ['session.execution.failed', { sessionID: 'session-9', error: { message: 'boom' } }],
    ['session.execution.interrupted', { sessionID: 'session-9', reason: 'user' }],
  ] as const)('invalidates the change walkthrough query on %s', async (type, data) => {
    const queryClient = createTestQueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')

    render(<Harness />, { wrapper: createWrapper(queryClient) })

    await waitFor(() => expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled())
    invalidateQueries.mockClear()

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onEvent = lastSubscribeCall[0].onEvent as (data: unknown) => void

    act(() => {
      onEvent({ type, data, directory: '/repo' })
    })

    await waitFor(() => {
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: changeWalkthroughQueryKey('session-9') })
    })
  })

  it('marks a child session as known from its execution lifecycle events', async () => {
    render(<Harness />, { wrapper: createWrapper() })

    await waitFor(() => expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled())

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onEvent = lastSubscribeCall[0].onEvent as (data: unknown) => void

    act(() => {
      onEvent({ type: 'session.execution.started', data: { sessionID: 'child-1' }, directory: '/repo' })
    })

    expect(useSessionStatus.getState().knownSessions.has('child-1')).toBe(true)
    expect(useSessionStatus.getState().knownSessions.has('child-unknown')).toBe(false)
  })

  it('does not treat a child omitted from a global snapshot as finished', async () => {
    mocks.listRepos.mockResolvedValue([{ id: 123, fullPath: '/repo' }])
    mocks.listActiveSessions.mockResolvedValue({})

    render(<Harness />, { wrapper: createWrapper() })

    await waitFor(() => expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled())

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onEvent = lastSubscribeCall[0].onEvent as (data: unknown) => void
    const onResync = lastSubscribeCall[0].onResync as ((directories: string[]) => void) | undefined

    act(() => {
      onEvent({ type: 'session.execution.started', data: { sessionID: 'child-1' }, directory: '/repo' })
    })
    expect(useSessionStatus.getState().getStatus('child-1')).toEqual({ type: 'busy' })

    act(() => {
      onResync?.([])
    })

    await waitFor(() => {
      expect(useSessionStatus.getState().knownSessions.has('child-1')).toBe(false)
    })
  })

  it('records a failed child outcome and preserves it when the child goes idle', async () => {
    render(<Harness />, { wrapper: createWrapper() })

    await waitFor(() => expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled())

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onEvent = lastSubscribeCall[0].onEvent as (data: unknown) => void

    act(() => {
      onEvent({ type: 'session.execution.started', data: { sessionID: 'child-1' }, directory: '/repo' })
      onEvent({ type: 'session.execution.failed', data: { sessionID: 'child-1', error: { message: 'boom' } }, directory: '/repo' })
    })

    expect(useSessionStatus.getState().outcomes.get('child-1')).toBe('failed')
    expect(useSessionStatus.getState().getStatus('child-1')).toEqual({ type: 'idle' })

    act(() => {
      onEvent({ type: 'session.idle', data: { sessionID: 'child-1' }, directory: '/repo' })
    })

    expect(useSessionStatus.getState().outcomes.get('child-1')).toBe('failed')
  })

  it('records an interrupted child outcome', async () => {
    render(<Harness />, { wrapper: createWrapper() })

    await waitFor(() => expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled())

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onEvent = lastSubscribeCall[0].onEvent as (data: unknown) => void

    act(() => {
      onEvent({ type: 'session.execution.interrupted', data: { sessionID: 'child-1', reason: 'user' }, directory: '/repo' })
    })

    expect(useSessionStatus.getState().outcomes.get('child-1')).toBe('interrupted')
    expect(useSessionStatus.getState().getStatus('child-1')).toEqual({ type: 'idle' })
  })

  it('does not turn a failed child into completed across a reconnect snapshot', async () => {
    mocks.listRepos.mockResolvedValue([{ id: 123, fullPath: '/repo' }])
    mocks.listActiveSessions.mockResolvedValue({})

    render(<Harness />, { wrapper: createWrapper() })

    await waitFor(() => expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled())

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onEvent = lastSubscribeCall[0].onEvent as (data: unknown) => void
    const handleStatusChange = lastSubscribeCall[0].onStatusChange as (connected: boolean) => void

    act(() => {
      onEvent({ type: 'session.execution.failed', data: { sessionID: 'child-1', error: { message: 'boom' } }, directory: '/repo' })
    })
    expect(useSessionStatus.getState().outcomes.get('child-1')).toBe('failed')

    act(() => {
      handleStatusChange(true)
    })

    await waitFor(() => {
      expect(useSessionStatus.getState().outcomes.get('child-1')).toBe('failed')
      expect(useSessionStatus.getState().getStatus('child-1')).toEqual({ type: 'idle' })
      expect(useSessionStatus.getState().knownSessions.has('child-1')).toBe(true)
    })
  })

  it('clears a previous child outcome when a new execution starts', async () => {
    render(<Harness />, { wrapper: createWrapper() })

    await waitFor(() => expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled())

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onEvent = lastSubscribeCall[0].onEvent as (data: unknown) => void

    act(() => {
      onEvent({ type: 'session.execution.failed', data: { sessionID: 'child-1', error: { message: 'boom' } }, directory: '/repo' })
      onEvent({ type: 'session.execution.started', data: { sessionID: 'child-1' }, directory: '/repo' })
    })

    expect(useSessionStatus.getState().outcomes.get('child-1')).toBeUndefined()
  })

  it('forgets a deleted session status, knowledge, and outcome while keeping the list invalidation', async () => {
    const queryClient = createTestQueryClient()
    queryClient.setQueryData(['opencode', 'sessions', '/repo'], { pages: [], pageParams: [] })

    render(<Harness />, { wrapper: createWrapper(queryClient) })

    await waitFor(() => expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled())

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onEvent = lastSubscribeCall[0].onEvent as (data: unknown) => void

    act(() => {
      onEvent({ type: 'session.execution.failed', data: { sessionID: 'child-1', error: { message: 'boom' } }, directory: '/repo' })
    })
    expect(useSessionStatus.getState().outcomes.get('child-1')).toBe('failed')
    expect(useSessionStatus.getState().knownSessions.has('child-1')).toBe(true)

    act(() => {
      onEvent({ type: 'session.deleted', data: { sessionID: 'child-1' }, directory: '/repo' })
    })

    const after = useSessionStatus.getState()
    expect(after.statuses.has('child-1')).toBe(false)
    expect(after.knownSessions.has('child-1')).toBe(false)
    expect(after.outcomes.has('child-1')).toBe(false)

    await waitFor(() => {
      expect(queryClient.getQueryState(['opencode', 'sessions', '/repo'])?.isInvalidated).toBe(true)
    })
  })

  it('invalidates only the reconciliation of children that moved from busy to unknown during a poll', async () => {
    mocks.listRepos.mockResolvedValue([{ id: 123, fullPath: '/repo' }])
    mocks.listActiveSessions
      .mockResolvedValueOnce({ 'child-1': { type: 'running' }, 'child-2': { type: 'running' } })
      .mockResolvedValue({ 'child-2': { type: 'running' } })

    const queryClient = createTestQueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    queryClient.setQueryData(['opencode', 'session-reconcile', 'child-1'], { id: 'child-1' })
    queryClient.setQueryData(['opencode', 'session-reconcile', 'child-2'], { id: 'child-2' })

    render(<Harness />, { wrapper: createWrapper(queryClient) })

    await waitFor(() => expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled())

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const handleStatusChange = lastSubscribeCall[0].onStatusChange as (connected: boolean) => void

    vi.useFakeTimers()
    try {
      act(() => {
        handleStatusChange(true)
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(useSessionStatus.getState().knownSessions.has('child-1')).toBe(true)
      invalidateQueries.mockClear()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000)
      })

      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['opencode', 'session-reconcile', 'child-1'],
      })
      expect(invalidateQueries).not.toHaveBeenCalledWith({
        queryKey: ['opencode', 'session-reconcile', 'child-2'],
      })
      expect(invalidateQueries).not.toHaveBeenCalledWith({
        queryKey: ['opencode', 'session-reconcile'],
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('reconciles the global active snapshot on reconnect and clears omitted sessions', async () => {
    mocks.listRepos.mockResolvedValue([{ id: 123, fullPath: '/repo' }])
    mocks.listActiveSessions.mockResolvedValue({ 'session-other': { type: 'running' } })

    render(<Harness />, { wrapper: createWrapper() })

    await waitFor(() => expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled())

    act(() => {
      useSessionStatus.getState().setStatus('session-other', { type: 'busy' })
      useSessionStatus.getState().setStatus('session-stale', { type: 'busy' })
    })

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const handleStatusChange = lastSubscribeCall[0].onStatusChange as (connected: boolean) => void

    act(() => {
      handleStatusChange(true)
    })

    await waitFor(() => {
      expect(useSessionStatus.getState().getStatus('session-other')).toEqual({ type: 'busy' })
      expect(useSessionStatus.getState().getStatus('session-stale')).toEqual({ type: 'idle' })
    })
  })

  it('ignores a superseded connect snapshot that resolves after a newer reconnect snapshot', async () => {
    mocks.listRepos.mockResolvedValue([{ id: 123, fullPath: '/repo' }])

    const first = createDeferred<Record<string, unknown>>()
    const second = createDeferred<Record<string, unknown>>()
    mocks.listActiveSessions
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)

    render(<Harness />, { wrapper: createWrapper() })

    await waitFor(() => expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled())

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const handleStatusChange = lastSubscribeCall[0].onStatusChange as (connected: boolean) => void

    act(() => {
      handleStatusChange(true)
    })
    expect(mocks.listActiveSessions).toHaveBeenCalledTimes(1)

    act(() => {
      handleStatusChange(false)
      handleStatusChange(true)
    })
    expect(mocks.listActiveSessions).toHaveBeenCalledTimes(2)

    await act(async () => {
      second.resolve({ 'session-new': { type: 'running' } })
      await second.promise
    })
    await waitFor(() => {
      expect(useSessionStatus.getState().getStatus('session-new')).toEqual({ type: 'busy' })
    })

    await act(async () => {
      first.resolve({ 'session-old': { type: 'running' } })
      await first.promise
    })

    expect(useSessionStatus.getState().getStatus('session-new')).toEqual({ type: 'busy' })
    expect(useSessionStatus.getState().getStatus('session-old')).toEqual({ type: 'idle' })
  })

  it('does not apply a global snapshot that resolves after unmount', async () => {
    mocks.listRepos.mockResolvedValue([{ id: 123, fullPath: '/repo' }])

    const deferred = createDeferred<Record<string, unknown>>()
    mocks.listActiveSessions.mockReturnValueOnce(deferred.promise)

    const { unmount } = render(<Harness />, { wrapper: createWrapper() })

    await waitFor(() => expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled())

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const handleStatusChange = lastSubscribeCall[0].onStatusChange as (connected: boolean) => void

    act(() => {
      handleStatusChange(true)
    })
    expect(mocks.listActiveSessions).toHaveBeenCalledTimes(1)

    unmount()

    await act(async () => {
      deferred.resolve({ 'session-late': { type: 'running' } })
      await deferred.promise
    })

    expect(useSessionStatus.getState().getStatus('session-late')).toEqual({ type: 'idle' })
  })

  it('does not let a deferred connect snapshot revert an idle event received while it was in flight', async () => {
    mocks.listRepos.mockResolvedValue([{ id: 123, fullPath: '/repo' }])

    const deferred = createDeferred<Record<string, unknown>>()
    mocks.listActiveSessions.mockReturnValueOnce(deferred.promise)

    render(<Harness />, { wrapper: createWrapper() })

    await waitFor(() => expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled())

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onEvent = lastSubscribeCall[0].onEvent as (data: unknown) => void
    const handleStatusChange = lastSubscribeCall[0].onStatusChange as (connected: boolean) => void

    act(() => {
      handleStatusChange(true)
    })
    expect(mocks.listActiveSessions).toHaveBeenCalledTimes(1)

    act(() => {
      onEvent({ type: 'session.status', data: { sessionID: 'session-a', status: { type: 'busy' } }, directory: '/repo' })
      onEvent({ type: 'session.idle', data: { sessionID: 'session-a' }, directory: '/repo' })
    })

    await act(async () => {
      deferred.resolve({ 'session-a': { type: 'running' } })
      await deferred.promise
    })

    expect(useSessionStatus.getState().getStatus('session-a')).toEqual({ type: 'idle' })
  })

  it('does not let a deferred empty connect snapshot erase a session that started while it was in flight', async () => {
    mocks.listRepos.mockResolvedValue([{ id: 123, fullPath: '/repo' }])

    const deferred = createDeferred<Record<string, unknown>>()
    mocks.listActiveSessions.mockReturnValueOnce(deferred.promise)

    render(<Harness />, { wrapper: createWrapper() })

    await waitFor(() => expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled())

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onEvent = lastSubscribeCall[0].onEvent as (data: unknown) => void
    const handleStatusChange = lastSubscribeCall[0].onStatusChange as (connected: boolean) => void

    act(() => {
      handleStatusChange(true)
    })
    expect(mocks.listActiveSessions).toHaveBeenCalledTimes(1)

    act(() => {
      onEvent({ type: 'session.execution.started', data: { sessionID: 'session-a' }, directory: '/repo' })
    })

    await act(async () => {
      deferred.resolve({})
      await deferred.promise
    })

    expect(useSessionStatus.getState().getStatus('session-a')).toEqual({ type: 'busy' })
  })

  it('does not let a deferred connect snapshot resurrect an unknown session that went idle', async () => {
    mocks.listRepos.mockResolvedValue([{ id: 123, fullPath: '/repo' }])

    const deferred = createDeferred<Record<string, unknown>>()
    mocks.listActiveSessions.mockReturnValueOnce(deferred.promise)

    render(<Harness />, { wrapper: createWrapper() })

    await waitFor(() => expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled())

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onEvent = lastSubscribeCall[0].onEvent as (data: unknown) => void
    const handleStatusChange = lastSubscribeCall[0].onStatusChange as (connected: boolean) => void

    act(() => {
      handleStatusChange(true)
    })
    expect(mocks.listActiveSessions).toHaveBeenCalledTimes(1)

    act(() => {
      onEvent({ type: 'session.idle', data: { sessionID: 'session-unseen' }, directory: '/repo' })
    })

    await act(async () => {
      deferred.resolve({ 'session-unseen': { type: 'running' } })
      await deferred.promise
    })

    expect(useSessionStatus.getState().getStatus('session-unseen')).toEqual({ type: 'idle' })
  })

  it('debounces a session list invalidation on session lifecycle events', async () => {
    const queryClient = createTestQueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    queryClient.setQueryData(['opencode', 'sessions', '/repo'], { pages: [], pageParams: [] })

    render(<Harness />, { wrapper: createWrapper(queryClient) })

    await waitFor(() => expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled())

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onEvent = lastSubscribeCall[0].onEvent as (data: unknown) => void

    act(() => {
      onEvent({ type: 'session.created', data: { sessionID: 'session-9' }, directory: '/repo' })
      onEvent({ type: 'session.renamed', data: { sessionID: 'session-9', title: 'Renamed' }, directory: '/repo' })
      onEvent({ type: 'session.deleted', data: { sessionID: 'session-9' }, directory: '/repo' })
    })

    await waitFor(() => {
      expect(queryClient.getQueryState(['opencode', 'sessions', '/repo'])?.isInvalidated).toBe(true)
    })
    expect(invalidateQueries).toHaveBeenCalledTimes(1)
  })

  it('invalidates the session list when a session is forked', async () => {
    const queryClient = createTestQueryClient()
    queryClient.setQueryData(['opencode', 'sessions', '/repo'], { pages: [], pageParams: [] })

    render(<Harness />, { wrapper: createWrapper(queryClient) })

    await waitFor(() => expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled())

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onEvent = lastSubscribeCall[0].onEvent as (data: unknown) => void

    act(() => {
      onEvent({ type: 'session.forked', data: { sessionID: 'session-fork', parentID: 'session-9' }, directory: '/repo' })
    })

    await waitFor(() => {
      expect(queryClient.getQueryState(['opencode', 'sessions', '/repo'])?.isInvalidated).toBe(true)
    })
  })

  it('invalidates only the session list for the event directory', async () => {
    const queryClient = createTestQueryClient()
    queryClient.setQueryData(['opencode', 'sessions', '/repo-a'], { pages: [], pageParams: [] })
    queryClient.setQueryData(['opencode', 'sessions', '/repo-b'], { pages: [], pageParams: [] })

    render(<Harness />, { wrapper: createWrapper(queryClient) })

    await waitFor(() => expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled())

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onEvent = lastSubscribeCall[0].onEvent as (data: unknown) => void

    act(() => {
      onEvent({ type: 'session.created', data: { sessionID: 'session-9' }, directory: '/repo-a' })
    })

    await waitFor(() => {
      expect(queryClient.getQueryState(['opencode', 'sessions', '/repo-a'])?.isInvalidated).toBe(true)
    })
    expect(queryClient.getQueryState(['opencode', 'sessions', '/repo-b'])?.isInvalidated).toBe(false)
  })

  it('does not invalidate session lists on session.usage.updated', async () => {
    const queryClient = createTestQueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    queryClient.setQueryData(['opencode', 'sessions', '/repo'], { pages: [], pageParams: [] })

    render(<Harness />, { wrapper: createWrapper(queryClient) })

    await waitFor(() => expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled())

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onEvent = lastSubscribeCall[0].onEvent as (data: unknown) => void
    invalidateQueries.mockClear()

    act(() => {
      onEvent({ type: 'session.usage.updated', data: { sessionID: 'session-9', cost: 0, tokens: {} }, directory: '/repo' })
    })

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300))
    })

    expect(invalidateQueries).not.toHaveBeenCalled()
    expect(queryClient.getQueryState(['opencode', 'sessions', '/repo'])?.isInvalidated).toBe(false)
  })

  it('fetches the active session snapshot on connect and polls every 5 seconds while connected', async () => {
    mocks.listRepos.mockResolvedValue([{ id: 123, fullPath: '/repo' }])
    mocks.listActiveSessions.mockResolvedValue({})

    render(<Harness />, { wrapper: createWrapper() })

    await waitFor(() => expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled())

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const handleStatusChange = lastSubscribeCall[0].onStatusChange as (connected: boolean) => void

    vi.useFakeTimers()
    try {
      act(() => {
        handleStatusChange(true)
      })
      expect(mocks.listActiveSessions).toHaveBeenCalledTimes(1)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000)
      })
      expect(mocks.listActiveSessions).toHaveBeenCalledTimes(2)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000)
      })
      expect(mocks.listActiveSessions).toHaveBeenCalledTimes(3)

      act(() => {
        handleStatusChange(false)
      })

      await act(async () => {
        await vi.advanceTimersByTimeAsync(15000)
      })
      expect(mocks.listActiveSessions).toHaveBeenCalledTimes(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops polling the active session snapshot after unmount', async () => {
    mocks.listRepos.mockResolvedValue([{ id: 123, fullPath: '/repo' }])
    mocks.listActiveSessions.mockResolvedValue({})

    const { unmount } = render(<Harness />, { wrapper: createWrapper() })

    await waitFor(() => expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled())

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const handleStatusChange = lastSubscribeCall[0].onStatusChange as (connected: boolean) => void

    vi.useFakeTimers()
    try {
      act(() => {
        handleStatusChange(true)
      })
      expect(mocks.listActiveSessions).toHaveBeenCalledTimes(1)

      unmount()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(15000)
      })
      expect(mocks.listActiveSessions).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('records the parent of a session created with a parentID', async () => {
    render(<Harness />, { wrapper: createWrapper() })

    await waitFor(() => expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled())

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onEvent = lastSubscribeCall[0].onEvent as (data: unknown) => void

    act(() => {
      onEvent({ type: 'session.created', data: { sessionID: 'child-1', parentID: 'parent-1' }, directory: '/repo' })
    })

    expect(useSessionStatus.getState().parents.get('child-1')).toBe('parent-1')
  })

  it('tracks a running background shell and clears it when it exits', async () => {
    render(<Harness />, { wrapper: createWrapper() })

    await waitFor(() => expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled())

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onEvent = lastSubscribeCall[0].onEvent as (data: unknown) => void

    act(() => {
      onEvent({
        type: 'shell.created',
        data: { info: { id: 'shell-1', status: 'running', metadata: { sessionID: 'session-1' } } },
        directory: '/repo',
      })
    })
    expect(useSessionStatus.getState().runningShells.get('shell-1')).toEqual({
      sessionID: 'session-1',
      directory: '/repo',
    })

    act(() => {
      onEvent({ type: 'shell.exited', data: { id: 'shell-1', status: 'exited' }, directory: '/repo' })
    })
    expect(useSessionStatus.getState().runningShells.has('shell-1')).toBe(false)
  })

  it('clears a running background shell when it is deleted', async () => {
    render(<Harness />, { wrapper: createWrapper() })

    await waitFor(() => expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled())

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onEvent = lastSubscribeCall[0].onEvent as (data: unknown) => void

    act(() => {
      onEvent({
        type: 'shell.created',
        data: { info: { id: 'shell-1', status: 'running', metadata: { sessionID: 'session-1' } } },
        directory: '/repo',
      })
    })
    expect(useSessionStatus.getState().runningShells.has('shell-1')).toBe(true)

    act(() => {
      onEvent({ type: 'shell.deleted', data: { id: 'shell-1' }, directory: '/repo' })
    })
    expect(useSessionStatus.getState().runningShells.has('shell-1')).toBe(false)
  })

  it('resolves active session ancestry from the snapshot, walking up to a known root', async () => {
    mocks.listRepos.mockResolvedValue([{ id: 123, fullPath: '/repo' }])
    mocks.listActiveSessions.mockResolvedValue({ 'child-1': { type: 'running' } })
    mocks.getSession.mockImplementation((sessionID: string) => {
      if (sessionID === 'child-1') return Promise.resolve({ id: 'child-1', parentID: 'parent-1', location: { directory: '/repo' } })
      if (sessionID === 'parent-1') return Promise.resolve({ id: 'parent-1', location: { directory: '/repo' } })
      return Promise.reject(new Error('Session not found'))
    })

    render(<Harness />, { wrapper: createWrapper() })

    await waitFor(() => expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled())

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const handleStatusChange = lastSubscribeCall[0].onStatusChange as (connected: boolean) => void

    act(() => {
      handleStatusChange(true)
    })

    await waitFor(() => {
      expect(useSessionStatus.getState().parents.get('child-1')).toBe('parent-1')
      expect(useSessionStatus.getState().parents.get('parent-1')).toBeNull()
    })
  })

  it('populates running shells from the directory snapshot on connect', async () => {
    mocks.listRepos.mockResolvedValue([{ id: 123, fullPath: '/repo' }])
    mocks.listShells.mockResolvedValue([
      { id: 'shell-1', status: 'running', metadata: { sessionID: 'session-1' } },
      { id: 'shell-2', status: 'exited', metadata: { sessionID: 'session-2' } },
    ])

    render(<Harness />, { wrapper: createWrapper() })

    await waitFor(() => expect(mocks.listPendingForms).toHaveBeenCalledWith('/repo', 'local'))

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const handleStatusChange = lastSubscribeCall[0].onStatusChange as (connected: boolean) => void

    act(() => {
      handleStatusChange(true)
    })

    await waitFor(() => {
      expect(mocks.listShells).toHaveBeenCalledWith('/repo', 'local')
      expect(useSessionStatus.getState().runningShells.get('shell-1')).toEqual({
        sessionID: 'session-1',
        directory: '/repo',
      })
      expect(useSessionStatus.getState().runningShells.has('shell-2')).toBe(false)
    })
  })

  it('does not let a directory shell snapshot resurrect a shell that exited while it was in flight', async () => {
    mocks.listRepos.mockResolvedValue([{ id: 123, fullPath: '/repo' }])
    const deferred = createDeferred<Array<{ id: string; status: string; metadata: { sessionID: string } }>>()
    mocks.listShells.mockReturnValue(deferred.promise)

    render(<Harness />, { wrapper: createWrapper() })

    await waitFor(() => expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled())

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onDirectoriesSubscribed = lastSubscribeCall[0].onDirectoriesSubscribed as (directories: string[]) => void
    const onEvent = lastSubscribeCall[0].onEvent as (data: unknown) => void

    act(() => {
      onDirectoriesSubscribed(['/repo'])
    })

    await waitFor(() => expect(mocks.listShells).toHaveBeenCalledWith('/repo', 'local'))

    act(() => {
      onEvent({ type: 'shell.exited', data: { id: 'shell-1', status: 'exited' }, directory: '/repo' })
    })

    await act(async () => {
      deferred.resolve([{ id: 'shell-1', status: 'running', metadata: { sessionID: 'session-1' } }])
      await deferred.promise
    })

    expect(useSessionStatus.getState().runningShells.has('shell-1')).toBe(false)
  })

  it('does not let a directory shell snapshot drop a shell created while it was in flight', async () => {
    mocks.listRepos.mockResolvedValue([{ id: 123, fullPath: '/repo' }])
    const deferred = createDeferred<Array<{ id: string; status: string; metadata: { sessionID: string } }>>()
    mocks.listShells.mockReturnValue(deferred.promise)

    render(<Harness />, { wrapper: createWrapper() })

    await waitFor(() => expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled())

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onDirectoriesSubscribed = lastSubscribeCall[0].onDirectoriesSubscribed as (directories: string[]) => void
    const onEvent = lastSubscribeCall[0].onEvent as (data: unknown) => void

    act(() => {
      onDirectoriesSubscribed(['/repo'])
    })

    await waitFor(() => expect(mocks.listShells).toHaveBeenCalledWith('/repo', 'local'))

    act(() => {
      onEvent({
        type: 'shell.created',
        data: { info: { id: 'shell-2', status: 'running', metadata: { sessionID: 'session-2' } } },
        directory: '/repo',
      })
    })

    await act(async () => {
      deferred.resolve([])
      await deferred.promise
    })

    expect(useSessionStatus.getState().runningShells.get('shell-2')).toEqual({
      sessionID: 'session-2',
      directory: '/repo',
    })
  })

  it('resolves ancestry for a shell owner from a newly subscribed directory snapshot', async () => {
    mocks.listRepos.mockResolvedValue([{ id: 123, fullPath: '/repo' }])
    mocks.listShells.mockResolvedValue([
      { id: 'shell-1', status: 'running', metadata: { sessionID: 'child-1' } },
    ])
    mocks.getSession.mockImplementation((sessionID: string) => {
      if (sessionID === 'child-1') return Promise.resolve({ id: 'child-1', parentID: 'parent-1', location: { directory: '/repo' } })
      if (sessionID === 'parent-1') return Promise.resolve({ id: 'parent-1', location: { directory: '/repo' } })
      return Promise.reject(new Error('Session not found'))
    })

    render(<Harness />, { wrapper: createWrapper() })

    await waitFor(() => expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled())

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onDirectoriesSubscribed = lastSubscribeCall[0].onDirectoriesSubscribed as (directories: string[]) => void

    act(() => {
      onDirectoriesSubscribed(['/repo'])
    })

    await waitFor(() => {
      expect(useSessionStatus.getState().parents.get('child-1')).toBe('parent-1')
    })

    expect(hasBackgroundActivity(useSessionStatus.getState(), 'parent-1')).toBe(true)
  })

  it('continues a known child to parent link up to the grandparent', async () => {
    mocks.listRepos.mockResolvedValue([{ id: 123, fullPath: '/repo' }])
    mocks.listActiveSessions.mockResolvedValue({ 'child-1': { type: 'running' } })
    mocks.getSession.mockImplementation((sessionID: string) => {
      if (sessionID === 'parent-1') return Promise.resolve({ id: 'parent-1', parentID: 'grandparent-1', location: { directory: '/repo' } })
      if (sessionID === 'grandparent-1') return Promise.resolve({ id: 'grandparent-1', location: { directory: '/repo' } })
      return Promise.reject(new Error('Session not found'))
    })

    act(() => {
      useSessionStatus.getState().setSessionParent('child-1', 'parent-1')
    })

    render(<Harness />, { wrapper: createWrapper() })

    await waitFor(() => expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled())

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const handleStatusChange = lastSubscribeCall[0].onStatusChange as (connected: boolean) => void

    act(() => {
      handleStatusChange(true)
    })

    await waitFor(() => {
      expect(useSessionStatus.getState().parents.get('parent-1')).toBe('grandparent-1')
      expect(useSessionStatus.getState().parents.get('grandparent-1')).toBeNull()
    })
    expect(mocks.getSession).toHaveBeenCalledWith('parent-1', 'local')
  })

  it('syncs running shells for a directory whose repo arrives after connect', async () => {
    const reposDeferred = createDeferred<Array<{ id: number; fullPath: string }>>()
    mocks.listRepos.mockReturnValueOnce(reposDeferred.promise)
    mocks.subscribeGlobalMonitor.mockImplementation((input: { onDirectoriesSubscribed?: (directories: string[]) => void }) => ({
      dispose: vi.fn(),
      updateDirectories: (directories: string[]) => input.onDirectoriesSubscribed?.(directories),
      reconnect: vi.fn(),
      reportVisibility: vi.fn(),
    }))

    render(<Harness />, { wrapper: createWrapper() })

    await waitFor(() => expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled())

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const handleStatusChange = lastSubscribeCall[0].onStatusChange as (connected: boolean) => void

    act(() => {
      handleStatusChange(true)
    })

    expect(mocks.listShells).not.toHaveBeenCalled()

    await act(async () => {
      reposDeferred.resolve([{ id: 123, fullPath: '/repo' }])
      await reposDeferred.promise
    })

    await waitFor(() => expect(mocks.listShells).toHaveBeenCalledWith('/repo', 'local'))
  })

  it('reconciles newly subscribed directories reported by the stream', async () => {
    mocks.listPendingPermissions.mockResolvedValue([pendingPermission])
    mocks.listPendingForms.mockResolvedValue([pendingForm])

    render(<Harness />, { wrapper: createWrapper() })

    await waitFor(() => expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled())

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onDirectoriesSubscribed = lastSubscribeCall[0].onDirectoriesSubscribed as (directories: string[]) => void

    act(() => {
      useSessionStatus.getState().setShellRunning('shell-stale', 'session-1', '/session-dir')
    })
    expect(useSessionStatus.getState().runningShells.has('shell-stale')).toBe(true)

    await act(async () => {
      onDirectoriesSubscribed(['/session-dir'])
    })

    await waitFor(() => {
      expect(mocks.listShells).toHaveBeenCalledWith('/session-dir', 'local')
      expect(mocks.listPendingPermissions).toHaveBeenCalledWith('/session-dir', 'local')
      expect(mocks.listPendingForms).toHaveBeenCalledWith('/session-dir', 'local')
    })
    expect(useSessionStatus.getState().runningShells.has('shell-stale')).toBe(false)
    expect(screen.getByTestId('permission-count').textContent).toBe('1')
    expect(screen.getByTestId('count').textContent).toBe('1')
  })

  it('reconciles subscribed directories reported by a resync even when they are not tracked', async () => {
    mocks.listPendingPermissions.mockResolvedValue([pendingPermission])
    mocks.listPendingForms.mockResolvedValue([pendingForm])

    render(<Harness />, { wrapper: createWrapper() })

    await waitFor(() => expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled())

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onResync = lastSubscribeCall[0].onResync as ((directories: string[]) => void) | undefined

    act(() => {
      useSessionStatus.getState().setShellRunning('shell-stale', 'session-1', '/unregistered-dir')
    })
    expect(useSessionStatus.getState().runningShells.has('shell-stale')).toBe(true)

    await act(async () => {
      onResync?.(['/unregistered-dir'])
    })

    await waitFor(() => {
      expect(mocks.listShells).toHaveBeenCalledWith('/unregistered-dir', 'local')
      expect(mocks.listPendingPermissions).toHaveBeenCalledWith('/unregistered-dir', 'local')
      expect(mocks.listPendingForms).toHaveBeenCalledWith('/unregistered-dir', 'local')
    })
    expect(useSessionStatus.getState().runningShells.has('shell-stale')).toBe(false)
    expect(screen.getByTestId('permission-count').textContent).toBe('1')
    expect(screen.getByTestId('count').textContent).toBe('1')
  })

  it('subscribes the directories of active sessions outside the repo directories', async () => {
    mocks.listRepos.mockResolvedValue([{ id: 123, fullPath: '/repo' }])
    const updateDirectories = vi.fn()
    mocks.subscribeGlobalMonitor.mockReturnValue({
      dispose: vi.fn(),
      updateDirectories,
      reconnect: vi.fn(),
      reportVisibility: vi.fn(),
    })

    render(<Harness />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(updateDirectories).toHaveBeenCalledWith(['/repo'])
    })

    act(() => {
      useSessionStatus.getState().setSessionDirectory('session-worktree', '/repo/.worktrees/feature')
      useSessionStatus.getState().setStatus('session-worktree', { type: 'busy' })
    })

    await waitFor(() => {
      expect(updateDirectories).toHaveBeenCalledWith(
        expect.arrayContaining(['/repo', '/repo/.worktrees/feature']),
      )
    })

    act(() => {
      useSessionStatus.getState().setStatus('session-worktree', { type: 'idle' })
    })

    await waitFor(() => {
      const calls = updateDirectories.mock.calls
      const lastDirectories = calls[calls.length - 1][0] as string[]
      expect(lastDirectories).toContain('/repo')
      expect(lastDirectories).not.toContain('/repo/.worktrees/feature')
    })
  })

  it('selects the server-keyed directory of an active remote session', () => {
    const key = selectActiveSessionDirectoriesKey({
      statuses: new Map([['remote-session', { type: 'busy' as const }]]),
      directories: new Map([['remote-session', 'srv_remote|/remote/repo']]),
      runningShells: new Map([
        ['shell-1', { sessionID: 'remote-session', directory: 'srv_remote|/remote/repo' }],
      ]),
    })

    expect(key).toBe('srv_remote|/remote/repo')
  })

  it('keys a remote session directory and routes its lookups to the remote server', async () => {
    mocks.listRepos.mockResolvedValue([{ id: 123, fullPath: '/repo' }])
    const updateDirectories = vi.fn()
    mocks.subscribeGlobalMonitor.mockReturnValue({
      dispose: vi.fn(),
      updateDirectories,
      reconnect: vi.fn(),
      reportVisibility: vi.fn(),
    })

    render(<Harness />, { wrapper: createWrapper() })

    await waitFor(() => expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled())

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onEvent = lastSubscribeCall[0].onEvent as (data: unknown) => void

    act(() => {
      onEvent({
        type: 'session.status',
        serverId: 'srv_remote',
        directory: '/remote/repo',
        data: { sessionID: 'remote-session', status: { type: 'busy' } },
      })
    })

    expect(useSessionStatus.getState().directories.get('remote-session')).toBe('srv_remote|/remote/repo')
    expect(useSessionStatus.getState().getStatus('remote-session')).toEqual({ type: 'busy' })

    await waitFor(() => {
      expect(updateDirectories).toHaveBeenCalledWith(expect.arrayContaining(['srv_remote|/remote/repo']))
    })

    const onDirectoriesSubscribed = lastSubscribeCall[0].onDirectoriesSubscribed as (directories: string[]) => void
    await act(async () => {
      onDirectoriesSubscribed(['srv_remote|/remote/repo'])
    })

    await waitFor(() => {
      expect(mocks.listPendingPermissions).toHaveBeenCalledWith('/remote/repo', 'srv_remote')
      expect(mocks.listPendingForms).toHaveBeenCalledWith('/remote/repo', 'srv_remote')
      expect(mocks.listShells).toHaveBeenCalledWith('/remote/repo', 'srv_remote')
    })
  })

  it('keeps a remote session busy across a local active-session snapshot', async () => {
    mocks.listRepos.mockResolvedValue([{ id: 123, fullPath: '/repo' }])
    mocks.listActiveSessions.mockResolvedValue({})

    render(<Harness />, { wrapper: createWrapper() })

    await waitFor(() => expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled())

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onEvent = lastSubscribeCall[0].onEvent as (data: unknown) => void
    const handleStatusChange = lastSubscribeCall[0].onStatusChange as (connected: boolean) => void

    act(() => {
      onEvent({
        type: 'session.status',
        serverId: 'srv_remote',
        data: { sessionID: 'remote-session', status: { type: 'busy' } },
      })
    })

    expect(useSessionStatus.getState().directories.has('remote-session')).toBe(false)

    vi.useFakeTimers()
    try {
      act(() => {
        handleStatusChange(true)
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000)
      })

      expect(mocks.listActiveSessions).toHaveBeenCalledTimes(2)
      expect(useSessionStatus.getState().getStatus('remote-session')).toEqual({ type: 'busy' })
      expect(useSessionStatus.getState().knownSessions.has('remote-session')).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('scopes a remote resync to that server and skips the local snapshot', async () => {
    const queryClient = createTestQueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')

    render(<Harness />, { wrapper: createWrapper(queryClient) })

    await waitFor(() => expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled())

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onEvent = lastSubscribeCall[0].onEvent as (data: unknown) => void
    const onResync = lastSubscribeCall[0].onResync as
      | ((directories: string[], serverId?: string) => void)
      | undefined

    mocks.listActiveSessions.mockImplementation((serverId?: string) =>
      Promise.resolve(serverId === 'srv_remote' ? { 'remote-session': { type: 'running' } } : {}),
    )
    act(() => {
      onEvent({ type: 'session.status', data: { sessionID: 'remote-session', status: { type: 'busy' } }, directory: '/remote/repo', serverId: 'srv_remote' })
    })
    await act(async () => {
      await Promise.resolve()
    })

    mocks.listActiveSessions.mockClear()
    mocks.listPendingPermissions.mockClear()
    mocks.listPendingForms.mockClear()
    mocks.listShells.mockClear()
    invalidateQueries.mockClear()

    await act(async () => {
      onResync?.(['/repo', 'srv_remote|/remote/repo'], 'srv_remote')
    })

    await waitFor(() => {
      expect(mocks.listPendingPermissions).toHaveBeenCalledWith('/remote/repo', 'srv_remote')
      expect(mocks.listPendingForms).toHaveBeenCalledWith('/remote/repo', 'srv_remote')
      expect(mocks.listShells).toHaveBeenCalledWith('/remote/repo', 'srv_remote')
    })
    expect(mocks.listActiveSessions).not.toHaveBeenCalledWith()
    expect(mocks.listActiveSessions).toHaveBeenCalledWith('srv_remote')
    expect(mocks.listPendingPermissions).not.toHaveBeenCalledWith('/repo', 'local')
    expect(mocks.listShells).not.toHaveBeenCalledWith('/repo', 'local')

    await waitFor(() => {
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['opencode', 'commands', 'srv_remote'] })
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['opencode', 'agents', 'srv_remote'] })
    })
    expect(invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ['opencode', 'commands'] })
  })

  it('reconciles only linked directories with active work on a remote resync', async () => {
    mocks.servers = [{ id: 'srv_remote', enabled: true }]
    mocks.listProjects.mockResolvedValue([
      { id: 'proj-busy', canonical: '/remote/busy' },
      { id: 'proj-idle', canonical: '/remote/idle' },
      { id: 'proj-other', canonical: '/remote/other' },
    ])
    mocks.listActiveSessions.mockImplementation((serverId?: string) =>
      Promise.resolve(serverId === 'srv_remote' ? { 'remote-busy': { type: 'running' } } : {}),
    )

    render(<Harness />, { wrapper: createWrapper() })

    await waitFor(() => expect(mocks.listProjects).toHaveBeenCalledWith('srv_remote'))
    await waitFor(() => expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled())

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onEvent = lastSubscribeCall[0].onEvent as (data: unknown) => void
    const onResync = lastSubscribeCall[0].onResync as
      | ((directories: string[], serverId?: string) => void)
      | undefined

    act(() => {
      onEvent({ type: 'session.status', data: { sessionID: 'remote-busy', status: { type: 'busy' } }, directory: '/remote/busy', serverId: 'srv_remote' })
    })
    await act(async () => {
      await Promise.resolve()
    })

    mocks.listPendingPermissions.mockClear()
    mocks.listPendingForms.mockClear()
    mocks.listShells.mockClear()

    await act(async () => {
      onResync?.(
        ['srv_remote|/remote/busy', 'srv_remote|/remote/idle', 'srv_remote|/remote/other'],
        'srv_remote',
      )
    })

    await waitFor(() => {
      expect(mocks.listPendingPermissions).toHaveBeenCalledWith('/remote/busy', 'srv_remote')
      expect(mocks.listPendingForms).toHaveBeenCalledWith('/remote/busy', 'srv_remote')
      expect(mocks.listShells).toHaveBeenCalledWith('/remote/busy', 'srv_remote')
    })
    expect(mocks.listPendingPermissions).not.toHaveBeenCalledWith('/remote/idle', 'srv_remote')
    expect(mocks.listPendingPermissions).not.toHaveBeenCalledWith('/remote/other', 'srv_remote')
    expect(mocks.listShells).not.toHaveBeenCalledWith('/remote/idle', 'srv_remote')
  })

  it('reconciles the viewed linked directory even when its session is idle', async () => {
    mocks.servers = [{ id: 'srv_remote', enabled: true }]
    mocks.listActiveSessions.mockResolvedValue({})

    render(<Harness />, {
      wrapper: createWrapper(createTestQueryClient(), '/servers/srv_remote/sessions/remote-viewed'),
    })

    await waitFor(() => expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled())

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onEvent = lastSubscribeCall[0].onEvent as (data: unknown) => void
    const onResync = lastSubscribeCall[0].onResync as
      | ((directories: string[], serverId?: string) => void)
      | undefined

    act(() => {
      onEvent({ type: 'session.status', data: { sessionID: 'remote-viewed', status: { type: 'idle' } }, directory: '/remote/viewed', serverId: 'srv_remote' })
    })
    await act(async () => {
      await Promise.resolve()
    })

    mocks.listPendingPermissions.mockClear()
    mocks.listShells.mockClear()

    await act(async () => {
      onResync?.(['srv_remote|/remote/viewed', 'srv_remote|/remote/idle'], 'srv_remote')
    })

    await waitFor(() => {
      expect(mocks.listPendingPermissions).toHaveBeenCalledWith('/remote/viewed', 'srv_remote')
      expect(mocks.listShells).toHaveBeenCalledWith('/remote/viewed', 'srv_remote')
    })
    expect(mocks.listPendingPermissions).not.toHaveBeenCalledWith('/remote/idle', 'srv_remote')
  })

  it('clears a stale remote busy status on a remote resync', async () => {
    mocks.listRepos.mockResolvedValue([{ id: 123, fullPath: '/repo' }])
    mocks.listActiveSessions.mockResolvedValue({})

    render(<Harness />, { wrapper: createWrapper() })

    await waitFor(() => expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled())

    act(() => {
      useSessionStatus.getState().setSessionServer('remote-session', 'srv_remote')
      useSessionStatus.getState().setStatus('remote-session', { type: 'busy' })
    })

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onResync = lastSubscribeCall[0].onResync as
      | ((directories: string[], serverId?: string) => void)
      | undefined

    await act(async () => {
      onResync?.(['srv_remote|/remote/repo'], 'srv_remote')
    })

    await waitFor(() => {
      expect(mocks.listActiveSessions).toHaveBeenCalledWith('srv_remote')
      expect(useSessionStatus.getState().getStatus('remote-session')).toEqual({ type: 'idle' })
    })
  })

  it('reconciles every enabled remote server when the browser stream reconnects', async () => {
    mocks.servers = [
      { id: 'srv_remote', enabled: true },
      { id: 'srv_disabled', enabled: false },
    ]
    mocks.listRepos.mockResolvedValue([{ id: 123, fullPath: '/repo' }])
    mocks.listActiveSessions.mockResolvedValue({})

    render(<Harness />, { wrapper: createWrapper() })

    await waitFor(() => expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled())

    act(() => {
      useSessionStatus.getState().setSessionServer('remote-session', 'srv_remote')
      useSessionStatus.getState().setStatus('remote-session', { type: 'busy' })
    })

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const handleStatusChange = lastSubscribeCall[0].onStatusChange as (connected: boolean) => void

    act(() => {
      handleStatusChange(true)
    })

    await waitFor(() => {
      expect(mocks.listActiveSessions).toHaveBeenCalledWith('srv_remote')
      expect(useSessionStatus.getState().getStatus('remote-session')).toEqual({ type: 'idle' })
    })
    expect(mocks.listActiveSessions).not.toHaveBeenCalledWith('srv_disabled')
  })

  it('purges pending actions from a server that is not enabled once servers load', async () => {
    const { rerender } = render(<Harness />, { wrapper: createWrapper() })

    await waitFor(() => expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled())

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onEvent = lastSubscribeCall[0].onEvent as (data: unknown) => void

    act(() => {
      onEvent({ type: 'form.created', data: { form: pendingForm }, directory: '/srv/app', serverId: 'srv_removed' })
      onEvent({ type: 'form.created', data: { form: secondPendingForm }, directory: '/srv/app', serverId: 'srv_remote' })
      onEvent({ type: 'permission.asked', data: pendingPermission, directory: '/srv/app', serverId: 'srv_removed' })
    })

    await waitFor(() => {
      expect(screen.getByTestId('count')).toHaveTextContent('2')
      expect(screen.getByTestId('permission-count')).toHaveTextContent('1')
    })

    mocks.servers = [{ id: 'srv_remote', enabled: true }]
    mocks.serversLoaded = true
    rerender(<Harness />)

    await waitFor(() => {
      expect(screen.getByTestId('count')).toHaveTextContent('1')
      expect(screen.getByTestId('permission-count')).toHaveTextContent('0')
    })
    expect(screen.getByTestId('for-session-2')).toHaveTextContent('form-2')
    expect(screen.getByTestId('for-session-1')).toHaveTextContent('none')
  })

  it('subscribes the project directories of enabled remote servers', async () => {
    mocks.servers = [{ id: 'srv_remote', enabled: true }]
    mocks.listProjects.mockResolvedValue([{ id: 'proj-1', canonical: '/remote/repo' }])
    const updateDirectories = vi.fn()
    mocks.subscribeGlobalMonitor.mockReturnValue({
      dispose: vi.fn(),
      updateDirectories,
      reconnect: vi.fn(),
      reportVisibility: vi.fn(),
    })

    render(<Harness />, { wrapper: createWrapper() })

    await waitFor(() => expect(mocks.listProjects).toHaveBeenCalledWith('srv_remote'))
    await waitFor(() => {
      expect(updateDirectories).toHaveBeenCalledWith(expect.arrayContaining(['srv_remote|/remote/repo']))
    })
  })

  it('does not fetch projects for disabled remote servers', async () => {
    mocks.servers = [{ id: 'srv_disabled', enabled: false }]

    render(<Harness />, { wrapper: createWrapper() })

    await waitFor(() => expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled())
    expect(mocks.listProjects).not.toHaveBeenCalled()
  })

  it('drops pending forms of a remote server that becomes unreachable', async () => {
    render(<Harness />, { wrapper: createWrapper() })

    await waitFor(() => expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled())

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onEvent = lastSubscribeCall[0].onEvent as (data: unknown) => void
    const onDirectoriesSubscribed = lastSubscribeCall[0].onDirectoriesSubscribed as (directories: string[]) => void

    act(() => {
      onEvent({ type: 'form.created', data: { form: pendingForm }, directory: '/srv/app', serverId: 'srv_remote' })
    })

    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('1'))

    mocks.listPendingForms.mockRejectedValue(new FetchError('Bad gateway', 502))

    await act(async () => {
      onDirectoriesSubscribed(['srv_remote|/srv/app'])
    })

    await waitFor(() => {
      expect(screen.getByTestId('count')).toHaveTextContent('0')
      expect(screen.getByTestId('current')).toHaveTextContent('none')
    })
  })

  it('drops a pending remote form whose session no longer exists on reconnect', async () => {
    mocks.servers = [{ id: 'srv_remote', enabled: true }]
    mocks.getSession.mockRejectedValue(new FetchError('Session not found', 404))

    render(<Harness />, { wrapper: createWrapper() })

    await waitFor(() => expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled())

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onEvent = lastSubscribeCall[0].onEvent as (data: unknown) => void
    const handleStatusChange = lastSubscribeCall[0].onStatusChange as (connected: boolean) => void

    act(() => {
      useSessionStatus.getState().setSessionParent('session-1', null)
      onEvent({ type: 'form.created', data: { form: pendingForm }, serverId: 'srv_remote' })
    })

    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('1'))

    act(() => {
      handleStatusChange(true)
    })

    await waitFor(() => {
      expect(mocks.getSession).toHaveBeenCalledWith('session-1', 'srv_remote')
      expect(screen.getByTestId('count')).toHaveTextContent('0')
      expect(screen.getByTestId('current')).toHaveTextContent('none')
    })
  })

  it('resolves an unknown remote session directory on reconnect', async () => {
    mocks.servers = [{ id: 'srv_remote', enabled: true }]
    mocks.getSession.mockImplementation((sessionID: string) =>
      sessionID === 'session-1'
        ? Promise.resolve({ id: 'session-1', location: { directory: '/srv/resolved' } })
        : Promise.reject(new FetchError('Session not found', 404)),
    )

    render(<Harness />, { wrapper: createWrapper() })

    await waitFor(() => expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled())

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const onEvent = lastSubscribeCall[0].onEvent as (data: unknown) => void
    const handleStatusChange = lastSubscribeCall[0].onStatusChange as (connected: boolean) => void

    act(() => {
      useSessionStatus.getState().setSessionParent('session-1', null)
      onEvent({ type: 'form.created', data: { form: pendingForm }, serverId: 'srv_remote' })
    })

    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('1'))
    expect(useSessionStatus.getState().directories.has('session-1')).toBe(false)

    act(() => {
      handleStatusChange(true)
    })

    await waitFor(() => {
      expect(mocks.listPendingForms).toHaveBeenCalledWith('/srv/resolved', 'srv_remote')
      expect(useSessionStatus.getState().directories.get('session-1')).toBe('srv_remote|/srv/resolved')
    })
  })

  it('reconciles pending actions for a remote server enabled after the browser stream connects', async () => {
    const { rerender } = render(<Harness />, { wrapper: createWrapper() })

    await waitFor(() => expect(mocks.subscribeGlobalMonitor).toHaveBeenCalled())

    const lastSubscribeCall = mocks.subscribeGlobalMonitor.mock.calls[mocks.subscribeGlobalMonitor.mock.calls.length - 1]
    const handleStatusChange = lastSubscribeCall[0].onStatusChange as (connected: boolean) => void

    act(() => {
      handleStatusChange(true)
    })

    act(() => {
      useSessionStatus.getState().setSessionDirectory('remote-session', 'srv_remote|/remote/repo')
      useSessionStatus.getState().setStatus('remote-session', { type: 'busy' })
    })

    mocks.servers = [{ id: 'srv_remote', enabled: true }]
    rerender(<Harness />)

    await waitFor(() => {
      expect(mocks.listPendingForms).toHaveBeenCalledWith('/remote/repo', 'srv_remote')
    })
  })
})
