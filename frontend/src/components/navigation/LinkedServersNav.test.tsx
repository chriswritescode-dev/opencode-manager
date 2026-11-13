import { describe, expect, it } from 'vitest'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LOCAL_OPENCODE_SERVER_ID } from '@opencode-manager/shared/schemas'
import type { OpenCodeServer, OpenCodeServerStatus } from '@opencode-manager/shared/schemas'
import { LinkedServersNav } from './LinkedServersNav'
import { useSidebarServerRouteSync } from '@/hooks/useSidebarServerSelection'
import { useSidebarServerStore } from '@/stores/sidebarServerStore'
import { connectTestEventStream, renderWithProviders } from '@/test/render'
import { LocationCatcher } from '@/test/test-components'
import { appRoutes } from '@/test/fixtures/appRoutes'
import { permissionAsked, sessionStatusUpdated } from '@/test/fixtures/events'
import { makeOpenCodeServer } from '@/test/fixtures/api'
import type { JsonObject } from '@opencode-manager/shared/utils'

const kitchen = makeOpenCodeServer({ id: 'srv_kitchen', name: 'Kitchen' })
const office = makeOpenCodeServer({ id: 'srv_office', name: 'Office' })

function status(serverId: string, connected: boolean): OpenCodeServerStatus {
  return { serverId, connected, version: null, error: null }
}

interface RenderOptions {
  pathname?: string
  variant?: 'sidebar' | 'rail'
  servers?: OpenCodeServer[]
  statuses?: OpenCodeServerStatus[]
  serverId?: string
  events?: JsonObject[]
}

function SidebarServerRouteSync() {
  useSidebarServerRouteSync()
  return null
}

async function renderNav(options: RenderOptions = {}) {
  useSidebarServerStore.setState({ serverId: options.serverId ?? LOCAL_OPENCODE_SERVER_ID })
  const capturedPathname = { current: '' }
  const capturedSearch = { current: '' }
  const result = renderWithProviders(
    <>
      <SidebarServerRouteSync />
      <LinkedServersNav variant={options.variant} />
      <LocationCatcher capturedPathname={capturedPathname} capturedSearch={capturedSearch} />
    </>,
    {
      route: options.pathname ?? '/',
      events: true,
      theme: false,
      toaster: false,
      fetchRoutes: appRoutes({
        servers: options.servers ?? [],
        statuses: options.statuses ?? [],
      }),
    },
  )
  if (options.events && options.events.length > 0) {
    await connectTestEventStream(result.eventStream)
    act(() => {
      for (const event of options.events ?? []) result.eventStream?.message(event)
    })
    await act(async () => {
      await Promise.resolve()
    })
  }
  return { ...result, capturedPathname, capturedSearch }
}

const triggerName = (name: string) => `Switch server, current: ${name}`

describe('LinkedServersNav', () => {
  it('renders nothing when no linked servers exist', async () => {
    await renderNav()

    await waitFor(() => expect(screen.queryByRole('button', { name: /Switch server/ })).not.toBeInTheDocument())
  })

  it('renders nothing for disabled linked servers', async () => {
    await renderNav({ servers: [{ ...kitchen, enabled: false }], statuses: [status('srv_kitchen', true)] })

    await waitFor(() => expect(screen.queryByRole('button', { name: /Switch server/ })).not.toBeInTheDocument())
  })

  it('shows the local machine on the trigger by default', async () => {
    await renderNav({ servers: [kitchen], statuses: [status('srv_kitchen', true)] })

    expect(await screen.findByRole('button', { name: triggerName('OC Manager') })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Servers' })).not.toBeInTheDocument()
  })

  it('shows the selected server name and connection dot on the trigger', async () => {
    await renderNav({
      servers: [kitchen],
      statuses: [status('srv_kitchen', true)],
      serverId: 'srv_kitchen',
    })

    expect(await screen.findByRole('button', { name: triggerName('Kitchen') })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Connected' })).toBeInTheDocument()
  })

  it('lists the local machine and enabled servers in the menu', async () => {
    const user = userEvent.setup()
    await renderNav({
      servers: [kitchen, { ...office, enabled: false }],
      statuses: [status('srv_kitchen', true)],
    })

    await user.click(await screen.findByRole('button', { name: triggerName('OC Manager') }))

    expect(await screen.findByRole('menuitem', { name: /OC Manager/ })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('menuitem', { name: /Kitchen/ })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Connected' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /Office/ })).not.toBeInTheDocument()
  })

  it('selects a server without navigating', async () => {
    const user = userEvent.setup()
    const { capturedPathname } = await renderNav({
      servers: [kitchen, office],
      statuses: [status('srv_kitchen', true), status('srv_office', false)],
    })

    await user.click(await screen.findByRole('button', { name: triggerName('OC Manager') }))
    await user.click(await screen.findByRole('menuitem', { name: /Office/ }))

    expect(await screen.findByRole('button', { name: triggerName('Office') })).toBeInTheDocument()
    expect(useSidebarServerStore.getState().serverId).toBe('srv_office')
    expect(capturedPathname.current).toBe('/')
  })

  it('selects the local machine without navigating', async () => {
    const user = userEvent.setup()
    const { capturedPathname } = await renderNav({
      servers: [kitchen],
      statuses: [status('srv_kitchen', true)],
      serverId: 'srv_kitchen',
    })

    await user.click(await screen.findByRole('button', { name: triggerName('Kitchen') }))
    await user.click(await screen.findByRole('menuitem', { name: /OC Manager/ }))

    expect(await screen.findByRole('button', { name: triggerName('OC Manager') })).toBeInTheDocument()
    expect(capturedPathname.current).toBe('/')
  })

  it('follows a linked server route', async () => {
    await renderNav({
      pathname: '/servers/srv_kitchen/sessions/abc',
      servers: [kitchen],
      statuses: [status('srv_kitchen', true)],
    })

    expect(await screen.findByRole('button', { name: triggerName('Kitchen') })).toBeInTheDocument()
  })

  it('falls back to local when the persisted server is disabled', async () => {
    await renderNav({
      servers: [kitchen, { ...office, enabled: false }],
      statuses: [status('srv_kitchen', true)],
      serverId: 'srv_office',
    })

    expect(await screen.findByRole('button', { name: triggerName('OC Manager') })).toBeInTheDocument()
  })

  it('shows an attention dot for another server that needs input', async () => {
    await renderNav({
      servers: [kitchen, office],
      statuses: [status('srv_kitchen', true), status('srv_office', true)],
      events: [
        permissionAsked(
          { id: 'perm-1', sessionID: 'ses_office', action: 'shell', resources: ['ls'], metadata: {} },
          { directory: '/srv/office', serverId: 'srv_office' },
        ),
      ],
    })

    expect(await screen.findByRole('img', { name: 'Office needs input' })).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'Office is running' })).not.toBeInTheDocument()
  })

  it('shows a running attention dot for another running server', async () => {
    await renderNav({
      servers: [kitchen],
      statuses: [status('srv_kitchen', true)],
      events: [
        sessionStatusUpdated(
          'ses_kitchen',
          { type: 'busy' },
          { directory: '/srv/kitchen', serverId: 'srv_kitchen' },
        ),
      ],
    })

    expect(await screen.findByRole('img', { name: 'Kitchen is running' })).toBeInTheDocument()
  })

  it('shows local attention while a remote server is selected', async () => {
    await renderNav({
      servers: [kitchen],
      statuses: [status('srv_kitchen', true)],
      serverId: 'srv_kitchen',
      events: [
        permissionAsked(
          { id: 'perm-local', sessionID: 'ses_local', action: 'shell', resources: ['ls'], metadata: {} },
          { directory: '/repo' },
        ),
      ],
    })

    expect(await screen.findByRole('img', { name: 'OC Manager needs input' })).toBeInTheDocument()
  })

  it('does not show an attention dot for the selected server', async () => {
    await renderNav({
      servers: [kitchen],
      statuses: [status('srv_kitchen', true)],
      serverId: 'srv_kitchen',
      events: [
        permissionAsked(
          { id: 'perm-kitchen', sessionID: 'ses_kitchen', action: 'shell', resources: ['ls'], metadata: {} },
          { directory: '/srv/kitchen', serverId: 'srv_kitchen' },
        ),
      ],
    })

    await waitFor(() => expect(screen.getByRole('button', { name: triggerName('Kitchen') })).toBeInTheDocument())
    expect(await screen.findByRole('img', { name: 'Session needs input' })).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'Kitchen needs input' })).not.toBeInTheDocument()
  })

  it('opens settings on the servers tab from the menu', async () => {
    const user = userEvent.setup()
    const { capturedSearch } = await renderNav({
      servers: [kitchen],
      statuses: [status('srv_kitchen', true)],
    })

    await user.click(await screen.findByRole('button', { name: triggerName('OC Manager') }))
    await user.click(await screen.findByRole('menuitem', { name: /Manage servers/ }))

    await waitFor(() => expect(new URLSearchParams(capturedSearch.current).get('settings')).toBe('open'))
    expect(new URLSearchParams(capturedSearch.current).get('settingsTab')).toBe('servers')
  })

  it('renders a single icon trigger in the collapsed rail', async () => {
    const user = userEvent.setup()
    await renderNav({
      variant: 'rail',
      servers: [kitchen],
      statuses: [status('srv_kitchen', true)],
    })

    const trigger = await screen.findByRole('button', { name: triggerName('OC Manager') })
    expect(screen.queryByText('OC Manager')).not.toBeInTheDocument()

    await user.click(trigger)
    expect(await screen.findByRole('menuitem', { name: /Kitchen/ })).toBeInTheDocument()
  })

  it('renders nothing in the collapsed rail when no linked servers exist', async () => {
    await renderNav({ variant: 'rail' })

    await waitFor(() => expect(screen.queryByRole('button', { name: /Switch server/ })).not.toBeInTheDocument())
  })
})
