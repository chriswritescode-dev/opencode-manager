import { describe, expect, it } from 'vitest'
import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Routes, Route } from 'react-router-dom'
import { LOCAL_OPENCODE_SERVER_ID } from '@opencode-manager/shared/schemas'
import { Repos } from '../Repos'
import { useSidebarServerStore } from '@/stores/sidebarServerStore'
import { renderWithProviders } from '@/test/render'
import { LocationCatcher } from '@/test/test-components'
import { makeHealthResponse, makeOpenCodeServer, makeRepo } from '@/test/fixtures/api'
import type { FetchRoute } from '@/test/fetchFake'
import type { OpenCodeProject } from '@/api/opencode'

const kitchen = makeOpenCodeServer({
  id: 'srv_kitchen',
  name: 'Kitchen',
  baseUrl: 'https://kitchen.example.com',
})

const localRepo = makeRepo({ id: 1, name: 'demo', fullPath: '/workspace/demo' })

const kitchenProject: OpenCodeProject = {
  id: 'prj_1',
  canonical: '/home/me/app',
  name: 'App',
  time: { created: 1, updated: 2, active: 2 },
  sandboxes: [],
}

interface ReposRenderOptions {
  serverId?: string
  servers?: Array<ReturnType<typeof makeOpenCodeServer>>
  repos?: Array<ReturnType<typeof makeRepo>>
  projects?: OpenCodeProject[]
}

function buildRoutes(options: ReposRenderOptions): FetchRoute[] {
  return [
    {
      method: 'GET',
      path: '/api/opencode-servers',
      respond: () => ({ json: { servers: options.servers ?? [kitchen] } }),
    },
    {
      method: 'GET',
      path: '/api/opencode-servers/status',
      respond: () => ({
        json: {
          statuses: [{
            serverId: 'srv_kitchen',
            connected: true,
            version: '2.0.15',
            error: null,
          }],
        },
      }),
    },
    {
      method: 'GET',
      path: '/api/repos',
      respond: () => ({ json: options.repos ?? [localRepo] }),
    },
    {
      method: 'POST',
      path: '/api/repos/git-status-batch',
      respond: () => ({ json: {} }),
    },
    {
      method: 'GET',
      path: '/api/schedules/all/runs/unread',
      respond: () => ({ json: { runs: [], total: 0, failed: 0 } }),
    },
    {
      method: 'GET',
      path: '/api/health',
      respond: () => ({ json: makeHealthResponse() }),
    },
    {
      method: 'GET',
      path: '/api/opencode/project',
      respond: () => ({ json: options.projects ?? [] }),
    },
    {
      method: 'GET',
      path: '/api/opencode/servers/:serverId/api/project',
      respond: () => ({ json: options.projects ?? [] }),
    },
    {
      method: 'GET',
      path: '/api/opencode/api/permission/request',
      respond: () => ({ json: { data: [] } }),
    },
    {
      method: 'GET',
      path: '/api/opencode/api/form',
      respond: () => ({ json: { data: [] } }),
    },
    {
      method: 'GET',
      path: '/api/opencode/api/session/active',
      respond: () => ({ json: {} }),
    },
    {
      method: 'GET',
      path: '/api/opencode/api/shell',
      respond: () => ({ json: { data: [] } }),
    },
  ]
}

function renderRepos(options: ReposRenderOptions = {}) {
  useSidebarServerStore.setState({ serverId: options.serverId ?? LOCAL_OPENCODE_SERVER_ID })
  const capturedPathname = { current: '' }
  const capturedSearch = { current: '' }
  const result = renderWithProviders(
    <>
      <LocationCatcher capturedPathname={capturedPathname} capturedSearch={capturedSearch} />
      <Routes>
        <Route path="/" element={<Repos />} />
      </Routes>
    </>,
    {
      route: '/',
      events: true,
      fetchRoutes: buildRoutes(options),
    },
  )
  return { ...result, capturedPathname, capturedSearch }
}

describe('Repos', () => {
  it('shows the local repositories and local-only actions', async () => {
    renderRepos()

    expect(await screen.findByText('demo')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Repo' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open files' })).toBeInTheDocument()
    expect(screen.queryByText('App')).not.toBeInTheDocument()
  })

  it('shows the selected linked server projects and hides local-only actions', async () => {
    renderRepos({ serverId: 'srv_kitchen', projects: [kitchenProject] })

    expect(await screen.findByText('App')).toBeInTheDocument()
    expect(screen.queryByText('demo')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Repo' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open files' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'All Schedules' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument()
  })

  it('swaps the center section without navigating when the selection changes', async () => {
    const { capturedPathname } = renderRepos({ projects: [kitchenProject] })

    expect(await screen.findByText('demo')).toBeInTheDocument()

    act(() => useSidebarServerStore.getState().selectServer('srv_kitchen'))

    expect(await screen.findByText('App')).toBeInTheDocument()
    expect(screen.queryByText('demo')).not.toBeInTheDocument()
    expect(capturedPathname.current).toBe('/')

    act(() => useSidebarServerStore.getState().selectServer(LOCAL_OPENCODE_SERVER_ID))

    expect(await screen.findByText('demo')).toBeInTheDocument()
    expect(screen.queryByText('App')).not.toBeInTheDocument()
    expect(capturedPathname.current).toBe('/')
  })

  it('names the selected linked server in the header with its connection state', async () => {
    renderRepos({ serverId: 'srv_kitchen', projects: [kitchenProject] })

    const switcher = await screen.findByRole('button', { name: 'Switch server, current: Kitchen' })
    expect(switcher).toHaveTextContent('Kitchen')
    expect(within(switcher).getByRole('img', { name: 'Connected' })).toBeInTheDocument()
  })

  it('shows the server switcher on the local server and keeps local-only actions', async () => {
    renderRepos()

    expect(await screen.findByRole('button', { name: 'Switch server, current: OC Manager' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Repo' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open files' })).toBeInTheDocument()
  })

  it('switches servers and opens server settings from the header dropdown', async () => {
    const user = userEvent.setup()
    const { capturedSearch } = renderRepos({ serverId: 'srv_kitchen', projects: [kitchenProject] })

    await user.click(await screen.findByRole('button', { name: 'Switch server, current: Kitchen' }))
    await user.click(await screen.findByRole('menuitem', { name: /OC Manager/ }))

    expect(await screen.findByText('demo')).toBeInTheDocument()
    expect(capturedSearch.current).not.toContain('settings=open')

    act(() => useSidebarServerStore.getState().selectServer('srv_kitchen'))
    await user.click(screen.getByRole('button', { name: 'Switch server, current: Kitchen' }))
    await user.click(await screen.findByRole('menuitem', { name: /Manage servers/ }))

    expect(capturedSearch.current).toContain('settings=open')
    expect(capturedSearch.current).toContain('settingsTab=servers')
  })
})
