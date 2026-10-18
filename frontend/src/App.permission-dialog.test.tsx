import { render, screen, fireEvent } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PermissionRequest } from '@opencode-manager/shared/opencode'

const mocks = vi.hoisted(() => ({
  usePermissions: vi.fn(),
  getRepoIdForSession: vi.fn(),
  useSession: vi.fn(),
  navigateToCurrent: vi.fn(),
  PermissionRequestDialog: vi.fn(),
}))

vi.mock('@/contexts/EventContext', () => ({
  usePermissions: mocks.usePermissions,
  useEventContext: () => ({ getRepoIdForSession: mocks.getRepoIdForSession }),
}))

vi.mock('@/hooks/useOpenCode', () => ({ useSession: mocks.useSession }))

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

  render(<PermissionDialogWrapper />)

  return mocks.PermissionRequestDialog.mock.calls.at(-1)?.[0] as DialogProps
}

describe('PermissionDialogWrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useSession.mockReturnValue({ data: undefined })
    mocks.PermissionRequestDialog.mockReturnValue(<div data-testid="permission-dialog" />)
  })

  it('offers the session for a linked-server permission without a Manager repo lookup', () => {
    mocks.getRepoIdForSession.mockReturnValue(null)

    const props = renderWrapper(remotePermission)

    expect(props.permission).toEqual(remotePermission)
    expect(props.onOpenSession).toBe(mocks.navigateToCurrent)
    expect(mocks.getRepoIdForSession).not.toHaveBeenCalled()
    expect(mocks.useSession).toHaveBeenCalledWith(undefined, '/srv/app')
  })

  it('offers the session for a local permission resolved through its Manager repo', () => {
    mocks.getRepoIdForSession.mockReturnValue(12)

    const props = renderWrapper(localPermission)

    expect(props.onOpenSession).toBe(mocks.navigateToCurrent)
    expect(mocks.getRepoIdForSession).toHaveBeenCalledWith('ses_local')
    expect(mocks.useSession).toHaveBeenCalledWith('ses_local', '/srv/app')
  })

  it('hides the session action for a local permission without a Manager repo', () => {
    mocks.getRepoIdForSession.mockReturnValue(null)

    const props = renderWrapper(localPermission)

    expect(props.onOpenSession).toBeUndefined()
  })

  it('renders the dialog host', () => {
    renderWrapper(remotePermission)

    expect(screen.getByTestId('permission-dialog')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('permission-dialog'))
  })
})
