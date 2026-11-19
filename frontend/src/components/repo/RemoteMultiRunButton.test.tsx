import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { RemoteMultiRunButton } from './RemoteMultiRunButton'
import { renderWithProviders } from '@/test/render'
import { installPointerCapture } from '@/test/browserFakes'
import { makeCatalogModel, makeCatalogProvider } from '@/test/fixtures/api'
import type { FetchRoute } from '@/test/fetchFake'

const routes: FetchRoute[] = [
  { method: 'GET', path: '/api/multi-runs', respond: () => ({ json: { runs: [] } }) },
  {
    method: 'GET',
    path: '/api/opencode/api/provider',
    respond: () => ({ json: { location: { directory: '/srv/app' }, data: [makeCatalogProvider()] } }),
  },
  {
    method: 'GET',
    path: '/api/opencode/api/model',
    respond: () => ({ json: { location: { directory: '/srv/app' }, data: [makeCatalogModel()] } }),
  },
  { method: 'GET', path: '/api/providers/model-state', respond: () => ({ json: { recent: [], favorite: [], variant: {} } }) },
  { method: 'GET', path: '/api/opencode/api/config', respond: () => ({ json: [] }) },
  { method: 'GET', path: '/api/opencode/api/model/default', respond: () => ({ json: { location: { directory: '/srv/app' }, data: null } }) },
]

describe('RemoteMultiRunButton', () => {
  it('opens the multi-run sheet for the project directory on the linked server', async () => {
    installPointerCapture()
    const user = userEvent.setup()
    const { fetchFake } = renderWithProviders(<RemoteMultiRunButton serverId="srv_kitchen" directory="/srv/app" />, {
      auth: false,
      theme: false,
      fetchRoutes: routes,
    })

    expect(screen.queryByRole('dialog', { name: 'Multi-run' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Multi-run' }))

    expect(screen.getByRole('dialog', { name: 'Multi-run' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Runs' })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByText('No runs yet.')).toBeInTheDocument()
    await waitFor(() => {
      const request = fetchFake.lastRequest('GET', '/api/multi-runs')
      expect(request?.searchParams.get('serverId')).toBe('srv_kitchen')
      expect(request?.searchParams.get('directory')).toBe('/srv/app')
    })
  })
})
