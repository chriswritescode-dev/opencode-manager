import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLocation } from 'react-router-dom'
import type { FormInfo, GoalState, PermissionRequest } from '@opencode-manager/shared/opencode'
import type { SSHHostKeyRequest } from '@opencode-manager/shared/schemas'
import { FetchError } from '@opencode-manager/shared'
import type { OpenCodeProject, ShellInfo } from '@/api/opencode'
import type { Repo } from '@/api/types'
import type { OpenCodeServer } from '@opencode-manager/shared/schemas'
import { hasBackgroundActivity, useSessionStatus } from '@/stores/sessionStatusStore'
import { changeWalkthroughQueryKey } from '@/hooks/useChangeWalkthrough'
import type { TestEventStreamTransport } from '@/lib/opencode-event-stream'
import type { FetchFake, FetchRoute, FetchRouteResult, RecordedFetchRequest } from '@/test/fetchFake'
import type { JsonObject } from '@opencode-manager/shared/utils'
import { connectTestEventStream, createTestQueryClient, renderWithProviders } from '@/test/render'
import { authClient } from '@/lib/auth-client'
import { makeOpenCodeServer, makeRepo, makeSession } from '@/test/fixtures/api'
import {
  formCancelled,
  formCreated,
  formReplied,
  goalChanged,
  permissionAsked,
  permissionReplied,
  sessionCompactionEnded,
  sessionCompactionFailed,
  sessionCompactionStarted,
  sessionCreated,
  sessionDeleted,
  sessionExecutionFailed,
  sessionExecutionInterrupted,
  sessionExecutionStarted,
  sessionExecutionSucceeded,
  sessionForked,
  sessionIdle,
  sessionRenamed,
  sessionStatusUpdated,
  sessionUsageUpdated,
  shellCreated,
  shellDeleted,
  shellExited,
  simpleStreamEvent,
  sshHostKeyRequest,
  vcsBranchUpdated,
  type SimpleStreamEventType,
  type StreamEventContext,
} from '@/test/fixtures/events'
import {
  selectActiveSessionDirectoriesKey,
  useEventContext,
  useForms,
  usePermissions,
  useSSEHealth,
} from './event-context'

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
  const { sshHostKey } = useEventContext()
  const location = useLocation()
  const [rejection, setRejection] = useState('none')
  const recordRejection = (action: Promise<void>) => {
    action.catch((cause: unknown) => setRejection(cause instanceof FetchError ? cause.code ?? 'unknown' : 'unknown'))
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
      <div data-testid="ssh-host">{sshHostKey.request?.host ?? 'none'}</div>
      <button onClick={() => syncForSession('/repo', 'session-1')}>Sync</button>
      <button onClick={() => permissions.syncForSession('/repo', 'session-1')}>Sync Permissions</button>
      <button onClick={navigateToCurrent}>Navigate</button>
      <button onClick={permissions.navigateToCurrent}>Navigate Permission</button>
      <button onClick={() => current && recordRejection(cancel(current.id))}>Dismiss</button>
      <button onClick={() => current && recordRejection(reply(current.id, { q0: 'Yes' }))}>Reply</button>
      <button onClick={() => permissions.current && recordRejection(permissions.respond(permissions.current.id, permissions.current.sessionID, 'reject'))}>
        Reject Permission
      </button>
      <button onClick={() => permissions.current && permissions.respond(permissions.current.id, permissions.current.sessionID, 'reject', 'not allowed')}>
        Reject Permission With Reason
      </button>
    </div>
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

interface ApiState {
  repos: Repo[]
  projects: OpenCodeProject[]
  permissions: PermissionRequest[]
  forms: FormInfo[]
  active: Record<string, { type?: string }>
  shells: ShellInfo[]
  servers: OpenCodeServer[]
  sessions: Map<string, ReturnType<typeof makeSession>>
  permissionReply: FetchRouteResult
  formReply: FetchRouteResult
  formCancel: FetchRouteResult
  permissionsResponder: FetchRoute['respond'] | null
  formsResponder: FetchRoute['respond'] | null
  shellsResponder: FetchRoute['respond'] | null
  activeResponder: FetchRoute['respond'] | null
  sessionResponder: FetchRoute['respond'] | null
  serversResponder: FetchRoute['respond'] | null
}

function createApiState(overrides: Partial<ApiState> = {}): ApiState {
  return {
    repos: [],
    projects: [],
    permissions: [],
    forms: [],
    active: {},
    shells: [],
    servers: [],
    sessions: new Map(),
    permissionReply: { status: 204 },
    formReply: { status: 204 },
    formCancel: { status: 204 },
    permissionsResponder: null,
    formsResponder: null,
    shellsResponder: null,
    activeResponder: null,
    sessionResponder: null,
    serversResponder: null,
    ...overrides,
  }
}

const localApi = '/api/opencode/api'
const remoteApi = '/api/opencode/servers/:serverId/api'

function providerRoutes(state: ApiState): FetchRoute[] {
  return [
    { method: 'GET', path: '/api/repos', respond: () => ({ json: state.repos }) },
    { method: 'GET', path: '/api/opencode-servers', respond: () => state.serversResponder ? state.serversResponder(emptyRequest, {}, undefined) : ({ json: { servers: state.servers } }) },
    { method: 'GET', path: '/api/opencode/api/session/active', respond: () => state.activeResponder ? state.activeResponder(emptyRequest, {}, undefined) : ({ json: { data: state.active } }) },
    { method: 'GET', path: '/api/opencode/servers/:serverId/api/session/active', respond: () => ({ json: { data: {} } }) },
    { method: 'GET', path: `${localApi}/permission/request`, respond: () => state.permissionsResponder ? state.permissionsResponder(emptyRequest, {}, undefined) : ({ json: { data: state.permissions } }) },
    { method: 'GET', path: `${remoteApi}/permission/request`, respond: () => state.permissionsResponder ? state.permissionsResponder(emptyRequest, {}, undefined) : ({ json: { data: state.permissions } }) },
    { method: 'GET', path: `${localApi}/form`, respond: () => state.formsResponder ? state.formsResponder(emptyRequest, {}, undefined) : ({ json: { data: state.forms } }) },
    { method: 'GET', path: `${remoteApi}/form`, respond: () => state.formsResponder ? state.formsResponder(emptyRequest, {}, undefined) : ({ json: { data: state.forms } }) },
    { method: 'GET', path: `${localApi}/shell`, respond: () => state.shellsResponder ? state.shellsResponder(emptyRequest, {}, undefined) : ({ json: { data: state.shells } }) },
    { method: 'GET', path: `${remoteApi}/shell`, respond: () => state.shellsResponder ? state.shellsResponder(emptyRequest, {}, undefined) : ({ json: { data: state.shells } }) },
    { method: 'GET', path: `${remoteApi}/project`, respond: () => ({ json: state.projects }) },
    {
      method: 'GET',
      path: `${localApi}/session/:sessionID`,
      respond: (_request, params) => state.sessionResponder
        ? state.sessionResponder(emptyRequest, params, undefined)
        : sessionResponse(state, params.sessionID),
    },
    {
      method: 'GET',
      path: `${remoteApi}/session/:sessionID`,
      respond: (_request, params) => state.sessionResponder
        ? state.sessionResponder(emptyRequest, params, undefined)
        : sessionResponse(state, params.sessionID),
    },
    { method: 'POST', path: `${localApi}/session/:sessionID/permission/:permissionID/reply`, respond: () => state.permissionReply },
    { method: 'POST', path: `${localApi}/session/:sessionID/form/:formID/reply`, respond: () => state.formReply },
    { method: 'DELETE', path: `${localApi}/session/:sessionID/form/:formID`, respond: () => state.formCancel },
  ]
}

function sessionResponse(state: ApiState, sessionID: string): FetchRouteResult {
  const session = state.sessions.get(sessionID)
  if (!session) return { status: 404, json: { _tag: 'SessionNotFoundError', sessionID, message: 'Session not found' } }
  return { json: { data: session } }
}

const emptyRequest: RecordedFetchRequest = {
  method: 'GET',
  path: '',
  url: '',
  searchParams: new URLSearchParams(),
  headers: {},
  body: null,
}

interface RenderProviderOptions {
  route?: string
  api?: Partial<ApiState>
  queryClient?: ReturnType<typeof createTestQueryClient>
  auth?: 'anonymous' | 'authenticated'
  fakeTimers?: boolean
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

type ActiveSnapshot = Record<string, { type?: string }>

async function settleInvalidations(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 250))
  })
}

function snapshotResponder(...snapshots: Array<Promise<ActiveSnapshot> | ActiveSnapshot>): FetchRoute['respond'] {
  let index = 0
  return async () => {
    const snapshot = snapshots[index] ?? {}
    index += 1
    return { json: { data: snapshot instanceof Promise ? await snapshot : snapshot } }
  }
}

interface ProviderHarness {
  unmount: () => void
  fetchFake: FetchFake
  eventStream: TestEventStreamTransport
  queryClient: ReturnType<typeof createTestQueryClient>
  api: ApiState
  push: (...events: JsonObject[]) => void
  reconnect: () => Promise<void>
  resync: (serverId?: string) => Promise<void>
  disconnect: () => void
  user: ReturnType<typeof userEvent.setup>
}

async function renderProvider(options: RenderProviderOptions = {}): Promise<ProviderHarness> {
  const api = createApiState(options.api)
  const queryClient = options.queryClient ?? createTestQueryClient()
  const result = renderWithProviders(<Harness />, {
    events: true,
    route: options.route ?? '/',
    auth: options.auth ?? 'authenticated',
    queryClient,
    fetchRoutes: providerRoutes(api),
  })
  const eventStream = result.eventStream
  if (!eventStream) throw new Error('expected the test event stream')
  await connectTestEventStream(eventStream)
  if (options.fakeTimers) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250))
    })
    vi.useFakeTimers()
    act(() => eventStream.fail())
    await act(async () => {
      eventStream.connected()
    })
  }

  const push = (...events: JsonObject[]): void => {
    act(() => {
      for (const event of events) eventStream.message(event)
    })
  }
  const reconnect = async (): Promise<void> => {
    act(() => eventStream.fail())
    await act(async () => {
      eventStream.connected()
    })
    await act(async () => {
      await Promise.resolve()
    })
  }
  const resync = async (serverId?: string): Promise<void> => {
    await act(async () => {
      eventStream.resync(serverId === undefined ? undefined : { serverId })
      await Promise.resolve()
    })
  }
  const disconnect = (): void => {
    act(() => eventStream.fail())
  }

  return {
    unmount: result.unmount,
    fetchFake: result.fetchFake,
    eventStream,
    queryClient,
    api,
    push,
    reconnect,
    resync,
    disconnect,
    user: userEvent.setup(),
  }
}

interface DirectoryRequest {
  serverId: string
  directory: string
}

function directoryRequests(fake: FetchFake, localPath: string, remotePath: string): DirectoryRequest[] {
  const local = fake.findRequests('GET', localPath).map((request) => ({
    serverId: 'local',
    directory: request.searchParams.get('location[directory]') ?? '',
  }))
  const remote = fake.findRequests('GET', remotePath).map((request) => ({
    serverId: request.path.split('/servers/')[1]?.split('/')[0] ?? '',
    directory: request.searchParams.get('location[directory]') ?? '',
  }))
  return [...local, ...remote]
}

function pendingPermissions(fake: FetchFake): DirectoryRequest[] {
  return directoryRequests(fake, `${localApi}/permission/request`, `${remoteApi}/permission/request`)
}

function pendingForms(fake: FetchFake): DirectoryRequest[] {
  return directoryRequests(fake, `${localApi}/form`, `${remoteApi}/form`)
}

function runningShellRequests(fake: FetchFake): DirectoryRequest[] {
  return directoryRequests(fake, `${localApi}/shell`, `${remoteApi}/shell`)
}

function activeSessionServers(fake: FetchFake): string[] {
  return [
    ...fake.findRequests('GET', `${localApi}/session/active`).map(() => 'local'),
    ...fake.findRequests('GET', `${remoteApi}/session/active`).map((request) => request.path.split('/servers/')[1]?.split('/')[0] ?? ''),
  ]
}

function subscribedDirectories(eventStream: TestEventStreamTransport): string[] {
  return eventStream.posts.flatMap((post) => ('directories' in post.body ? post.body.directories : []))
}

function unsubscribedDirectories(eventStream: TestEventStreamTransport): string[] {
  return eventStream.posts
    .filter((post) => post.path === '/api/sse/unsubscribe')
    .flatMap((post) => ('directories' in post.body ? post.body.directories : []))
}

function formCountText(): string {
  return screen.getByTestId('count').textContent ?? ''
}

function permissionCountText(): string {
  return screen.getByTestId('permission-count').textContent ?? ''
}

function resetSessionStatus(): void {
  useSessionStatus.setState({
    statuses: new Map(),
    statusCache: new Map(),
    statusRevisions: new Map(),
    knownSessions: new Set(),
    outcomes: new Map(),
    parents: new Map(),
    directories: new Map(),
    sessionServers: new Map(),
    runningShells: new Map(),
    shellRevisions: new Map(),
    shellRevision: 0,
    revision: 0,
  })
}

beforeEach(() => {
  resetSessionStatus()
  authClient.$store.notify('$sessionSignal')
})

afterEach(() => {
  vi.useRealTimers()
})

describe('EventProvider permissions and forms', () => {
  it('defers authenticated bootstrap reads and the event stream until a session exists', async () => {
    const api = createApiState()
    renderWithProviders(<Harness />, {
      events: true,
      auth: 'anonymous',
      fetchRoutes: providerRoutes(api),
    })

    await waitFor(() => expect(screen.getByTestId('count')).toBeInTheDocument())
    expect(api.permissions.length).toBe(0)
  })

  it('syncs missed pending forms for a session', async () => {
    const harness = await renderProvider()
    harness.api.forms = [pendingForm]

    await harness.user.click(screen.getByRole('button', { name: 'Sync' }))

    await waitFor(() => {
      expect(formCountText()).toBe('1')
      expect(screen.getByTestId('current')).toHaveTextContent('form-1')
    })
  })

  it('syncs missed pending permissions for a session', async () => {
    const harness = await renderProvider()
    harness.api.permissions = [pendingPermission]

    await harness.user.click(screen.getByRole('button', { name: 'Sync Permissions' }))

    await waitFor(() => {
      expect(permissionCountText()).toBe('1')
      expect(screen.getByTestId('permission-current')).toHaveTextContent('permission-1')
    })
  })

  it('records the session directory for a pending permission loaded without an SSE status event', async () => {
    const harness = await renderProvider({ api: { permissions: [pendingPermission] } })
    harness.api.repos = [makeRepo({ id: 123, fullPath: '/repo' })]
    await harness.queryClient.refetchQueries({ queryKey: ['repos'] })

    await waitFor(() => {
      expect(useSessionStatus.getState().directories.get('session-1')).toBe('/repo')
    })
    expect(useSessionStatus.getState().statuses.has('session-1')).toBe(false)
  })

  it('clears stale pending permissions for a session', async () => {
    const harness = await renderProvider({ api: { permissions: [pendingPermission] } })

    await harness.user.click(screen.getByRole('button', { name: 'Sync Permissions' }))
    await waitFor(() => expect(permissionCountText()).toBe('1'))

    harness.api.permissions = []
    await harness.user.click(screen.getByRole('button', { name: 'Sync Permissions' }))

    await waitFor(() => {
      expect(permissionCountText()).toBe('0')
      expect(screen.getByTestId('permission-current')).toHaveTextContent('none')
    })
  })

  it('advances to the remaining permission after rejecting the current one of two in the same session', async () => {
    const harness = await renderProvider({
      api: { permissions: [pendingPermission, secondPendingPermission] },
    })

    await harness.user.click(screen.getByRole('button', { name: 'Sync Permissions' }))
    await waitFor(() => {
      expect(permissionCountText()).toBe('2')
      expect(screen.getByTestId('permission-current')).toHaveTextContent('permission-1')
    })

    await harness.user.click(screen.getByRole('button', { name: 'Reject Permission' }))

    await waitFor(() => {
      expect(harness.fetchFake.findRequests('POST', `${localApi}/session/session-1/permission/permission-1/reply`)).toHaveLength(1)
      expect(permissionCountText()).toBe('1')
      expect(screen.getByTestId('permission-current')).toHaveTextContent('permission-2')
    })
    expect(
      harness.fetchFake.lastRequest('POST', `${localApi}/session/session-1/permission/permission-1/reply`)?.body,
    ).toEqual({ decision: 'reject' })
  })

  it('removes a permission the server no longer knows about when replying', async () => {
    const harness = await renderProvider({ api: { permissions: [pendingPermission] } })
    harness.api.permissionReply = {
      status: 404,
      json: { _tag: 'PermissionNotFoundError', sessionID: 'session-1', requestID: 'permission-1', message: 'Permission request not found' },
    }

    await harness.user.click(screen.getByRole('button', { name: 'Sync Permissions' }))
    await waitFor(() => expect(permissionCountText()).toBe('1'))

    await harness.user.click(screen.getByRole('button', { name: 'Reject Permission' }))

    await waitFor(() => {
      expect(permissionCountText()).toBe('0')
      expect(screen.getByTestId('permission-current')).toHaveTextContent('none')
    })
    expect(await screen.findByText('Permission request expired')).toBeInTheDocument()
    expect(screen.getByTestId('rejection')).toHaveTextContent('none')
  })

  it('keeps a permission and rejects when the reply fails for another reason', async () => {
    const harness = await renderProvider({ api: { permissions: [pendingPermission] } })
    harness.api.permissionReply = {
      status: 404,
      json: { _tag: 'SessionNotFoundError', sessionID: 'session-1', message: 'Session not found' },
    }

    await harness.user.click(screen.getByRole('button', { name: 'Sync Permissions' }))
    await waitFor(() => expect(permissionCountText()).toBe('1'))

    await harness.user.click(screen.getByRole('button', { name: 'Reject Permission' }))

    await waitFor(() => expect(screen.getByTestId('rejection')).toHaveTextContent('SessionNotFoundError'))
    expect(permissionCountText()).toBe('1')
    expect(screen.getByTestId('permission-current')).toHaveTextContent('permission-1')
    expect(screen.queryByText('Permission request expired')).not.toBeInTheDocument()
  })

  it.each([
    ['Reply', 'formReply', 'FormNotFoundError', 'Form expired'],
    ['Dismiss', 'formCancel', 'FormNotFoundError', 'Form expired'],
  ] as const)('removes a form the server no longer knows about on %s', async (button, replyField, code, message) => {
    const harness = await renderProvider({ api: { forms: [pendingForm] } })
    harness.api[replyField] = {
      status: 404,
      json: { _tag: code, id: 'form-1', sessionID: 'session-1', message: 'Form not found' },
    }

    await harness.user.click(screen.getByRole('button', { name: 'Sync' }))
    await waitFor(() => expect(formCountText()).toBe('1'))

    await harness.user.click(screen.getByRole('button', { name: button }))

    await waitFor(() => {
      expect(formCountText()).toBe('0')
      expect(screen.getByTestId('current')).toHaveTextContent('none')
    })
    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(screen.getByTestId('rejection')).toHaveTextContent('none')
  })

  it.each([
    ['Reply', 'formReply'],
    ['Dismiss', 'formCancel'],
  ] as const)('keeps a form and rejects when %s fails for another reason', async (button, replyField) => {
    const harness = await renderProvider({ api: { forms: [pendingForm] } })
    harness.api[replyField] = {
      status: 409,
      json: { _tag: 'FormAlreadySettledError', id: 'form-1', sessionID: 'session-1', message: 'Form already settled' },
    }

    await harness.user.click(screen.getByRole('button', { name: 'Sync' }))
    await waitFor(() => expect(formCountText()).toBe('1'))

    await harness.user.click(screen.getByRole('button', { name: button }))

    await waitFor(() => expect(screen.getByTestId('rejection')).toHaveTextContent('FormAlreadySettledError'))
    expect(formCountText()).toBe('1')
    expect(screen.getByTestId('current')).toHaveTextContent('form-1')
    expect(screen.queryByText('Form expired')).not.toBeInTheDocument()
  })

  it('forwards an optional rejection message to the facade', async () => {
    const harness = await renderProvider({ api: { permissions: [pendingPermission] } })

    await harness.user.click(screen.getByRole('button', { name: 'Sync Permissions' }))
    await waitFor(() => expect(permissionCountText()).toBe('1'))

    await harness.user.click(screen.getByRole('button', { name: 'Reject Permission With Reason' }))

    await waitFor(() =>
      expect(
        harness.fetchFake.lastRequest('POST', `${localApi}/session/session-1/permission/permission-1/reply`)?.body,
      ).toEqual({ decision: 'reject', message: 'not allowed' }),
    )
  })

  it('clears stale pending forms for a session', async () => {
    const harness = await renderProvider({ api: { forms: [pendingForm] } })

    await harness.user.click(screen.getByRole('button', { name: 'Sync' }))
    await waitFor(() => expect(formCountText()).toBe('1'))

    harness.api.forms = []
    await harness.user.click(screen.getByRole('button', { name: 'Sync' }))

    await waitFor(() => {
      expect(formCountText()).toBe('0')
      expect(screen.getByTestId('current')).toHaveTextContent('none')
    })
  })

  it('reconciles pending forms for the whole directory', async () => {
    const harness = await renderProvider({ api: { forms: [pendingForm, secondPendingForm] } })

    await harness.user.click(screen.getByRole('button', { name: 'Sync' }))
    await waitFor(() => expect(formCountText()).toBe('2'))

    harness.api.forms = [pendingForm]
    await harness.user.click(screen.getByRole('button', { name: 'Sync' }))

    await waitFor(() => {
      expect(formCountText()).toBe('1')
      expect(screen.getByTestId('current')).toHaveTextContent('form-1')
    })
  })

  it('resolves pending forms per session independently of the global current', async () => {
    const harness = await renderProvider({ api: { forms: [pendingForm, secondPendingForm] } })

    await harness.user.click(screen.getByRole('button', { name: 'Sync' }))
    await waitFor(() => expect(formCountText()).toBe('2'))

    expect(screen.getByTestId('current')).toHaveTextContent('form-1')
    expect(screen.getByTestId('for-session-1')).toHaveTextContent('form-1')
    expect(screen.getByTestId('for-session-2')).toHaveTextContent('form-2')
    expect(screen.getByTestId('for-session-unknown')).toHaveTextContent('none')
  })

  it('reconciles stale pending forms after reconnect', async () => {
    const harness = await renderProvider({
      api: { repos: [makeRepo({ id: 123, fullPath: '/repo' })], forms: [pendingForm] },
    })
    await waitFor(() => expect(formCountText()).toBe('1'))

    harness.api.forms = []
    await harness.reconnect()

    await waitFor(() => {
      expect(formCountText()).toBe('0')
      expect(screen.getByTestId('current')).toHaveTextContent('none')
    })
  })

  it('reconciles a remembered remote directory on reconnect', async () => {
    const harness = await renderProvider({
      api: { servers: [makeOpenCodeServer({ id: 'srv_remote', enabled: true })] },
    })

    harness.push(formCreated(pendingForm, { directory: '/srv/app', serverId: 'srv_remote' }))
    await waitFor(() => expect(formCountText()).toBe('1'))

    harness.api.forms = []
    await harness.reconnect()

    await waitFor(() => {
      expect(pendingForms(harness.fetchFake)).toContainEqual({ serverId: 'srv_remote', directory: '/srv/app' })
      expect(formCountText()).toBe('0')
      expect(screen.getByTestId('current')).toHaveTextContent('none')
    })
  })

  it('reconciles a linked server enabled after the browser stream connects', async () => {
    const harness = await renderProvider()

    harness.api.active = {}
    harness.api.servers = [makeOpenCodeServer({ id: 'srv_remote', enabled: true })]

    expect(activeSessionServers(harness.fetchFake)).not.toContain('srv_remote')

    await harness.queryClient.refetchQueries({ queryKey: ['opencode-servers'] })

    await waitFor(() => {
      expect(activeSessionServers(harness.fetchFake)).toContain('srv_remote')
    })
  })

  it('clears settled pending actions on an upstream resync while the browser stream stays connected', async () => {
    const harness = await renderProvider({
      api: { repos: [makeRepo({ id: 123, fullPath: '/repo' })] },
    })
    await waitFor(() => expect(pendingPermissions(harness.fetchFake)).toContainEqual({ serverId: 'local', directory: '/repo' }))

    harness.push(
      permissionAsked(pendingPermission, { directory: '/repo' }),
      formCreated(pendingForm, { directory: '/repo' }),
    )
    await waitFor(() => {
      expect(permissionCountText()).toBe('1')
      expect(formCountText()).toBe('1')
    })

    harness.api.permissions = []
    harness.api.forms = []
    await harness.resync()

    await waitFor(() => {
      expect(permissionCountText()).toBe('0')
      expect(formCountText()).toBe('0')
    })
  })

  it('retains genuinely pending actions on an upstream resync', async () => {
    const harness = await renderProvider({
      api: {
        repos: [makeRepo({ id: 123, fullPath: '/repo' })],
        permissions: [pendingPermission],
        forms: [pendingForm],
      },
    })

    harness.push(
      permissionAsked(pendingPermission, { directory: '/repo' }),
      formCreated(pendingForm, { directory: '/repo' }),
    )
    await waitFor(() => {
      expect(permissionCountText()).toBe('1')
      expect(formCountText()).toBe('1')
    })

    await harness.resync()

    await waitFor(() => {
      expect(permissionCountText()).toBe('1')
      expect(formCountText()).toBe('1')
    })
  })

  it('reconciles tracked worktree session directories on an upstream resync', async () => {
    const harness = await renderProvider({
      api: { repos: [makeRepo({ id: 123, fullPath: '/repo' })] },
    })

    harness.push(permissionAsked(pendingPermission, { directory: '/worktrees/wt-1' }))
    await waitFor(() => expect(permissionCountText()).toBe('1'))

    harness.api.permissions = []
    await harness.resync()

    await waitFor(() => {
      expect(pendingPermissions(harness.fetchFake)).toContainEqual({ serverId: 'local', directory: '/worktrees/wt-1' })
      expect(permissionCountText()).toBe('0')
    })
  })

  it('navigates to a synced pending form without session query cache', async () => {
    const harness = await renderProvider({
      api: { repos: [makeRepo({ id: 123, fullPath: '/repo' })], forms: [pendingForm] },
    })

    await harness.user.click(screen.getByRole('button', { name: 'Sync' }))
    await waitFor(() => expect(screen.getByTestId('current')).toHaveTextContent('form-1'))

    await harness.user.click(screen.getByRole('button', { name: 'Navigate' }))

    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/repos/123/sessions/session-1'))
  })

  it('navigates an assistant-session permission to the assistant session path', async () => {
    const harness = await renderProvider({ api: { repos: [makeRepo({ id: 0, fullPath: '/assistant' })] } })

    harness.push(permissionAsked(pendingPermission, { directory: '/assistant' }))
    await waitFor(() => expect(screen.getByTestId('permission-current')).toHaveTextContent('permission-1'))

    await harness.user.click(screen.getByRole('button', { name: 'Navigate Permission' }))

    await waitFor(() => {
      expect(screen.getByTestId('path')).toHaveTextContent('/repos/0/sessions/session-1')
      expect(screen.getByTestId('search')).toHaveTextContent('?assistant=1')
    })
  })

  it('navigates a normal-repo permission without the assistant query', async () => {
    const harness = await renderProvider({ api: { repos: [makeRepo({ id: 123, fullPath: '/repo' })] } })

    harness.push(permissionAsked(pendingPermission, { directory: '/repo' }))
    await waitFor(() => expect(screen.getByTestId('permission-current')).toHaveTextContent('permission-1'))

    await harness.user.click(screen.getByRole('button', { name: 'Navigate Permission' }))

    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/repos/123/sessions/session-1'))
    expect(screen.getByTestId('search').textContent).toBe('')
  })

  it('navigates a linked-server permission without a Manager repo for its directory', async () => {
    const harness = await renderProvider()

    harness.push(permissionAsked(pendingPermission, { directory: '/srv/app', serverId: 'srv_kitchen' }))
    await waitFor(() => expect(screen.getByTestId('permission-current')).toHaveTextContent('permission-1'))

    await harness.user.click(screen.getByRole('button', { name: 'Navigate Permission' }))

    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/servers/srv_kitchen/sessions/session-1'))
    expect(screen.getByTestId('search').textContent).toBe('')
  })

  it('navigates a linked-server form to its server session route', async () => {
    const harness = await renderProvider()

    harness.push(formCreated(pendingForm, { directory: '/srv/app', serverId: 'srv_kitchen' }))
    await waitFor(() => expect(screen.getByTestId('current')).toHaveTextContent('form-1'))

    await harness.user.click(screen.getByRole('button', { name: 'Navigate' }))

    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/servers/srv_kitchen/sessions/session-1'))
  })

  it('does not navigate when already on the target session path', async () => {
    window.history.pushState({}, '', '/repos/123/sessions/session-1')
    const harness = await renderProvider({
      route: '/repos/123/sessions/session-1',
      api: { repos: [makeRepo({ id: 123, fullPath: '/repo' })] },
    })

    harness.push(permissionAsked(pendingPermission, { directory: '/repo' }))
    await waitFor(() => expect(screen.getByTestId('permission-current')).toHaveTextContent('permission-1'))

    const keyBefore = screen.getByTestId('location-key').textContent

    await harness.user.click(screen.getByRole('button', { name: 'Navigate Permission' }))

    expect(screen.getByTestId('location-key')).toHaveTextContent(keyBefore ?? '')
    expect(screen.getByTestId('path')).toHaveTextContent('/repos/123/sessions/session-1')
  })

  it('navigates an assistant-session form to the assistant session path', async () => {
    const harness = await renderProvider({
      api: { repos: [makeRepo({ id: 0, fullPath: '/repo' })], forms: [pendingForm] },
    })

    await harness.user.click(screen.getByRole('button', { name: 'Sync' }))
    await waitFor(() => expect(screen.getByTestId('current')).toHaveTextContent('form-1'))

    await harness.user.click(screen.getByRole('button', { name: 'Navigate' }))

    await waitFor(() => {
      expect(screen.getByTestId('path')).toHaveTextContent('/repos/0/sessions/session-1')
      expect(screen.getByTestId('search')).toHaveTextContent('?assistant=1')
    })
  })

  it('clears a pending form after dismiss succeeds', async () => {
    const harness = await renderProvider({ api: { forms: [pendingForm] } })

    await harness.user.click(screen.getByRole('button', { name: 'Sync' }))
    await waitFor(() => expect(formCountText()).toBe('1'))

    await harness.user.click(screen.getByRole('button', { name: 'Dismiss' }))

    await waitFor(() => {
      expect(harness.fetchFake.findRequests('DELETE', `${localApi}/session/session-1/form/form-1`)).toHaveLength(1)
      expect(formCountText()).toBe('0')
      expect(screen.getByTestId('current')).toHaveTextContent('none')
    })
  })

  it('clears a pending form after reply succeeds', async () => {
    const harness = await renderProvider({ api: { forms: [pendingForm] } })

    await harness.user.click(screen.getByRole('button', { name: 'Sync' }))
    await waitFor(() => expect(formCountText()).toBe('1'))

    await harness.user.click(screen.getByRole('button', { name: 'Reply' }))

    await waitFor(() => {
      expect(harness.fetchFake.lastRequest('POST', `${localApi}/session/session-1/form/form-1/reply`)?.body).toEqual({
        answer: { q0: 'Yes' },
      })
      expect(formCountText()).toBe('0')
      expect(screen.getByTestId('current')).toHaveTextContent('none')
    })
  })

  it('adds a pending form received via the global monitor onEvent', async () => {
    const harness = await renderProvider({ api: { repos: [makeRepo({ id: 123, fullPath: '/repo' })] } })

    harness.push(formCreated(pendingForm, { directory: '/repo' }))

    await waitFor(() => {
      expect(formCountText()).toBe('1')
      expect(screen.getByTestId('current')).toHaveTextContent('form-1')
    })
  })

  it('exposes an SSH host key request received via the global monitor onEvent', async () => {
    const harness = await renderProvider()
    const request: SSHHostKeyRequest = {
      id: 'host-key-1',
      host: 'example.com:22',
      ip: '203.0.113.10',
      keyType: 'ssh-ed25519',
      fingerprint: 'SHA256:abc',
      timestamp: Date.now(),
      isKeyChanged: false,
    }

    harness.push(sshHostKeyRequest(request))

    await waitFor(() => expect(screen.getByTestId('ssh-host')).toHaveTextContent('example.com:22'))
  })

  it('adds a pending permission received via the global monitor onEvent', async () => {
    const harness = await renderProvider({ api: { repos: [makeRepo({ id: 123, fullPath: '/repo' })] } })

    harness.push(permissionAsked(pendingPermission, { directory: '/repo' }))
    await waitFor(() => {
      expect(permissionCountText()).toBe('1')
      expect(screen.getByTestId('permission-current')).toHaveTextContent('permission-1')
    })

    harness.push(permissionReplied('session-1', 'permission-1', 'reject', { directory: '/repo' }))

    await waitFor(() => expect(permissionCountText()).toBe('0'))
  })

  it('resolves a pending permission by its source tool call and message', async () => {
    const harness = await renderProvider({ api: { repos: [makeRepo({ id: 123, fullPath: '/repo' })] } })

    harness.push(permissionAsked(sourcedPermission, { directory: '/repo' }))

    await waitFor(() => expect(screen.getByTestId('permission-tool-call')).toHaveTextContent('permission-3'))
    expect(screen.getByTestId('permission-tool-call-other-message')).toHaveTextContent('none')
    expect(screen.getByTestId('permission-tool-call-other-id')).toHaveTextContent('none')
  })

  it('removes a pending form on a form.cancelled event', async () => {
    const harness = await renderProvider({
      api: { repos: [makeRepo({ id: 123, fullPath: '/repo' })], forms: [pendingForm] },
    })
    await waitFor(() => expect(formCountText()).toBe('1'))

    harness.push(formCancelled('form-1', 'session-1', { directory: '/repo' }))

    await waitFor(() => {
      expect(formCountText()).toBe('0')
      expect(screen.getByTestId('current')).toHaveTextContent('none')
    })
  })

  it('clears pending forms and permissions for a deleted session', async () => {
    const harness = await renderProvider()

    harness.push(
      formCreated(pendingForm, { directory: '/repo' }),
      permissionAsked(pendingPermission, { directory: '/repo' }),
    )
    await waitFor(() => {
      expect(formCountText()).toBe('1')
      expect(permissionCountText()).toBe('1')
    })

    harness.push(sessionDeleted('session-1', { directory: '/repo' }))

    await waitFor(() => {
      expect(formCountText()).toBe('0')
      expect(permissionCountText()).toBe('0')
      expect(screen.getByTestId('current')).toHaveTextContent('none')
      expect(screen.getByTestId('permission-current')).toHaveTextContent('none')
    })
  })

  it('does not invalidate the transcript on form reply or cancel events', async () => {
    const harness = await renderProvider({
      api: { repos: [makeRepo({ id: 123, fullPath: '/repo' })], forms: [pendingForm, secondPendingForm] },
    })
    const invalidateQueries = vi.spyOn(harness.queryClient, 'invalidateQueries')
    await waitFor(() => expect(formCountText()).toBe('2'))
    invalidateQueries.mockClear()

    harness.push(
      formReplied('form-1', 'session-1', {}, { directory: '/repo' }),
      formCancelled('form-2', 'session-2', { directory: '/repo' }),
    )

    await waitFor(() => expect(formCountText()).toBe('0'))
    expect(invalidateQueries).not.toHaveBeenCalled()
  })

  it.each<SimpleStreamEventType>([
    'credential.updated',
    'credential.switched',
    'integration.updated',
    'provider.updated',
    'model.updated',
  ])('invalidates provider caches on a location-less %s event', async (type) => {
    const harness = await renderProvider()
    const invalidateQueries = vi.spyOn(harness.queryClient, 'invalidateQueries')
    invalidateQueries.mockClear()

    harness.push(simpleStreamEvent(type))

    await waitFor(() => {
      for (const queryKey of [
        ['provider-auth-methods'],
        ['provider-integrations'],
        ['opencode', 'providers'],
      ]) {
        expect(invalidateQueries).toHaveBeenCalledWith({ queryKey })
      }
    })
  })

  it('collapses a burst of provider events into a single provider invalidation flush', async () => {
    const harness = await renderProvider()
    const invalidateQueries = vi.spyOn(harness.queryClient, 'invalidateQueries')
    await settleInvalidations()
    invalidateQueries.mockClear()

    harness.push(
      simpleStreamEvent('credential.updated'),
      simpleStreamEvent('provider.updated'),
      simpleStreamEvent('model.updated'),
      simpleStreamEvent('integration.updated'),
      simpleStreamEvent('credential.switched'),
      simpleStreamEvent('provider.updated'),
    )

    await waitFor(() => {
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['opencode', 'providers'] })
    })
    expect(invalidateQueries).toHaveBeenCalledTimes(3)
  })

  it.each<[SimpleStreamEventType, string[]]>([
    ['agent.updated', ['opencode', 'agents']],
    ['command.updated', ['opencode', 'commands']],
    ['skill.updated', ['opencode', 'skills']],
  ])('invalidates the %s cache', async (type, queryKey) => {
    const harness = await renderProvider()
    const invalidateQueries = vi.spyOn(harness.queryClient, 'invalidateQueries')
    invalidateQueries.mockClear()

    harness.push(simpleStreamEvent(type))

    await waitFor(() => expect(invalidateQueries).toHaveBeenCalledWith({ queryKey }))
  })

  it('invalidates the location catalog and provider integration caches on an upstream resync', async () => {
    const harness = await renderProvider()
    const invalidateQueries = vi.spyOn(harness.queryClient, 'invalidateQueries')
    invalidateQueries.mockClear()

    await harness.resync()

    await waitFor(() => {
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['opencode', 'commands'] })
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['opencode', 'agents'] })
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['opencode', 'skills'] })
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['opencode', 'providers'] })
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['provider-integrations'] })
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['opencode-config', 'managed'] })
    })
  })

  it('invalidates the location catalog and provider integration caches when the browser stream reconnects', async () => {
    const harness = await renderProvider()
    const invalidateQueries = vi.spyOn(harness.queryClient, 'invalidateQueries')
    invalidateQueries.mockClear()

    await harness.reconnect()

    await waitFor(() => {
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['opencode', 'commands'] })
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['opencode', 'agents'] })
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['opencode', 'skills'] })
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['opencode', 'providers'] })
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['provider-integrations'] })
    })
  })

  it('invalidates config and provider integration caches on config.updated', async () => {
    const harness = await renderProvider()
    const invalidateQueries = vi.spyOn(harness.queryClient, 'invalidateQueries')
    invalidateQueries.mockClear()

    harness.push(simpleStreamEvent('config.updated'))

    await waitFor(() => {
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['opencode', 'config'] })
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['opencode-config'] })
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['provider-integrations'] })
    })
  })

  it('applies a goal change event to the session goal cache', async () => {
    const initialGoal: GoalState = {
      id: 'goal-1',
      objective: 'Ship the goal bar',
      status: 'active',
      rounds: 0,
      maxRounds: 10,
      boot: 'boot-1',
      updatedAt: 1000,
    }
    const updatedGoal: GoalState = { ...initialGoal, rounds: 1, updatedAt: 2000 }
    const queryClient = createTestQueryClient()
    queryClient.setQueryData(['session-goal', 'session-1'], { supported: true, goal: initialGoal })
    const harness = await renderProvider({ queryClient })

    harness.push(goalChanged('session-1', updatedGoal, { directory: '/repo' }))

    expect(queryClient.getQueryData(['session-goal', 'session-1'])).toEqual({ supported: true, goal: updatedGoal })

    harness.push(sessionIdle('other', { directory: '/repo' }))

    expect(queryClient.getQueryData(['session-goal', 'session-1'])).toEqual({ supported: true, goal: updatedGoal })
  })

  it('invalidates the sibling caches when a branch changes outside a repo row', async () => {
    const harness = await renderProvider()
    const invalidateQueries = vi.spyOn(harness.queryClient, 'invalidateQueries')
    invalidateQueries.mockClear()

    harness.push(vcsBranchUpdated('feature', { directory: '/repos/a/.worktrees/feat' }))

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['repo', 'siblings'] })
  })

  it('updates the repo branch and refreshes the sibling caches on vcs.branch.updated', async () => {
    const harness = await renderProvider({ api: { repos: [makeRepo({ id: 1, fullPath: '/repo-a' })] } })
    const invalidateQueries = vi.spyOn(harness.queryClient, 'invalidateQueries')
    await waitFor(() => expect(harness.queryClient.getQueryData(['repos'])).toBeDefined())
    invalidateQueries.mockClear()

    harness.push(vcsBranchUpdated('feature', { directory: '/repo-a' }))

    expect(harness.queryClient.getQueryData(['repo', 1])).toMatchObject({
      currentBranch: 'feature',
      branch: 'feature',
    })
    await waitFor(() => expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['repo', 'siblings'] }))
  })

  it('reconciles every tracked directory concurrently on an upstream resync', async () => {
    const harness = await renderProvider({
      api: {
        repos: [makeRepo({ id: 1, fullPath: '/repo-a' }), makeRepo({ id: 2, fullPath: '/repo-b' })],
      },
    })
    await waitFor(() => expect(pendingForms(harness.fetchFake)).toContainEqual({ serverId: 'local', directory: '/repo-b' }))

    const pending = new Map<string, () => void>()
    harness.api.permissionsResponder = (_request, _params, init) => {
      void init
      return new Promise<FetchRouteResult>((resolve) => {
        pending.set('deferred', () => resolve({ json: { data: [] } }))
      })
    }
    harness.api.formsResponder = () => ({ json: { data: [] } })

    await harness.resync()

    expect(pendingPermissions(harness.fetchFake)).toContainEqual({ serverId: 'local', directory: '/repo-a' })
    expect(pendingPermissions(harness.fetchFake)).toContainEqual({ serverId: 'local', directory: '/repo-b' })

    await act(async () => {
      pending.forEach((resolve) => resolve())
    })
  })

  it('resolves a session directory from the infinite-query session list cache', async () => {
    const queryClient = createTestQueryClient()
    queryClient.setQueryData(
      ['opencode', 'sessions', '/repo', { search: undefined, limit: 25 }],
      {
        pages: [{ items: [makeSession({ id: 'ses-infinite', location: { directory: '/repo' } })], cursors: {} }],
        pageParams: [undefined],
      },
    )
    await renderProvider({ queryClient, api: { repos: [makeRepo({ id: 123, fullPath: '/repo' })] } })
    renderWithProviders(<CacheResolutionHarness sessionID="ses-infinite" />, {
      events: true,
      queryClient,
      fetchRoutes: providerRoutes(createApiState({ repos: [makeRepo({ id: 123, fullPath: '/repo' })] })),
    })

    await waitFor(() => expect(screen.getByTestId('repo-id')).toHaveTextContent('123'))
  })

  it('resolves a session directory from the single-session cache without a remembered event directory', async () => {
    const queryClient = createTestQueryClient()
    queryClient.setQueryData(
      ['opencode', 'session', 'ses-detail', '/repo'],
      makeSession({ id: 'ses-detail', location: { directory: '/repo' } }),
    )
    renderWithProviders(<CacheResolutionHarness sessionID="ses-detail" />, {
      events: true,
      queryClient,
      fetchRoutes: providerRoutes(createApiState({ repos: [makeRepo({ id: 123, fullPath: '/repo' })] })),
    })

    await waitFor(() => expect(screen.getByTestId('repo-id')).toHaveTextContent('123'))
  })

  it('resolves a session in the second directory page of the session list cache', async () => {
    const queryClient = createTestQueryClient()
    queryClient.setQueryData(
      ['opencode', 'sessions', '/repo-a|/repo-b', { search: undefined, limit: 25 }],
      {
        pages: [
          {
            items: [makeSession({ id: 'ses-first', location: { directory: '/repo-a' } })],
            cursors: { '/repo-a': 'cursor-a' },
          },
          {
            items: [makeSession({ id: 'ses-second', location: { directory: '/repo-b' } })],
            cursors: {},
          },
        ],
        pageParams: [undefined, { '/repo-a': 'cursor-a' }],
      },
    )
    renderWithProviders(<CacheResolutionHarness sessionID="ses-second" />, {
      events: true,
      queryClient,
      fetchRoutes: providerRoutes(createApiState({
        repos: [makeRepo({ id: 123, fullPath: '/repo-a' }), makeRepo({ id: 456, fullPath: '/repo-b' })],
      })),
    })

    await waitFor(() => expect(screen.getByTestId('repo-id')).toHaveTextContent('456'))
  })

  it('prioritizes the viewed session permission over an earlier unrelated one', async () => {
    const harness = await renderProvider({ route: '/repos/123/sessions/session-view' })

    harness.push(
      permissionAsked(otherSessionPermission, { directory: '/repo' }),
      permissionAsked(viewedSessionPermission, { directory: '/repo' }),
    )

    await waitFor(() => {
      expect(permissionCountText()).toBe('2')
      expect(screen.getByTestId('permission-current')).toHaveTextContent('permission-view')
    })
    expect(screen.getByTestId('permission-different')).toHaveTextContent('false')
  })

  it('prefers a descendant session permission when viewing its parent', async () => {
    act(() => {
      useSessionStatus.getState().setSessionParent('child-1', 'parent-1')
    })
    const harness = await renderProvider({ route: '/repos/123/sessions/parent-1' })

    harness.push(
      permissionAsked(otherSessionPermission, { directory: '/repo' }),
      permissionAsked(childSessionPermission, { directory: '/repo' }),
    )

    await waitFor(() => expect(screen.getByTestId('permission-current')).toHaveTextContent('permission-child'))
    expect(screen.getByTestId('permission-different')).toHaveTextContent('false')
  })

  it('falls back to the first pending permission when the viewed session has none', async () => {
    const harness = await renderProvider({ route: '/repos/123/sessions/session-view' })

    harness.push(
      permissionAsked(otherSessionPermission, { directory: '/repo' }),
      permissionAsked(pendingPermission, { directory: '/repo' }),
    )

    await waitFor(() => {
      expect(permissionCountText()).toBe('2')
      expect(screen.getByTestId('permission-current')).toHaveTextContent('permission-other')
    })
    expect(screen.getByTestId('permission-different')).toHaveTextContent('true')
  })

  it('resolves the current permission directory from the query cache', async () => {
    const queryClient = createTestQueryClient()
    queryClient.setQueryData(
      ['opencode', 'session', 'session-1', '/repo'],
      makeSession({ id: 'session-1', location: { directory: '/repo' } }),
    )
    const harness = await renderProvider({
      queryClient,
      api: { repos: [makeRepo({ id: 123, fullPath: '/repo' })] },
    })

    harness.push(permissionAsked(pendingPermission, { directory: '/repo' }))

    await waitFor(() => {
      expect(screen.getByTestId('permission-current')).toHaveTextContent('permission-1')
      expect(screen.getByTestId('permission-directory')).toHaveTextContent('/repo')
    })
  })

  it('replaces a pinned out-of-view permission with the viewed-session one, then advances to the remaining pinned one', async () => {
    const harness = await renderProvider({ route: '/repos/123/sessions/session-view' })

    harness.push(permissionAsked(otherSessionPermission, { directory: '/repo' }))
    await waitFor(() => expect(screen.getByTestId('permission-current')).toHaveTextContent('permission-other'))

    harness.push(permissionAsked(viewedSessionPermission, { directory: '/repo' }))
    await waitFor(() => {
      expect(permissionCountText()).toBe('2')
      expect(screen.getByTestId('permission-current')).toHaveTextContent('permission-view')
    })

    harness.push(permissionReplied('session-view', 'permission-view', 'reject', { directory: '/repo' }))

    await waitFor(() => {
      expect(permissionCountText()).toBe('1')
      expect(screen.getByTestId('permission-current')).toHaveTextContent('permission-other')
    })
  })

  it('keeps a shown in-view permission when another in-view permission arrives', async () => {
    act(() => {
      useSessionStatus.getState().setSessionParent('child-1', 'session-view')
    })
    const harness = await renderProvider({ route: '/repos/123/sessions/session-view' })

    harness.push(permissionAsked(viewedSessionPermission, { directory: '/repo' }))
    await waitFor(() => expect(screen.getByTestId('permission-current')).toHaveTextContent('permission-view'))

    harness.push(permissionAsked(childSessionPermission, { directory: '/repo' }))
    await waitFor(() => expect(permissionCountText()).toBe('2'))
    expect(screen.getByTestId('permission-current')).toHaveTextContent('permission-view')
  })

  it('prioritizes the viewed session form over an earlier unrelated one', async () => {
    const harness = await renderProvider({ route: '/repos/123/sessions/session-view' })

    harness.push(
      formCreated(otherSessionForm, { directory: '/repo' }),
      formCreated(viewedSessionForm, { directory: '/repo' }),
    )

    await waitFor(() => {
      expect(formCountText()).toBe('2')
      expect(screen.getByTestId('current')).toHaveTextContent('form-view')
    })
  })

  it('prefers a descendant session form when viewing its parent', async () => {
    act(() => {
      useSessionStatus.getState().setSessionParent('child-1', 'parent-1')
    })
    const harness = await renderProvider({ route: '/repos/123/sessions/parent-1' })

    harness.push(
      formCreated(otherSessionForm, { directory: '/repo' }),
      formCreated(childSessionForm, { directory: '/repo' }),
    )

    await waitFor(() => expect(screen.getByTestId('current')).toHaveTextContent('form-child'))
  })

  it('falls back to the first pending form when the viewed session has none', async () => {
    const harness = await renderProvider({ route: '/repos/123/sessions/session-view' })

    harness.push(
      formCreated(otherSessionForm, { directory: '/repo' }),
      formCreated(pendingForm, { directory: '/repo' }),
    )

    await waitFor(() => {
      expect(formCountText()).toBe('2')
      expect(screen.getByTestId('current')).toHaveTextContent('form-other')
    })
  })

  it('replaces a pinned out-of-view form with the viewed-session one, then advances to the remaining pinned one', async () => {
    const harness = await renderProvider({ route: '/repos/123/sessions/session-view' })

    harness.push(formCreated(otherSessionForm, { directory: '/repo' }))
    await waitFor(() => expect(screen.getByTestId('current')).toHaveTextContent('form-other'))

    harness.push(formCreated(viewedSessionForm, { directory: '/repo' }))
    await waitFor(() => {
      expect(formCountText()).toBe('2')
      expect(screen.getByTestId('current')).toHaveTextContent('form-view')
    })

    harness.push(formCancelled('form-view', 'session-view', { directory: '/repo' }))

    await waitFor(() => {
      expect(formCountText()).toBe('1')
      expect(screen.getByTestId('current')).toHaveTextContent('form-other')
    })
  })

  it('resolves ancestry when a permission arrives for an unknown session', async () => {
    const harness = await renderProvider({
      route: '/repos/123/sessions/parent-1',
      api: {
        sessions: new Map([
          ['child-1', makeSession({ id: 'child-1', parentID: 'parent-1', location: { directory: '/repo' } })],
          ['parent-1', makeSession({ id: 'parent-1', location: { directory: '/repo' } })],
        ]),
      },
    })

    harness.push(permissionAsked(childSessionPermission, { directory: '/repo' }))

    await waitFor(() => {
      expect(harness.fetchFake.findRequests('GET', `${localApi}/session/child-1`)).toHaveLength(1)
      expect(useSessionStatus.getState().parents.get('child-1')).toBe('parent-1')
    })
    expect(screen.getByTestId('permission-current')).toHaveTextContent('permission-child')
    expect(screen.getByTestId('permission-different')).toHaveTextContent('false')
  })

  it('resolves ancestry when a form arrives for an unknown session', async () => {
    const harness = await renderProvider({
      route: '/repos/123/sessions/parent-1',
      api: {
        sessions: new Map([
          ['child-1', makeSession({ id: 'child-1', parentID: 'parent-1', location: { directory: '/repo' } })],
          ['parent-1', makeSession({ id: 'parent-1', location: { directory: '/repo' } })],
        ]),
      },
    })

    harness.push(formCreated(childSessionForm, { directory: '/repo' }))

    await waitFor(() => {
      expect(harness.fetchFake.findRequests('GET', `${localApi}/session/child-1`)).toHaveLength(1)
      expect(useSessionStatus.getState().parents.get('child-1')).toBe('parent-1')
    })
    expect(screen.getByTestId('current')).toHaveTextContent('form-child')
  })

  it('exposes sseHealth through context', async () => {
    const harness = await renderProvider()
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
    harness.disconnect()

    harness.eventStream.openedUrls.length = 0
    renderWithProviders(<TestComponent />, {
      events: true,
      eventStream: harness.eventStream,
      fetchRoutes: providerRoutes(harness.api),
    })

    await waitFor(() => {
      expect(screen.getByTestId('connected')).toHaveTextContent('false')
      expect(screen.getByTestId('healthy')).toHaveTextContent('false')
    })
  })

  it('does not re-render consumers for health notifications that only change lastEventAt', async () => {
    const harness = await renderProvider()
    let renderCount = 0
    const Probe = () => {
      renderCount += 1
      const { isConnected } = useSSEHealth()
      return <div data-testid="probe-connected">{String(isConnected)}</div>
    }
    renderWithProviders(<Probe />, {
      events: true,
      eventStream: harness.eventStream,
      fetchRoutes: providerRoutes(harness.api),
    })

    await waitFor(() => expect(screen.getByTestId('probe-connected')).toHaveTextContent('false'))
    const initialRenderCount = renderCount

    await harness.reconnect()

    await waitFor(() => expect(screen.getByTestId('probe-connected')).toHaveTextContent('true'))
    const afterBooleanChange = renderCount

    act(() => {
      harness.eventStream.heartbeat()
      harness.eventStream.heartbeat()
    })

    expect(afterBooleanChange).toBe(initialRenderCount + 1)
    expect(renderCount).toBe(afterBooleanChange)
  })

  it('applies a session.status event from the global monitor to the status store', async () => {
    const harness = await renderProvider()

    harness.push(sessionStatusUpdated('session-9', { type: 'busy' }, { directory: '/repo' }))

    expect(useSessionStatus.getState().getStatus('session-9')).toEqual({ type: 'busy' })
  })

  it('shows compaction from compaction events and restores the previous status', async () => {
    const harness = await renderProvider()

    harness.push(
      sessionExecutionStarted('session-compact', { directory: '/repo' }),
      sessionCompactionStarted('session-compact', 'manual', { directory: '/repo' }),
    )
    expect(useSessionStatus.getState().getStatus('session-compact')).toEqual({ type: 'compact' })

    harness.push(sessionCompactionEnded('session-compact', 'manual', { directory: '/repo' }))
    expect(useSessionStatus.getState().getStatus('session-compact')).toEqual({ type: 'busy' })

    harness.push(
      sessionCompactionStarted('session-compact', 'auto', { directory: '/repo' }),
      sessionStatusUpdated('session-compact', { type: 'retry', attempt: 1, message: 'rate limited', next: 5 }, { directory: '/repo' }),
      sessionCompactionFailed('session-compact', 'auto', 'boom', { directory: '/repo' }),
    )
    expect(useSessionStatus.getState().getStatus('session-compact')).toEqual({
      type: 'retry',
      attempt: 1,
      message: 'rate limited',
      next: 5,
    })
  })

  it('applies execution lifecycle and idle events from the global monitor to the status store', async () => {
    const harness = await renderProvider()

    harness.push(sessionExecutionStarted('session-9', { directory: '/repo' }))
    expect(useSessionStatus.getState().getStatus('session-9')).toEqual({ type: 'busy' })

    harness.push(sessionExecutionSucceeded('session-9', { directory: '/repo' }))
    expect(useSessionStatus.getState().getStatus('session-9')).toEqual({ type: 'idle' })

    harness.push(
      sessionExecutionStarted('session-9', { directory: '/repo' }),
      sessionIdle('session-9', { directory: '/repo' }),
    )
    expect(useSessionStatus.getState().getStatus('session-9')).toEqual({ type: 'idle' })
  })

  it.each<[string, (sessionID: string, context: StreamEventContext) => JsonObject]>([
    ['session.execution.succeeded', (sessionID, context) => sessionExecutionSucceeded(sessionID, context)],
    ['session.execution.failed', (sessionID, context) => sessionExecutionFailed(sessionID, 'boom', context)],
    ['session.execution.interrupted', (sessionID, context) => sessionExecutionInterrupted(sessionID, 'user', context)],
  ])('invalidates the change walkthrough query on %s', async (_type, buildEvent) => {
    const harness = await renderProvider()
    const invalidateQueries = vi.spyOn(harness.queryClient, 'invalidateQueries')
    invalidateQueries.mockClear()

    harness.push(buildEvent('session-9', { directory: '/repo' }))

    await waitFor(() =>
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: changeWalkthroughQueryKey('session-9') }),
    )
  })

  it('marks a child session as known from its execution lifecycle events', async () => {
    const harness = await renderProvider()

    harness.push(sessionExecutionStarted('child-1', { directory: '/repo' }))

    expect(useSessionStatus.getState().knownSessions.has('child-1')).toBe(true)
    expect(useSessionStatus.getState().knownSessions.has('child-unknown')).toBe(false)
  })

  it('does not treat a child omitted from a global snapshot as finished', async () => {
    const harness = await renderProvider({ api: { repos: [makeRepo({ id: 123, fullPath: '/repo' })] } })

    harness.push(sessionExecutionStarted('child-1', { directory: '/repo' }))
    expect(useSessionStatus.getState().getStatus('child-1')).toEqual({ type: 'busy' })

    await harness.reconnect()

    await waitFor(() => expect(useSessionStatus.getState().knownSessions.has('child-1')).toBe(false))
  })

  it('records a failed child outcome and preserves it when the child goes idle', async () => {
    const harness = await renderProvider()

    harness.push(
      sessionExecutionStarted('child-1', { directory: '/repo' }),
      sessionExecutionFailed('child-1', 'boom', { directory: '/repo' }),
    )

    expect(useSessionStatus.getState().outcomes.get('child-1')).toBe('failed')
    expect(useSessionStatus.getState().getStatus('child-1')).toEqual({ type: 'idle' })

    harness.push(sessionIdle('child-1', { directory: '/repo' }))

    expect(useSessionStatus.getState().outcomes.get('child-1')).toBe('failed')
  })

  it('records an interrupted child outcome', async () => {
    const harness = await renderProvider()

    harness.push(sessionExecutionInterrupted('child-1', 'user', { directory: '/repo' }))

    expect(useSessionStatus.getState().outcomes.get('child-1')).toBe('interrupted')
    expect(useSessionStatus.getState().getStatus('child-1')).toEqual({ type: 'idle' })
  })

  it('does not turn a failed child into completed across a reconnect snapshot', async () => {
    const harness = await renderProvider({ api: { repos: [makeRepo({ id: 123, fullPath: '/repo' })] } })

    harness.push(sessionExecutionFailed('child-1', 'boom', { directory: '/repo' }))
    expect(useSessionStatus.getState().outcomes.get('child-1')).toBe('failed')

    await harness.reconnect()

    await waitFor(() => {
      expect(useSessionStatus.getState().outcomes.get('child-1')).toBe('failed')
      expect(useSessionStatus.getState().getStatus('child-1')).toEqual({ type: 'idle' })
      expect(useSessionStatus.getState().knownSessions.has('child-1')).toBe(true)
    })
  })

  it('clears a previous child outcome when a new execution starts', async () => {
    const harness = await renderProvider()

    harness.push(
      sessionExecutionFailed('child-1', 'boom', { directory: '/repo' }),
      sessionExecutionStarted('child-1', { directory: '/repo' }),
    )

    expect(useSessionStatus.getState().outcomes.get('child-1')).toBeUndefined()
  })

  it('forgets a deleted session status, knowledge, and outcome while keeping the list invalidation', async () => {
    const queryClient = createTestQueryClient()
    queryClient.setQueryData(['opencode', 'sessions', '/repo'], { pages: [], pageParams: [] })
    const harness = await renderProvider({ queryClient })

    harness.push(sessionExecutionFailed('child-1', 'boom', { directory: '/repo' }))
    expect(useSessionStatus.getState().outcomes.get('child-1')).toBe('failed')
    expect(useSessionStatus.getState().knownSessions.has('child-1')).toBe(true)

    harness.push(sessionDeleted('child-1', { directory: '/repo' }))

    const after = useSessionStatus.getState()
    expect(after.statuses.has('child-1')).toBe(false)
    expect(after.knownSessions.has('child-1')).toBe(false)
    expect(after.outcomes.has('child-1')).toBe(false)

    await waitFor(() => {
      expect(queryClient.getQueryState(['opencode', 'sessions', '/repo'])?.isInvalidated).toBe(true)
    })
  })

  it('invalidates only the reconciliation of children that moved from busy to unknown during a poll', async () => {
    const harness = await renderProvider({
      fakeTimers: true,
      api: { repos: [makeRepo({ id: 123, fullPath: '/repo' })], active: { 'child-1': { type: 'running' }, 'child-2': { type: 'running' } } },
    })
    const queryClient = harness.queryClient
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    queryClient.setQueryData(['opencode', 'session-reconcile', 'child-1'], { id: 'child-1' })
    queryClient.setQueryData(['opencode', 'session-reconcile', 'child-2'], { id: 'child-2' })

    harness.api.active = { 'child-2': { type: 'running' } }
    invalidateQueries.mockClear()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['opencode', 'session-reconcile', 'child-1'] })
    expect(invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ['opencode', 'session-reconcile', 'child-2'] })
    expect(invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ['opencode', 'session-reconcile'] })
  })

  it('reconciles the global active snapshot on reconnect and clears omitted sessions', async () => {
    const harness = await renderProvider({ api: { repos: [makeRepo({ id: 123, fullPath: '/repo' })] } })

    act(() => {
      useSessionStatus.getState().setStatus('session-other', { type: 'busy' })
      useSessionStatus.getState().setStatus('session-stale', { type: 'busy' })
    })

    harness.api.active = { 'session-other': { type: 'running' } }
    await harness.reconnect()

    await waitFor(() => {
      expect(useSessionStatus.getState().getStatus('session-other')).toEqual({ type: 'busy' })
      expect(useSessionStatus.getState().getStatus('session-stale')).toEqual({ type: 'idle' })
    })
  })

  it('ignores a superseded connect snapshot that resolves after a newer reconnect snapshot', async () => {
    const first = createDeferred<ActiveSnapshot>()
    const second = createDeferred<ActiveSnapshot>()
    const harness = await renderProvider({
      api: {
        repos: [makeRepo({ id: 123, fullPath: '/repo' })],
        activeResponder: snapshotResponder(first.promise, second.promise),
      },
    })

    expect(activeSessionServers(harness.fetchFake)).toHaveLength(1)

    await harness.reconnect()
    expect(activeSessionServers(harness.fetchFake)).toHaveLength(2)

    await act(async () => {
      second.resolve({ 'session-new': { type: 'running' } })
      await second.promise
    })
    await waitFor(() => expect(useSessionStatus.getState().getStatus('session-new')).toEqual({ type: 'busy' }))

    await act(async () => {
      first.resolve({ 'session-old': { type: 'running' } })
      await first.promise
    })

    expect(useSessionStatus.getState().getStatus('session-new')).toEqual({ type: 'busy' })
    expect(useSessionStatus.getState().getStatus('session-old')).toEqual({ type: 'idle' })
  })

  it('does not apply a global snapshot that resolves after unmount', async () => {
    const deferred = createDeferred<ActiveSnapshot>()
    const harness = await renderProvider({
      api: {
        repos: [makeRepo({ id: 123, fullPath: '/repo' })],
        activeResponder: snapshotResponder(deferred.promise),
      },
    })

    expect(activeSessionServers(harness.fetchFake)).toHaveLength(1)
    harness.unmount()

    await act(async () => {
      deferred.resolve({ 'session-late': { type: 'running' } })
      await deferred.promise
    })

    expect(useSessionStatus.getState().getStatus('session-late')).toEqual({ type: 'idle' })
  })

  it('does not let a deferred connect snapshot revert an idle event received while it was in flight', async () => {
    const deferred = createDeferred<ActiveSnapshot>()
    const harness = await renderProvider({
      api: {
        repos: [makeRepo({ id: 123, fullPath: '/repo' })],
        activeResponder: snapshotResponder(deferred.promise),
      },
    })

    harness.push(
      sessionStatusUpdated('session-a', { type: 'busy' }, { directory: '/repo' }),
      sessionIdle('session-a', { directory: '/repo' }),
    )

    await act(async () => {
      deferred.resolve({ 'session-a': { type: 'running' } })
      await deferred.promise
    })

    expect(useSessionStatus.getState().getStatus('session-a')).toEqual({ type: 'idle' })
  })

  it('does not let a deferred empty connect snapshot erase a session that started while it was in flight', async () => {
    const deferred = createDeferred<ActiveSnapshot>()
    const harness = await renderProvider({
      api: {
        repos: [makeRepo({ id: 123, fullPath: '/repo' })],
        activeResponder: snapshotResponder(deferred.promise),
      },
    })

    harness.push(sessionExecutionStarted('session-a', { directory: '/repo' }))

    await act(async () => {
      deferred.resolve({})
      await deferred.promise
    })

    expect(useSessionStatus.getState().getStatus('session-a')).toEqual({ type: 'busy' })
  })

  it('does not let a deferred connect snapshot resurrect an unknown session that went idle', async () => {
    const deferred = createDeferred<ActiveSnapshot>()
    const harness = await renderProvider({
      api: {
        repos: [makeRepo({ id: 123, fullPath: '/repo' })],
        activeResponder: snapshotResponder(deferred.promise),
      },
    })

    harness.push(sessionIdle('session-unseen', { directory: '/repo' }))

    await act(async () => {
      deferred.resolve({ 'session-unseen': { type: 'running' } })
      await deferred.promise
    })

    expect(useSessionStatus.getState().getStatus('session-unseen')).toEqual({ type: 'idle' })
  })

  it('debounces a session list invalidation on session lifecycle events', async () => {
    const queryClient = createTestQueryClient()
    queryClient.setQueryData(['opencode', 'sessions', '/repo'], { pages: [], pageParams: [] })
    const harness = await renderProvider({ queryClient })
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    await settleInvalidations()
    invalidateQueries.mockClear()

    harness.push(
      sessionCreated('session-9', { directory: '/repo' }),
      sessionRenamed('session-9', 'Renamed', { directory: '/repo' }),
      sessionDeleted('session-9', { directory: '/repo' }),
    )

    await waitFor(() => {
      expect(queryClient.getQueryState(['opencode', 'sessions', '/repo'])?.isInvalidated).toBe(true)
    })
    expect(invalidateQueries).toHaveBeenCalledTimes(1)
  })

  it('invalidates the session list when a session is forked', async () => {
    const queryClient = createTestQueryClient()
    queryClient.setQueryData(['opencode', 'sessions', '/repo'], { pages: [], pageParams: [] })
    const harness = await renderProvider({ queryClient })

    harness.push(sessionForked('session-fork', 'session-9', { directory: '/repo' }))

    await waitFor(() => {
      expect(queryClient.getQueryState(['opencode', 'sessions', '/repo'])?.isInvalidated).toBe(true)
    })
  })

  it('invalidates only the session list for the event directory', async () => {
    const queryClient = createTestQueryClient()
    queryClient.setQueryData(['opencode', 'sessions', '/repo-a'], { pages: [], pageParams: [] })
    queryClient.setQueryData(['opencode', 'sessions', '/repo-b'], { pages: [], pageParams: [] })
    const harness = await renderProvider({ queryClient })

    harness.push(sessionCreated('session-9', { directory: '/repo-a' }))

    await waitFor(() => {
      expect(queryClient.getQueryState(['opencode', 'sessions', '/repo-a'])?.isInvalidated).toBe(true)
    })
    expect(queryClient.getQueryState(['opencode', 'sessions', '/repo-b'])?.isInvalidated).toBe(false)
  })

  it('does not invalidate session lists on session.usage.updated', async () => {
    const queryClient = createTestQueryClient()
    queryClient.setQueryData(['opencode', 'sessions', '/repo'], { pages: [], pageParams: [] })
    const harness = await renderProvider({ queryClient })
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    await settleInvalidations()
    invalidateQueries.mockClear()

    harness.push(sessionUsageUpdated('session-9', { directory: '/repo' }))

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300))
    })

    expect(invalidateQueries).not.toHaveBeenCalled()
    expect(queryClient.getQueryState(['opencode', 'sessions', '/repo'])?.isInvalidated).toBe(false)
  })

  it('fetches the active session snapshot on connect and polls every 5 seconds while connected', async () => {
    const harness = await renderProvider({
      fakeTimers: true,
      api: { repos: [makeRepo({ id: 123, fullPath: '/repo' })] },
    })

    expect(activeSessionServers(harness.fetchFake)).toHaveLength(2)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(activeSessionServers(harness.fetchFake)).toHaveLength(3)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(activeSessionServers(harness.fetchFake)).toHaveLength(4)

    harness.disconnect()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000)
    })
    expect(activeSessionServers(harness.fetchFake)).toHaveLength(4)
  })

  it('stops polling the active session snapshot after unmount', async () => {
    const harness = await renderProvider({
      fakeTimers: true,
      api: { repos: [makeRepo({ id: 123, fullPath: '/repo' })] },
    })

    expect(activeSessionServers(harness.fetchFake)).toHaveLength(2)
    harness.unmount()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000)
    })
    expect(activeSessionServers(harness.fetchFake)).toHaveLength(2)
  })

  it('records the parent of a session created with a parentID', async () => {
    const harness = await renderProvider()

    harness.push(sessionCreated('child-1', { directory: '/repo' }, { parentID: 'parent-1' }))

    expect(useSessionStatus.getState().parents.get('child-1')).toBe('parent-1')
  })

  it('tracks a running background shell and clears it when it exits', async () => {
    const harness = await renderProvider()

    harness.push(shellCreated({ id: 'shell-1', status: 'running', sessionID: 'session-1' }, { directory: '/repo' }))
    expect(useSessionStatus.getState().runningShells.get('shell-1')).toEqual({
      sessionID: 'session-1',
      directory: '/repo',
    })

    harness.push(shellExited('shell-1', 'exited', { directory: '/repo' }))
    expect(useSessionStatus.getState().runningShells.has('shell-1')).toBe(false)
  })

  it('clears a running background shell when it is deleted', async () => {
    const harness = await renderProvider()

    harness.push(shellCreated({ id: 'shell-1', status: 'running', sessionID: 'session-1' }, { directory: '/repo' }))
    expect(useSessionStatus.getState().runningShells.has('shell-1')).toBe(true)

    harness.push(shellDeleted('shell-1', { directory: '/repo' }))
    expect(useSessionStatus.getState().runningShells.has('shell-1')).toBe(false)
  })

  it('resolves active session ancestry from the snapshot, walking up to a known root', async () => {
    const harness = await renderProvider({
      api: {
        repos: [makeRepo({ id: 123, fullPath: '/repo' })],
        active: { 'child-1': { type: 'running' } },
        sessions: new Map([
          ['child-1', makeSession({ id: 'child-1', parentID: 'parent-1', location: { directory: '/repo' } })],
          ['parent-1', makeSession({ id: 'parent-1', location: { directory: '/repo' } })],
        ]),
      },
    })

    await harness.reconnect()

    await waitFor(() => {
      expect(useSessionStatus.getState().parents.get('child-1')).toBe('parent-1')
      expect(useSessionStatus.getState().parents.get('parent-1')).toBeNull()
    })
  })

  it('populates running shells from the directory snapshot on connect', async () => {
    const harness = await renderProvider({
      api: {
        repos: [makeRepo({ id: 123, fullPath: '/repo' })],
        shells: [
          { id: 'shell-1', status: 'running', command: 'echo', cwd: '/repo', shell: 'bash', file: '/tmp/1.log', metadata: { sessionID: 'session-1' }, time: { started: 1 } },
          { id: 'shell-2', status: 'exited', command: 'echo', cwd: '/repo', shell: 'bash', file: '/tmp/2.log', metadata: { sessionID: 'session-2' }, time: { started: 1 } },
        ],
      },
    })

    await waitFor(() => {
      expect(runningShellRequests(harness.fetchFake)).toContainEqual({ serverId: 'local', directory: '/repo' })
      expect(useSessionStatus.getState().runningShells.get('shell-1')).toEqual({
        sessionID: 'session-1',
        directory: '/repo',
      })
      expect(useSessionStatus.getState().runningShells.has('shell-2')).toBe(false)
    })
  })

  it('does not let a directory shell snapshot resurrect a shell that exited while it was in flight', async () => {
    const deferred = createDeferred<FetchRouteResult>()
    const harness = await renderProvider({
      api: {
        repos: [makeRepo({ id: 123, fullPath: '/repo' })],
        shellsResponder: () => deferred.promise,
      },
    })
    await waitFor(() => expect(runningShellRequests(harness.fetchFake).length).toBeGreaterThan(0))

    harness.push(shellExited('shell-1', 'exited', { directory: '/repo' }))

    await act(async () => {
      deferred.resolve({
        json: {
          data: [
            { id: 'shell-1', status: 'running', command: 'echo', cwd: '/repo', shell: 'bash', file: '/tmp/1.log', metadata: { sessionID: 'session-1' }, time: { started: 1 } },
          ],
        },
      })
      await deferred.promise
    })

    expect(useSessionStatus.getState().runningShells.has('shell-1')).toBe(false)
  })

  it('does not let a directory shell snapshot drop a shell created while it was in flight', async () => {
    const deferred = createDeferred<FetchRouteResult>()
    const harness = await renderProvider({
      api: { repos: [makeRepo({ id: 123, fullPath: '/repo' })], shellsResponder: () => deferred.promise },
    })
    await waitFor(() => expect(runningShellRequests(harness.fetchFake).length).toBeGreaterThan(0))

    harness.push(shellCreated({ id: 'shell-2', status: 'running', sessionID: 'session-2' }, { directory: '/repo' }))

    await act(async () => {
      deferred.resolve({ json: { data: [] } })
      await deferred.promise
    })

    expect(useSessionStatus.getState().runningShells.get('shell-2')).toEqual({
      sessionID: 'session-2',
      directory: '/repo',
    })
  })

  it('resolves ancestry for a shell owner from a newly subscribed directory snapshot', async () => {
    await renderProvider({
      api: {
        repos: [makeRepo({ id: 123, fullPath: '/repo' })],
        shells: [{ id: 'shell-1', status: 'running', command: 'echo', cwd: '/repo', shell: 'bash', file: '/tmp/1.log', metadata: { sessionID: 'child-1' }, time: { started: 1 } }],
        sessions: new Map([
          ['child-1', makeSession({ id: 'child-1', parentID: 'parent-1', location: { directory: '/repo' } })],
          ['parent-1', makeSession({ id: 'parent-1', location: { directory: '/repo' } })],
        ]),
      },
    })

    await waitFor(() => expect(useSessionStatus.getState().parents.get('child-1')).toBe('parent-1'))
    expect(hasBackgroundActivity(useSessionStatus.getState(), 'parent-1')).toBe(true)
  })

  it('continues a known child to parent link up to the grandparent', async () => {
    act(() => {
      useSessionStatus.getState().setSessionParent('child-1', 'parent-1')
    })
    const harness = await renderProvider({
      api: {
        repos: [makeRepo({ id: 123, fullPath: '/repo' })],
        active: { 'child-1': { type: 'running' } },
        sessions: new Map([
          ['parent-1', makeSession({ id: 'parent-1', parentID: 'grandparent-1', location: { directory: '/repo' } })],
          ['grandparent-1', makeSession({ id: 'grandparent-1', location: { directory: '/repo' } })],
        ]),
      },
    })

    await harness.reconnect()

    await waitFor(() => {
      expect(useSessionStatus.getState().parents.get('parent-1')).toBe('grandparent-1')
      expect(useSessionStatus.getState().parents.get('grandparent-1')).toBeNull()
    })
    expect(harness.fetchFake.findRequests('GET', `${localApi}/session/parent-1`)).toHaveLength(1)
  })

  it('syncs running shells for a directory whose repo arrives after connect', async () => {
    const harness = await renderProvider()
    expect(runningShellRequests(harness.fetchFake)).toHaveLength(0)

    harness.api.repos = [makeRepo({ id: 123, fullPath: '/repo' })]
    await harness.queryClient.refetchQueries({ queryKey: ['repos'] })

    await waitFor(() =>
      expect(runningShellRequests(harness.fetchFake)).toContainEqual({ serverId: 'local', directory: '/repo' }),
    )
  })

  it('reconciles newly subscribed directories reported by the stream', async () => {
    const harness = await renderProvider({
      api: { permissions: [pendingPermission], forms: [pendingForm] },
    })

    act(() => {
      useSessionStatus.getState().setShellRunning('shell-stale', 'session-1', '/session-dir')
    })
    expect(useSessionStatus.getState().runningShells.has('shell-stale')).toBe(true)

    await waitFor(() => {
      expect(runningShellRequests(harness.fetchFake)).toContainEqual({ serverId: 'local', directory: '/session-dir' })
      expect(pendingPermissions(harness.fetchFake)).toContainEqual({ serverId: 'local', directory: '/session-dir' })
      expect(pendingForms(harness.fetchFake)).toContainEqual({ serverId: 'local', directory: '/session-dir' })
    })
    expect(useSessionStatus.getState().runningShells.has('shell-stale')).toBe(false)
    expect(permissionCountText()).toBe('1')
    expect(formCountText()).toBe('1')
  })

  it('reconciles subscribed directories reported by a resync even when they are not tracked', async () => {
    const harness = await renderProvider({
      api: { permissions: [pendingPermission], forms: [pendingForm] },
    })

    act(() => {
      useSessionStatus.getState().setShellRunning('shell-stale', 'session-1', '/unregistered-dir')
    })
    expect(useSessionStatus.getState().runningShells.has('shell-stale')).toBe(true)

    await harness.resync()

    await waitFor(() => {
      expect(runningShellRequests(harness.fetchFake)).toContainEqual({ serverId: 'local', directory: '/unregistered-dir' })
      expect(pendingPermissions(harness.fetchFake)).toContainEqual({ serverId: 'local', directory: '/unregistered-dir' })
      expect(pendingForms(harness.fetchFake)).toContainEqual({ serverId: 'local', directory: '/unregistered-dir' })
    })
    expect(useSessionStatus.getState().runningShells.has('shell-stale')).toBe(false)
    expect(permissionCountText()).toBe('1')
    expect(formCountText()).toBe('1')
  })

  it('subscribes the directories of active sessions outside the repo directories', async () => {
    const harness = await renderProvider({ api: { repos: [makeRepo({ id: 123, fullPath: '/repo' })] } })

    await waitFor(() => expect(subscribedDirectories(harness.eventStream)).toContain('/repo'))

    act(() => {
      useSessionStatus.getState().setSessionDirectory('session-worktree', '/repo/.worktrees/feature')
      useSessionStatus.getState().setStatus('session-worktree', { type: 'busy' })
    })

    await waitFor(() => expect(subscribedDirectories(harness.eventStream)).toContain('/repo/.worktrees/feature'))

    act(() => {
      useSessionStatus.getState().setStatus('session-worktree', { type: 'idle' })
    })

    await waitFor(() => expect(unsubscribedDirectories(harness.eventStream)).toContain('/repo/.worktrees/feature'))
  })

  it('selects the server-keyed directory of an active remote session', () => {
    const key = selectActiveSessionDirectoriesKey({
      statuses: new Map([['remote-session', { type: 'busy' }]]),
      directories: new Map([['remote-session', 'srv_remote|/remote/repo']]),
      runningShells: new Map([
        ['shell-1', { sessionID: 'remote-session', directory: 'srv_remote|/remote/repo' }],
      ]),
    })

    expect(key).toBe('srv_remote|/remote/repo')
  })

  it('keys a remote session directory and routes its lookups to the remote server', async () => {
    const harness = await renderProvider({ api: { repos: [makeRepo({ id: 123, fullPath: '/repo' })] } })

    harness.push(sessionStatusUpdated('remote-session', { type: 'busy' }, { serverId: 'srv_remote', directory: '/remote/repo' }))

    expect(useSessionStatus.getState().directories.get('remote-session')).toBe('srv_remote|/remote/repo')
    expect(useSessionStatus.getState().getStatus('remote-session')).toEqual({ type: 'busy' })

    await waitFor(() => expect(subscribedDirectories(harness.eventStream)).toContain('srv_remote|/remote/repo'))

    await waitFor(() => {
      expect(pendingPermissions(harness.fetchFake)).toContainEqual({ serverId: 'srv_remote', directory: '/remote/repo' })
      expect(pendingForms(harness.fetchFake)).toContainEqual({ serverId: 'srv_remote', directory: '/remote/repo' })
      expect(runningShellRequests(harness.fetchFake)).toContainEqual({ serverId: 'srv_remote', directory: '/remote/repo' })
    })
  })

  it('keeps a remote session busy across a local active-session snapshot', async () => {
    const harness = await renderProvider({
      fakeTimers: true,
      api: { repos: [makeRepo({ id: 123, fullPath: '/repo' })] },
    })

    harness.push(sessionStatusUpdated('remote-session', { type: 'busy' }, { serverId: 'srv_remote' }))
    expect(useSessionStatus.getState().directories.has('remote-session')).toBe(false)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    expect(activeSessionServers(harness.fetchFake).length).toBeGreaterThanOrEqual(2)
    expect(useSessionStatus.getState().getStatus('remote-session')).toEqual({ type: 'busy' })
    expect(useSessionStatus.getState().knownSessions.has('remote-session')).toBe(true)
  })

  it('scopes a remote resync to that server and skips the local snapshot', async () => {
    const harness = await renderProvider()
    const invalidateQueries = vi.spyOn(harness.queryClient, 'invalidateQueries')

    harness.push(sessionStatusUpdated('remote-session', { type: 'busy' }, { directory: '/remote/repo', serverId: 'srv_remote' }))
    await act(async () => {
      await Promise.resolve()
    })
    const localSnapshotsBeforeResync = activeSessionServers(harness.fetchFake).filter((server) => server === 'local').length
    await settleInvalidations()
    invalidateQueries.mockClear()

    await harness.resync('srv_remote')

    await waitFor(() => {
      expect(pendingPermissions(harness.fetchFake)).toContainEqual({ serverId: 'srv_remote', directory: '/remote/repo' })
      expect(pendingForms(harness.fetchFake)).toContainEqual({ serverId: 'srv_remote', directory: '/remote/repo' })
      expect(runningShellRequests(harness.fetchFake)).toContainEqual({ serverId: 'srv_remote', directory: '/remote/repo' })
    })
    expect(activeSessionServers(harness.fetchFake).filter((server) => server === 'local')).toHaveLength(localSnapshotsBeforeResync)
    expect(pendingPermissions(harness.fetchFake)).not.toContainEqual({ serverId: 'local', directory: '/repo' })

    await waitFor(() => {
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['opencode', 'commands', 'srv_remote'] })
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['opencode', 'agents', 'srv_remote'] })
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['provider-integrations'] })
    })
    expect(invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ['opencode', 'commands'] })
    expect(invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ['opencode-config', 'managed'] })
  })

  it('reconciles only linked directories with active work on a remote resync', async () => {
    const harness = await renderProvider({
      api: {
        servers: [makeOpenCodeServer({ id: 'srv_remote', enabled: true })],
        projects: [
          { id: 'proj-busy', canonical: '/remote/busy', time: { created: 1, updated: 1, active: 1 }, sandboxes: [] },
          { id: 'proj-idle', canonical: '/remote/idle', time: { created: 1, updated: 1, active: 1 }, sandboxes: [] },
          { id: 'proj-other', canonical: '/remote/other', time: { created: 1, updated: 1, active: 1 }, sandboxes: [] },
        ],
      },
    })

    await waitFor(() => expect(harness.fetchFake.findRequests('GET', `${remoteApi}/project`)).toHaveLength(1))

    harness.push(sessionStatusUpdated('remote-busy', { type: 'busy' }, { directory: '/remote/busy', serverId: 'srv_remote' }))
    await act(async () => {
      await Promise.resolve()
    })

    await harness.resync('srv_remote')

    await waitFor(() => {
      expect(pendingPermissions(harness.fetchFake)).toContainEqual({ serverId: 'srv_remote', directory: '/remote/busy' })
      expect(pendingForms(harness.fetchFake)).toContainEqual({ serverId: 'srv_remote', directory: '/remote/busy' })
      expect(runningShellRequests(harness.fetchFake)).toContainEqual({ serverId: 'srv_remote', directory: '/remote/busy' })
    })
    expect(pendingPermissions(harness.fetchFake)).not.toContainEqual({ serverId: 'srv_remote', directory: '/remote/idle' })
    expect(pendingPermissions(harness.fetchFake)).not.toContainEqual({ serverId: 'srv_remote', directory: '/remote/other' })
  })

  it('reconciles the viewed linked directory even when its session is idle', async () => {
    const harness = await renderProvider({
      route: '/servers/srv_remote/sessions/remote-viewed',
      api: { servers: [makeOpenCodeServer({ id: 'srv_remote', enabled: true })] },
    })

    harness.push(sessionStatusUpdated('remote-viewed', { type: 'idle' }, { directory: '/remote/viewed', serverId: 'srv_remote' }))
    await act(async () => {
      await Promise.resolve()
    })

    await harness.resync('srv_remote')

    await waitFor(() => {
      expect(pendingPermissions(harness.fetchFake)).toContainEqual({ serverId: 'srv_remote', directory: '/remote/viewed' })
      expect(runningShellRequests(harness.fetchFake)).toContainEqual({ serverId: 'srv_remote', directory: '/remote/viewed' })
    })
    expect(pendingPermissions(harness.fetchFake)).not.toContainEqual({ serverId: 'srv_remote', directory: '/remote/idle' })
  })

  it('clears a stale remote busy status on a remote resync', async () => {
    const harness = await renderProvider({ api: { repos: [makeRepo({ id: 123, fullPath: '/repo' })] } })

    act(() => {
      useSessionStatus.getState().setSessionServer('remote-session', 'srv_remote')
      useSessionStatus.getState().setStatus('remote-session', { type: 'busy' })
    })

    await harness.resync('srv_remote')

    await waitFor(() => {
      expect(activeSessionServers(harness.fetchFake)).toContain('srv_remote')
      expect(useSessionStatus.getState().getStatus('remote-session')).toEqual({ type: 'idle' })
    })
  })

  it('reconciles every enabled remote server when the browser stream reconnects', async () => {
    const harness = await renderProvider({
      api: {
        servers: [
          makeOpenCodeServer({ id: 'srv_remote', enabled: true }),
          makeOpenCodeServer({ id: 'srv_disabled', enabled: false }),
        ],
        repos: [makeRepo({ id: 123, fullPath: '/repo' })],
      },
    })

    act(() => {
      useSessionStatus.getState().setSessionServer('remote-session', 'srv_remote')
      useSessionStatus.getState().setStatus('remote-session', { type: 'busy' })
    })

    await harness.reconnect()

    await waitFor(() => {
      expect(activeSessionServers(harness.fetchFake)).toContain('srv_remote')
      expect(useSessionStatus.getState().getStatus('remote-session')).toEqual({ type: 'idle' })
    })
    expect(activeSessionServers(harness.fetchFake)).not.toContain('srv_disabled')
  })

  it('purges pending actions from a server that is not enabled once servers load', async () => {
    const servers = createDeferred<FetchRouteResult>()
    const harness = await renderProvider({
      api: {
        serversResponder: () => servers.promise,
        forms: [secondPendingForm],
      },
    })

    harness.push(
      formCreated(pendingForm, { directory: '/srv/app', serverId: 'srv_removed' }),
      formCreated(secondPendingForm, { directory: '/srv/app', serverId: 'srv_remote' }),
      permissionAsked(pendingPermission, { directory: '/srv/app', serverId: 'srv_removed' }),
    )
    await waitFor(() => {
      expect(formCountText()).toBe('2')
      expect(permissionCountText()).toBe('1')
    })

    await act(async () => {
      servers.resolve({ json: { servers: [makeOpenCodeServer({ id: 'srv_remote', enabled: true })] } })
      await servers.promise
    })

    await waitFor(() => {
      expect(formCountText()).toBe('1')
      expect(permissionCountText()).toBe('0')
    })
    expect(screen.getByTestId('for-session-2')).toHaveTextContent('form-2')
    expect(screen.getByTestId('for-session-1')).toHaveTextContent('none')
  })

  it('subscribes the project directories of enabled remote servers', async () => {
    const harness = await renderProvider({
      api: {
        servers: [makeOpenCodeServer({ id: 'srv_remote', enabled: true })],
        projects: [{ id: 'proj-1', canonical: '/remote/repo', time: { created: 1, updated: 1, active: 1 }, sandboxes: [] }],
      },
    })

    await waitFor(() => expect(subscribedDirectories(harness.eventStream)).toContain('srv_remote|/remote/repo'))
  })

  it('does not fetch projects for disabled remote servers', async () => {
    const { fetchFake } = await renderProvider({
      api: { servers: [makeOpenCodeServer({ id: 'srv_disabled', enabled: false })] },
    })

    await act(async () => {
      await Promise.resolve()
    })
    expect(fetchFake.findRequests('GET', `${remoteApi}/project`)).toHaveLength(0)
  })

  it('drops pending forms of a remote server that becomes unreachable', async () => {
    const harness = await renderProvider()

    harness.push(formCreated(pendingForm, { directory: '/srv/app', serverId: 'srv_remote' }))
    await waitFor(() => expect(formCountText()).toBe('1'))

    harness.api.formsResponder = () => ({ status: 502, json: { error: 'Bad gateway' } })
    act(() => {
      useSessionStatus.getState().setShellRunning('shell-remote', 'session-1', 'srv_remote|/srv/app')
    })

    await waitFor(() => {
      expect(formCountText()).toBe('0')
      expect(screen.getByTestId('current')).toHaveTextContent('none')
    })
  })

  it('drops a pending remote form whose session no longer exists on reconnect', async () => {
    const harness = await renderProvider({
      api: { servers: [makeOpenCodeServer({ id: 'srv_remote', enabled: true })] },
    })

    act(() => {
      useSessionStatus.getState().setSessionParent('session-1', null)
    })
    harness.push(formCreated(pendingForm, { serverId: 'srv_remote' }))
    await waitFor(() => expect(formCountText()).toBe('1'))

    await harness.reconnect()

    await waitFor(() => {
      expect(harness.fetchFake.findRequests('GET', `${remoteApi}/session/session-1`)).toHaveLength(1)
      expect(formCountText()).toBe('0')
      expect(screen.getByTestId('current')).toHaveTextContent('none')
    })
  })

  it('resolves an unknown remote session directory on reconnect', async () => {
    const harness = await renderProvider({
      api: {
        servers: [makeOpenCodeServer({ id: 'srv_remote', enabled: true })],
        sessions: new Map([
          ['session-1', makeSession({ id: 'session-1', location: { directory: '/srv/resolved' } })],
        ]),
      },
    })

    act(() => {
      useSessionStatus.getState().setSessionParent('session-1', null)
    })
    harness.push(formCreated(pendingForm, { serverId: 'srv_remote' }))
    await waitFor(() => expect(formCountText()).toBe('1'))
    expect(useSessionStatus.getState().directories.has('session-1')).toBe(false)

    await harness.reconnect()

    await waitFor(() => {
      expect(pendingForms(harness.fetchFake)).toContainEqual({ serverId: 'srv_remote', directory: '/srv/resolved' })
      expect(useSessionStatus.getState().directories.get('session-1')).toBe('srv_remote|/srv/resolved')
    })
  })

  it('reconciles pending actions for a remote server enabled after the browser stream connects', async () => {
    const harness = await renderProvider()

    act(() => {
      useSessionStatus.getState().setSessionDirectory('remote-session', 'srv_remote|/remote/repo')
      useSessionStatus.getState().setStatus('remote-session', { type: 'busy' })
    })

    harness.api.servers = [makeOpenCodeServer({ id: 'srv_remote', enabled: true })]
    await harness.queryClient.refetchQueries({ queryKey: ['opencode-servers'] })

    await waitFor(() =>
      expect(pendingForms(harness.fetchFake)).toContainEqual({ serverId: 'srv_remote', directory: '/remote/repo' }),
    )
  })
})
