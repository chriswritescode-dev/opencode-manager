import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LOCAL_OPENCODE_SERVER_ID } from '@opencode-manager/shared/schemas'
import { MobileTabBar } from './MobileTabBar'
import { useSidebarServerStore } from '@/stores/sidebarServerStore'
import { installWindowSize } from '@/test/browserFakes'
import { renderWithProviders } from '@/test/render'
import { LocationCatcher } from '@/test/test-components'
import { appRoutes } from '@/test/fixtures/appRoutes'

interface RenderOptions {
  mobile?: boolean
  unreadTotal?: number
}

function renderTabBar(route = '/', options: RenderOptions = {}) {
  installWindowSize(options.mobile === false ? 1024 : 500)
  const capturedPathname = { current: '' }
  const capturedSearch = { current: '' }
  const result = renderWithProviders(
    <>
      <MobileTabBar />
      <LocationCatcher capturedPathname={capturedPathname} capturedSearch={capturedSearch} />
    </>,
    {
      route,
      auth: false,
      theme: false,
      toaster: false,
      fetchRoutes: appRoutes({
        unreadSchedules: { runs: [], total: options.unreadTotal ?? 0, failed: 0 },
      }),
    },
  )
  return { ...result, capturedPathname, capturedSearch }
}

function tabLabels(): Array<string | null> {
  return screen.getAllByRole('button').map((button) => button.textContent)
}

describe('MobileTabBar', () => {
  it('renders nothing when the viewport is not mobile', () => {
    const { container } = renderTabBar('/', { mobile: false })

    expect(container.firstChild).toBeNull()
  })

  it('renders nothing on unsupported paths', () => {
    const { container } = renderTabBar('/login')

    expect(container.firstChild).toBeNull()
  })

  it('renders global tabs on repo detail (session list) path', () => {
    renderTabBar('/repos/123')

    expect(screen.getByText('Sessions')).toBeInTheDocument()
    expect(screen.getByText('Git')).toBeInTheDocument()
    expect(screen.queryByText('Schedules')).not.toBeInTheDocument()
    expect(tabLabels()).toEqual(['Sessions', 'Files', 'Git', 'Assistant', 'More'])
  })

  it('opens the source control dialog when Git is clicked on repo detail path', async () => {
    const user = userEvent.setup()
    const { capturedSearch } = renderTabBar('/repos/123')

    await user.click(screen.getByRole('button', { name: 'Git' }))

    await waitFor(() => expect(capturedSearch.current).toBe('?dialog=sourceControl'))
  })

  it('renders global tabs on assistant session list path', () => {
    renderTabBar('/assistant?view=sessions')

    expect(screen.getByText('Sessions')).toBeInTheDocument()
    expect(screen.getByText('Assistant')).toBeInTheDocument()
    expect(screen.getByText('Schedules')).toBeInTheDocument()
  })

  it('opens the assistant-scoped file browser from the assistant route', async () => {
    const user = userEvent.setup()
    const { capturedSearch } = renderTabBar('/assistant')

    await user.click(screen.getByRole('button', { name: 'Files' }))

    await waitFor(() => expect(capturedSearch.current).toBe('?dialog=files'))
  })

  it('opens the global file browser from the repos route', async () => {
    const user = userEvent.setup()
    const { capturedSearch } = renderTabBar('/')

    await user.click(screen.getByRole('button', { name: 'Files' }))

    await waitFor(() => expect(capturedSearch.current).toBe('?mobileTab=files'))
  })

  it('navigates to /assistant when assistant is clicked from repo context', async () => {
    const user = userEvent.setup()
    const { capturedPathname } = renderTabBar('/repos/123')

    await user.click(screen.getByRole('button', { name: 'Assistant' }))

    await waitFor(() => expect(capturedPathname.current).toBe('/assistant'))
  })

  it('navigates to assistant route when assistant is clicked without repo id', async () => {
    const user = userEvent.setup()
    const { capturedPathname } = renderTabBar('/schedules')

    await user.click(screen.getByRole('button', { name: 'Assistant' }))

    await waitFor(() => expect(capturedPathname.current).toBe('/assistant'))
  })

  it('hides the tab bar on a linked server page path', () => {
    const { container } = renderTabBar('/servers/srv_kitchen')

    expect(container.firstChild).toBeNull()
  })

  it('renders global tabs with Git on a linked server project page', () => {
    renderTabBar('/servers/srv_kitchen/projects?directory=%2Fhome%2Fme%2Fapp')

    expect(tabLabels()).toEqual(['Sessions', 'Git', 'Assistant', 'More'])
    expect(screen.queryByText('Files')).not.toBeInTheDocument()
    expect(screen.queryByText('Schedules')).not.toBeInTheDocument()
  })

  it('opens the remote source control dialog from the Git tab on a linked server project page', async () => {
    const user = userEvent.setup()
    const { capturedPathname, capturedSearch } = renderTabBar(
      '/servers/srv_kitchen/projects?directory=%2Fhome%2Fme%2Fapp',
    )

    await user.click(screen.getByRole('button', { name: 'Git' }))

    await waitFor(() => expect(capturedSearch.current).toContain('dialog=sourceControl'))
    expect(capturedPathname.current).toBe('/servers/srv_kitchen/projects')
    expect(capturedSearch.current).toContain('directory=%2Fhome%2Fme%2Fapp')
  })

  it('opens the sessions sheet from the Sessions tab on a linked server project page', async () => {
    const user = userEvent.setup()
    const { capturedSearch } = renderTabBar('/servers/srv_kitchen/projects?directory=%2Fhome%2Fme%2Fapp')

    await user.click(screen.getByRole('button', { name: 'Sessions' }))

    await waitFor(() => expect(capturedSearch.current).toContain('mobileTab=sessions'))
  })

  it('does not render tab bar on a linked server session path', () => {
    const { container } = renderTabBar('/servers/srv_kitchen/sessions/ses_remote')

    expect(container.firstChild).toBeNull()
  })

  it('renders schedule tabs on /repos/:id/schedules path', () => {
    renderTabBar('/repos/123/schedules')

    expect(screen.getByText('Jobs')).toBeInTheDocument()
    expect(screen.getByText('Detail')).toBeInTheDocument()
    expect(screen.getByText('Runs')).toBeInTheDocument()
    expect(screen.queryByText('Assistant')).not.toBeInTheDocument()
  })

  it('renders tab bar on root path', () => {
    renderTabBar('/')

    expect(screen.getByText('Sessions')).toBeInTheDocument()
    expect(screen.getByText('Files')).toBeInTheDocument()
    expect(screen.getByText('Assistant')).toBeInTheDocument()
    expect(screen.getByText('Schedules')).toBeInTheDocument()
    expect(screen.getByText('More')).toBeInTheDocument()
    expect(screen.queryByText('Git')).not.toBeInTheDocument()
  })

  it('hides the Files tab on the home page when a linked server is selected', () => {
    useSidebarServerStore.setState({ serverId: 'srv_kitchen' })
    renderTabBar('/')

    expect(tabLabels()).toEqual(['Sessions', 'Assistant', 'Schedules', 'More'])
    expect(screen.queryByText('Files')).not.toBeInTheDocument()
  })

  it('renders tab bar on /schedules path', () => {
    renderTabBar('/schedules')

    expect(screen.getByText('Sessions')).toBeInTheDocument()
    expect(screen.getByText('Schedules')).toBeInTheDocument()
  })

  it('Sessions tab is active when pathname is / and no sheet is open', () => {
    renderTabBar('/')

    const sessionsButton = screen.getByText('Sessions').closest('button')
    expect(sessionsButton).toHaveClass('text-primary')
    expect(sessionsButton).toHaveClass('border-primary')
  })

  it('Sessions tab is active when openSheet is sessions regardless of pathname', () => {
    renderTabBar('/repos/123?mobileTab=sessions')

    const sessionsButton = screen.getByText('Sessions').closest('button')
    expect(sessionsButton).toHaveClass('text-primary')
    expect(sessionsButton).toHaveClass('border-primary')
  })

  it('does not render tab bar on SessionDetail path /repos/:id/sessions/:sid', () => {
    const { container } = renderTabBar('/repos/1/sessions/abc')

    expect(container.firstChild).toBeNull()
  })

  it('shows the unread schedule indicator on More when the Schedules tab is replaced by Git', async () => {
    renderTabBar('/repos/123', { unreadTotal: 2 })

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'More' }).querySelector('[data-unread-badge]')).not.toBeNull(),
    )
    expect(screen.queryByText('Schedules')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Git' }).querySelector('[data-unread-badge]')).toBeNull()
  })

  it('keeps the unread schedule indicator on Schedules and off More when that tab is shown', async () => {
    renderTabBar('/', { unreadTotal: 1 })

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Schedules' }).querySelector('[data-unread-badge]')).not.toBeNull(),
    )
    expect(screen.getByRole('button', { name: 'More' }).querySelector('[data-unread-badge]')).toBeNull()
  })

  it('shows the tab bar when a linked server is not selected', () => {
    useSidebarServerStore.setState({ serverId: LOCAL_OPENCODE_SERVER_ID })
    renderTabBar('/')

    expect(screen.getByText('Files')).toBeInTheDocument()
  })
})
