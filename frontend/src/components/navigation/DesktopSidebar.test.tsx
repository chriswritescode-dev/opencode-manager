import { describe, expect, it } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { DesktopSidebar } from './DesktopSidebar'
import { useUIState } from '@/stores/uiStateStore'
import { installWindowSize } from '@/test/browserFakes'
import { renderWithProviders } from '@/test/render'
import { LocationCatcher } from '@/test/test-components'
import { appRoutes } from '@/test/fixtures/appRoutes'
import { TooltipProvider } from '@/components/ui/tooltip'
import { KeyboardShortcutsProvider } from '@/contexts/KeyboardShortcutsContext'
import type { FetchRoute } from '@/test/fetchFake'
import type { TestAuthMode } from '@/test/render'

interface RenderOptions {
  route?: string
  mobile?: boolean
  collapsed?: boolean
  auth?: TestAuthMode
  authRoutes?: FetchRoute[]
}

function renderSidebar(options: RenderOptions = {}) {
  installWindowSize(options.mobile ? 500 : 1024)
  if (options.collapsed) localStorage.setItem('oc:sidebar:collapsed', 'true')
  const capturedPathname = { current: '' }
  const capturedSearch = { current: '' }
  const result = renderWithProviders(
    <KeyboardShortcutsProvider>
      <TooltipProvider>
        <DesktopSidebar />
        <LocationCatcher capturedPathname={capturedPathname} capturedSearch={capturedSearch} />
      </TooltipProvider>
    </KeyboardShortcutsProvider>,
    {
      route: options.route ?? '/',
      auth: options.auth ?? 'authenticated',
      theme: false,
      toaster: false,
      fetchRoutes: [...(options.authRoutes ?? []), ...appRoutes()],
    },
  )
  return { ...result, capturedPathname, capturedSearch }
}

function searchParams(capturedSearch: { current: string }): URLSearchParams {
  return new URLSearchParams(capturedSearch.current)
}

describe('DesktopSidebar', () => {
  it('returns null when user is not authenticated', () => {
    const { container } = renderSidebar({ auth: 'anonymous' })

    expect(container.firstChild).toBeNull()
  })

  it('returns null when auth state is loading', () => {
    const { container } = renderSidebar({
      authRoutes: [{ method: 'GET', path: '/api/auth/get-session', respond: () => new Promise(() => {}) }],
    })

    expect(container.firstChild).toBeNull()
  })

  it('returns null when not desktop', () => {
    const { container } = renderSidebar({ mobile: true })

    expect(container.firstChild).toBeNull()
  })

  it('hides the New Repo CTA for root path and renders Assistant', async () => {
    renderSidebar({ route: '/' })

    expect(await screen.findByText('Assistant')).toBeInTheDocument()
    expect(screen.queryByText('New Repo')).toBeNull()
  })

  it('renders primary CTAs for repo detail', async () => {
    renderSidebar({ route: '/repos/5' })

    expect(await screen.findByText('Assistant')).toBeInTheDocument()
    expect(screen.queryByText('New Session')).toBeNull()
  })

  it('renders primary CTAs for session detail', async () => {
    renderSidebar({ route: '/repos/5/sessions/abc' })

    expect(await screen.findByText('Assistant')).toBeInTheDocument()
    expect(screen.queryByText('New Session')).toBeNull()
  })

  it.each(['/', '/repos/5', '/repos/5/sessions/abc', '/assistant'])(
    'leaves route tools to the tool rail on %s',
    async (path) => {
      renderSidebar({ route: path })

      for (const label of ['Home', 'Settings', 'Logout']) {
        expect(await screen.findByText(label)).toBeInTheDocument()
      }
      for (const label of [
        'Menu',
        'Files',
        'MCP',
        'Skills',
        'Schedules',
        'All Schedules',
        'Source Control',
        'Terminal',
        'Walkthrough',
        'Preview',
      ]) {
        expect(screen.queryByText(label)).toBeNull()
      }
    },
  )

  it.each([
    ['/schedules', 'New Schedule'],
    ['/repos/5/schedules', 'New Schedule'],
    ['/assistant', 'New Session'],
  ])('does not duplicate the page header create action on %s', async (path, headerAction) => {
    renderSidebar({ route: path })

    expect(await screen.findByText('Assistant')).toBeInTheDocument()
    expect(screen.queryByText(headerAction)).toBeNull()
  })

  it('navigates home from the footer', async () => {
    const { capturedPathname } = renderSidebar({ route: '/repos/5?repoTab=workspaces' })

    fireEvent.click(await screen.findByText('Home'))

    await waitFor(() => expect(capturedPathname.current).toBe('/'))
  })

  it('opens settings by updating settings query params', async () => {
    const { capturedPathname, capturedSearch } = renderSidebar({ route: '/?dialog=files' })

    fireEvent.click(await screen.findByText('Settings'))

    await waitFor(() => expect(searchParams(capturedSearch).get('settings')).toBe('open'))
    expect(capturedPathname.current).toBe('/')
    expect(searchParams(capturedSearch).get('dialog')).toBe('files')
    expect(searchParams(capturedSearch).get('settingsTab')).toBe('account')
  })

  it('renders the session tree with home and account items in the footer', async () => {
    renderSidebar({ route: '/repos/5' })

    const region = await screen.findByRole('region', { name: 'Sessions' })
    expect(within(region).getByLabelText('Search sessions')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sessions' })).toBeNull()
    expect(screen.getByText('Home')).toBeInTheDocument()
    expect(screen.getByText('Settings')).toBeInTheDocument()
    expect(screen.getByText('Logout')).toBeInTheDocument()
  })

  it('hides the server switcher when no linked servers exist', async () => {
    renderSidebar({ route: '/' })

    await screen.findByText('Assistant')
    expect(screen.queryByRole('button', { name: /Switch server/ })).toBeNull()
  })

  it('renders home, sessions and account items and no session tree when collapsed', async () => {
    renderSidebar({ route: '/repos/5', collapsed: true })

    expect(await screen.findByText('Sessions')).toBeInTheDocument()
    expect(screen.queryByLabelText('Search sessions')).toBeNull()
    expect(screen.getByText('Home')).toBeInTheDocument()
    expect(screen.getByText('Settings')).toBeInTheDocument()
    expect(screen.queryByText('Files')).toBeNull()
  })

  it('opens the sessions picker dialog from the collapsed Sessions item when the tool rail is not mounted', async () => {
    useUIState.setState({ isToolRailMounted: false })
    renderSidebar({ route: '/repos/5', collapsed: true })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.click(await screen.findByText('Sessions'))

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('opens the sessions panel from the collapsed Sessions item when the tool rail is mounted', async () => {
    useUIState.setState({ isToolRailMounted: true })
    const { capturedPathname, capturedSearch } = renderSidebar({ route: '/repos/5', collapsed: true })

    fireEvent.click(await screen.findByText('Sessions'))

    await waitFor(() => expect(searchParams(capturedSearch).get('panel')).toBe('sessions'))
    expect(capturedPathname.current).toBe('/repos/5')
  })
})
