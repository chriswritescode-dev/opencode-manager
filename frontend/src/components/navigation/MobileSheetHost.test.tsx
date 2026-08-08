import { vi } from 'vitest'

vi.mock('@/hooks/useMobile')
vi.mock('@/hooks/useMobileTabBar', () => ({
  useMobileTabBar: vi.fn(),
}))
vi.mock('@/components/file-browser/FileBrowserSheet', () => ({
  FileBrowserSheet: ({ isOpen, basePath, repoName }: { isOpen: boolean; basePath: string; repoName: string }) =>
    isOpen ? <div data-testid="file-browser-sheet" data-base-path={basePath} data-repo-name={repoName}>FileBrowserSheet</div> : null,
}))
vi.mock('@/components/navigation/RepoQuickSwitchSheet', () => ({
  RepoQuickSwitchSheet: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="repo-quick-switch-sheet">RepoQuickSwitchSheet</div> : null,
}))
vi.mock('@/components/navigation/NotificationsSheet', () => ({
  NotificationsSheet: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="notifications-sheet">NotificationsSheet</div> : null,
}))
vi.mock('@/components/navigation/MoreDrawer', () => ({
  MoreDrawer: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="more-drawer">MoreDrawer</div> : null,
}))

import { render, screen } from '@testing-library/react'
import { describe, it, expect, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { MobileSheetHost } from './MobileSheetHost'
import { useMobile } from '@/hooks/useMobile'
import { useMobileTabBar } from '@/hooks/useMobileTabBar'

describe('MobileSheetHost', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useMobile).mockReturnValue(true)
    vi.mocked(useMobileTabBar).mockReturnValue({
      openSheet: null,
      open: vi.fn(),
      close: vi.fn(),
    })
  })

  it('renders nothing when useMobile returns false', () => {
    vi.mocked(useMobile).mockReturnValue(false)
    const { container } = render(
      <MemoryRouter>
        <MobileSheetHost />
      </MemoryRouter>,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when no mobileTab param is present', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/']}>
        <MobileSheetHost />
      </MemoryRouter>,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders RepoQuickSwitchSheet when mobileTab=repos', () => {
    vi.mocked(useMobileTabBar).mockReturnValue({
      openSheet: 'repos',
      open: vi.fn(),
      close: vi.fn(),
    })
    render(
      <MemoryRouter initialEntries={['/?mobileTab=repos']}>
        <MobileSheetHost />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('repo-quick-switch-sheet')).toBeInTheDocument()
  })

  it('renders FileBrowserSheet with correct props when mobileTab=files', () => {
    vi.mocked(useMobileTabBar).mockReturnValue({
      openSheet: 'files',
      open: vi.fn(),
      close: vi.fn(),
    })
    render(
      <MemoryRouter initialEntries={['/?mobileTab=files']}>
        <MobileSheetHost />
      </MemoryRouter>,
    )
    const sheet = screen.getByTestId('file-browser-sheet')
    expect(sheet).toBeInTheDocument()
    expect(sheet.getAttribute('data-base-path')).toBe('')
    expect(sheet.getAttribute('data-repo-name')).toBe('Workspace Root')
  })

  it('renders NotificationsSheet when mobileTab=notifications', () => {
    vi.mocked(useMobileTabBar).mockReturnValue({
      openSheet: 'notifications',
      open: vi.fn(),
      close: vi.fn(),
    })
    render(
      <MemoryRouter initialEntries={['/?mobileTab=notifications']}>
        <MobileSheetHost />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('notifications-sheet')).toBeInTheDocument()
  })

  it('renders MoreDrawer when mobileTab=more', () => {
    vi.mocked(useMobileTabBar).mockReturnValue({
      openSheet: 'more',
      open: vi.fn(),
      close: vi.fn(),
    })
    render(
      <MemoryRouter initialEntries={['/?mobileTab=more']}>
        <MobileSheetHost />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('more-drawer')).toBeInTheDocument()
  })

  it('closes sheet when onClose is called', () => {
    const mockClose = vi.fn()
    vi.mocked(useMobileTabBar).mockReturnValue({
      openSheet: 'repos',
      open: vi.fn(),
      close: mockClose,
    })
    render(
      <MemoryRouter initialEntries={['/?mobileTab=repos']}>
        <MobileSheetHost />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('repo-quick-switch-sheet')).toBeInTheDocument()
  })
})
