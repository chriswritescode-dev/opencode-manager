import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { MoreDrawer } from './MoreDrawer'
import { useSettingsDialog } from '@/hooks/useSettingsDialog'
import { useSettings } from '@/hooks/useSettings'
import { useAuth } from '@/hooks/useAuth'

vi.mock('@/hooks/useSettingsDialog')
vi.mock('@/hooks/useSettings')
vi.mock('@/hooks/useAuth')

describe('MoreDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders all menu items', () => {
    vi.mocked(useSettingsDialog).mockReturnValue({
      isOpen: false,
      open: vi.fn(),
      close: vi.fn(),
      toggle: vi.fn(),
      activeTab: 'account',
      setActiveTab: vi.fn(),
    })
    vi.mocked(useSettings).mockReturnValue({
      settings: undefined,
      preferences: undefined,
      isLoading: false,
      error: null,
      updateSettings: vi.fn(),
      updateSettingsAsync: vi.fn(),
      resetSettings: vi.fn(),
      isUpdating: false,
      isResetting: false,
    })
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      config: null,
      signInWithEmail: vi.fn(),
      signInWithProvider: vi.fn(),
      signInWithPasskey: vi.fn(),
      signUpWithEmail: vi.fn(),
      addPasskey: vi.fn(),
      logout: vi.fn(),
      refreshSession: vi.fn(),
    })
    const handleClose = vi.fn()
    render(
      <MoreDrawer isOpen onClose={handleClose} />,
      { wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter> },
    )
    expect(screen.getByText('Settings')).toBeInTheDocument()
    expect(screen.getByText('Theme')).toBeInTheDocument()
    expect(screen.getByText('Light')).toBeInTheDocument()
    expect(screen.getByText('Dark')).toBeInTheDocument()
    expect(screen.getByText('System')).toBeInTheDocument()
    expect(screen.getByText('Logout')).toBeInTheDocument()
  })

  it('calls useSettingsDialog.open and onClose when Settings is clicked', () => {
    const openSettingsMock = vi.fn()
    vi.mocked(useSettingsDialog).mockReturnValue({
      isOpen: false,
      open: openSettingsMock,
      close: vi.fn(),
      toggle: vi.fn(),
      activeTab: 'account',
      setActiveTab: vi.fn(),
    })
    vi.mocked(useSettings).mockReturnValue({
      settings: undefined,
      preferences: undefined,
      isLoading: false,
      error: null,
      updateSettings: vi.fn(),
      updateSettingsAsync: vi.fn(),
      resetSettings: vi.fn(),
      isUpdating: false,
      isResetting: false,
    })
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      config: null,
      signInWithEmail: vi.fn(),
      signInWithProvider: vi.fn(),
      signInWithPasskey: vi.fn(),
      signUpWithEmail: vi.fn(),
      addPasskey: vi.fn(),
      logout: vi.fn(),
      refreshSession: vi.fn(),
    })
    const handleClose = vi.fn()
    render(
      <MoreDrawer isOpen onClose={handleClose} />,
      { wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter> },
    )
    fireEvent.click(screen.getByText('Settings'))
    expect(openSettingsMock).toHaveBeenCalled()
    expect(handleClose).toHaveBeenCalled()
  })

  it('calls logout when Logout is clicked', async () => {
    const logoutMock = vi.fn().mockResolvedValue(undefined)
    vi.mocked(useSettingsDialog).mockReturnValue({
      isOpen: false,
      open: vi.fn(),
      close: vi.fn(),
      toggle: vi.fn(),
      activeTab: 'account',
      setActiveTab: vi.fn(),
    })
    vi.mocked(useSettings).mockReturnValue({
      settings: undefined,
      preferences: undefined,
      isLoading: false,
      error: null,
      updateSettings: vi.fn(),
      updateSettingsAsync: vi.fn(),
      resetSettings: vi.fn(),
      isUpdating: false,
      isResetting: false,
    })
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      config: null,
      signInWithEmail: vi.fn(),
      signInWithProvider: vi.fn(),
      signInWithPasskey: vi.fn(),
      signUpWithEmail: vi.fn(),
      addPasskey: vi.fn(),
      logout: logoutMock,
      refreshSession: vi.fn(),
    })
    const handleClose = vi.fn()
    render(
      <MoreDrawer isOpen onClose={handleClose} />,
      { wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter> },
    )
    fireEvent.click(screen.getByText('Logout'))
    expect(logoutMock).toHaveBeenCalled()
  })

  it('calls updateSettings with theme when theme button is clicked', () => {
    const updateSettingsMock = vi.fn()
    vi.mocked(useSettingsDialog).mockReturnValue({
      isOpen: false,
      open: vi.fn(),
      close: vi.fn(),
      toggle: vi.fn(),
      activeTab: 'account',
      setActiveTab: vi.fn(),
    })
    vi.mocked(useSettings).mockReturnValue({
      settings: undefined,
      preferences: { theme: 'dark' },
      isLoading: false,
      error: null,
      updateSettings: updateSettingsMock,
      updateSettingsAsync: vi.fn(),
      resetSettings: vi.fn(),
      isUpdating: false,
      isResetting: false,
    })
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      config: null,
      signInWithEmail: vi.fn(),
      signInWithProvider: vi.fn(),
      signInWithPasskey: vi.fn(),
      signUpWithEmail: vi.fn(),
      addPasskey: vi.fn(),
      logout: vi.fn(),
      refreshSession: vi.fn(),
    })
    const handleClose = vi.fn()
    render(
      <MoreDrawer isOpen onClose={handleClose} />,
      { wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter> },
    )
    fireEvent.click(screen.getByText('Light'))
    expect(updateSettingsMock).toHaveBeenCalledWith({ theme: 'light' })
  })
})
