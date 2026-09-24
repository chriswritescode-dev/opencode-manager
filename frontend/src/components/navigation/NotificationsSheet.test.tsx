import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { NotificationsSheet } from './NotificationsSheet'
import { usePermissions, useForms } from '@/contexts/EventContext'

vi.mock('@/contexts/EventContext')

describe('NotificationsSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders empty state when both counts are 0', () => {
    vi.mocked(usePermissions).mockReturnValue({
      pendingCount: 0,
      setShowDialog: vi.fn(),
      navigateToCurrent: vi.fn(),
      current: null,
      respond: vi.fn(),
      dismiss: vi.fn(),
      hasForSession: vi.fn(),
    })
    vi.mocked(useForms).mockReturnValue({
      pendingCount: 0,
      navigateToCurrent: vi.fn(),
      current: null,
      reply: vi.fn(),
      cancel: vi.fn(),
      dismiss: vi.fn(),
      hasForSession: vi.fn(),
    })
    const handleClose = vi.fn()
    render(
      <NotificationsSheet isOpen onClose={handleClose} />,
      { wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter> },
    )
    expect(screen.getAllByText("You're all caught up").length).toBe(2)
  })

  it('renders permission section with pending count', () => {
    vi.mocked(usePermissions).mockReturnValue({
      pendingCount: 2,
      setShowDialog: vi.fn(),
      navigateToCurrent: vi.fn(),
      current: {
        id: 'perm-1',
        sessionID: 'session-1',
        action: 'shell',
        resources: ['/test/pattern'],
        metadata: {},
      },
      respond: vi.fn(),
      dismiss: vi.fn(),
      hasForSession: vi.fn(),
    })
    vi.mocked(useForms).mockReturnValue({
      pendingCount: 0,
      navigateToCurrent: vi.fn(),
      current: null,
      reply: vi.fn(),
      cancel: vi.fn(),
      dismiss: vi.fn(),
      hasForSession: vi.fn(),
    })
    const handleClose = vi.fn()
    render(
      <NotificationsSheet isOpen onClose={handleClose} />,
      { wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter> },
    )
    expect(screen.getByText('Pending permissions')).toBeInTheDocument()
    expect(screen.getByText('Run Command')).toBeInTheDocument()
    expect(screen.getByText('+1 more')).toBeInTheDocument()
  })

  it('renders form section with pending count', () => {
    vi.mocked(usePermissions).mockReturnValue({
      pendingCount: 0,
      setShowDialog: vi.fn(),
      navigateToCurrent: vi.fn(),
      current: null,
      respond: vi.fn(),
      dismiss: vi.fn(),
      hasForSession: vi.fn(),
    })
    vi.mocked(useForms).mockReturnValue({
      pendingCount: 1,
      navigateToCurrent: vi.fn(),
      current: {
        id: 'form-1',
        sessionID: 'session-1',
        title: 'Test question',
        fields: [{ key: 'q0', type: 'string', options: [] }],
      },
      reply: vi.fn(),
      cancel: vi.fn(),
      dismiss: vi.fn(),
      hasForSession: vi.fn(),
    })
    const handleClose = vi.fn()
    render(
      <NotificationsSheet isOpen onClose={handleClose} />,
      { wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter> },
    )
    expect(screen.getByText('Pending forms')).toBeInTheDocument()
    expect(screen.getByText('Test question')).toBeInTheDocument()
  })

  it('calls setShowDialog and onClose when permission is clicked', () => {
    const setShowDialogMock = vi.fn()
    const navigateToPermissionMock = vi.fn()
    const handleClose = vi.fn()
    vi.mocked(usePermissions).mockReturnValue({
      pendingCount: 1,
      setShowDialog: setShowDialogMock,
      navigateToCurrent: navigateToPermissionMock,
      current: {
        id: 'perm-1',
        sessionID: 'session-1',
        action: 'shell',
        resources: ['/test/pattern'],
        metadata: {},
      },
      respond: vi.fn(),
      dismiss: vi.fn(),
      hasForSession: vi.fn(),
    })
    vi.mocked(useForms).mockReturnValue({
      pendingCount: 0,
      navigateToCurrent: vi.fn(),
      current: null,
      reply: vi.fn(),
      cancel: vi.fn(),
      dismiss: vi.fn(),
      hasForSession: vi.fn(),
    })
    render(
      <NotificationsSheet isOpen onClose={handleClose} />,
      { wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter> },
    )
    fireEvent.click(screen.getByText('/test/pattern'))
    expect(navigateToPermissionMock).toHaveBeenCalled()
    expect(setShowDialogMock).toHaveBeenCalled()
    expect(handleClose).toHaveBeenCalled()
  })

  it('calls navigateToCurrent and onClose when form is clicked', () => {
    const navigateToFormMock = vi.fn()
    const handleClose = vi.fn()
    vi.mocked(usePermissions).mockReturnValue({
      pendingCount: 0,
      setShowDialog: vi.fn(),
      navigateToCurrent: vi.fn(),
      current: null,
      respond: vi.fn(),
      dismiss: vi.fn(),
      hasForSession: vi.fn(),
    })
    vi.mocked(useForms).mockReturnValue({
      pendingCount: 1,
      navigateToCurrent: navigateToFormMock,
      current: {
        id: 'form-1',
        sessionID: 'session-1',
        title: 'Test question',
        fields: [{ key: 'q0', type: 'string', options: [] }],
      },
      reply: vi.fn(),
      cancel: vi.fn(),
      dismiss: vi.fn(),
      hasForSession: vi.fn(),
    })
    render(
      <NotificationsSheet isOpen onClose={handleClose} />,
      { wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter> },
    )
    fireEvent.click(screen.getByText('Test question'))
    expect(navigateToFormMock).toHaveBeenCalled()
    expect(handleClose).toHaveBeenCalled()
  })
})
