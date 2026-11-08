import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { PermissionRequest } from '@opencode-manager/shared/opencode'

const mocks = vi.hoisted(() => ({
  usePermissions: vi.fn(),
  getLocalSessionPath: vi.fn(),
  sessionQueryOptions: vi.fn(),
  navigateToCurrent: vi.fn(),
  PermissionRequestDialog: vi.fn(),
}))

vi.mock('@/contexts/EventContext', () => ({
  usePermissions: mocks.usePermissions,
  useEventContext: () => ({ getLocalSessionPath: mocks.getLocalSessionPath }),
}))

vi.mock('@/hooks/useOpenCode', () => ({ sessionQueryOptions: mocks.sessionQueryOptions }))

vi.mock('@/components/session/PermissionRequestDialog', () => ({
  PermissionRequestDialog: mocks.PermissionRequestDialog,
}))

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, createBrowserRouter: vi.fn(() => ({ routes: [] })) }
})

import { PermissionDialogWrapper } from './App'

type PendingPermission = PermissionRequest & { serverId: string }

const remotePermission: PendingPermission = {
  id: 'permission-1',
  sessionID: 'ses_remote',
  action: 'shell',
  resources: ['echo hello'],
  metadata: {},
  serverId: 'srv_kitchen',
}

const localPermission: PendingPermission = {
  id: 'permission-2',
  sessionID: 'ses_local',
  action: 'shell',
  resources: ['echo hello'],
  metadata: {},
  serverId: 'local',
}

interface DialogProps {
  permission: PermissionRequest | null
  sessionTitle?: string
  onOpenSession?: () => void
}

function renderWrapper(permission: PendingPermission) {
  mocks.usePermissions.mockReturnValue({
    current: permission,
    pendingCount: 1,
    respond: vi.fn(),
    showDialog: true,
    setShowDialog: vi.fn(),
    navigateToCurrent: mocks.navigateToCurrent,
    viewedSessionId: null,
    currentDirectory: '/srv/app',
    currentIsFromDifferentSession: false,
  })

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <PermissionDialogWrapper />
    </QueryClientProvider>,
  )

  return mocks.PermissionRequestDialog.mock.calls.at(-1)?.[0] as DialogProps
}

describe('PermissionDialogWrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.sessionQueryOptions.mockImplementation((sessionID: string | undefined, directory?: string, serverId?: string) => ({
      queryKey: ['session', sessionID ?? null, directory ?? null, serverId ?? null],
      queryFn: async () => ({ title: 'Kitchen deploy' }),
      enabled: !!sessionID,
    }))
    mocks.PermissionRequestDialog.mockReturnValue(<div data-testid="permission-dialog" />)
  })

  it('offers the session for a linked-server permission without a local path lookup', () => {
    mocks.getLocalSessionPath.mockReturnValue(null)

    const props = renderWrapper(remotePermission)

    expect(props.permission).toEqual(remotePermission)
    expect(props.onOpenSession).toBe(mocks.navigateToCurrent)
    expect(mocks.getLocalSessionPath).not.toHaveBeenCalled()
    expect(mocks.sessionQueryOptions).toHaveBeenCalledWith('ses_remote', '/srv/app', 'srv_kitchen')
  })

  it('resolves the remote session title from the permission server', async () => {
    mocks.getLocalSessionPath.mockReturnValue(null)

    renderWrapper(remotePermission)

    await waitFor(() => {
      const latest = mocks.PermissionRequestDialog.mock.calls.at(-1)?.[0] as DialogProps
      expect(latest.sessionTitle).toBe('Kitchen deploy')
    })
  })

  it('offers the session for a local permission resolved through its repo', () => {
    mocks.getLocalSessionPath.mockReturnValue('/repos/12/sessions/ses_local')

    const props = renderWrapper(localPermission)

    expect(props.onOpenSession).toBe(mocks.navigateToCurrent)
    expect(mocks.getLocalSessionPath).toHaveBeenCalledWith('ses_local')
    expect(mocks.sessionQueryOptions).toHaveBeenCalledWith('ses_local', '/srv/app', 'local')
  })

  it('offers the session for a local permission resolved through its chat', () => {
    const chatId = '20260101-120000-abcdef'
    mocks.getLocalSessionPath.mockReturnValue(`/chats/${chatId}/sessions/ses_local`)

    const props = renderWrapper(localPermission)

    expect(props.onOpenSession).toBe(mocks.navigateToCurrent)
    expect(mocks.getLocalSessionPath).toHaveBeenCalledWith('ses_local')
  })

  it('hides the session action for a local permission without a repo or chat', () => {
    mocks.getLocalSessionPath.mockReturnValue(null)

    const props = renderWrapper(localPermission)

    expect(props.onOpenSession).toBeUndefined()
  })

  it('renders the dialog host', () => {
    renderWrapper(remotePermission)

    expect(screen.getByTestId('permission-dialog')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('permission-dialog'))
  })
})
