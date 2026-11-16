import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SessionSandboxResourcesDialog } from './SessionSandboxResourcesDialog'
import { renderWithProviders } from '@/test/render'
import type { FetchRoute, FetchRouteResult, RecordedFetchRequest } from '@/test/fetchFake'
import type { RepoSandboxResources } from '@opencode-manager/shared/schemas'

const resourcesPath = '/api/repos/1/sandbox/resources'
const restartPath = '/api/repos/1/sandbox/restart'

function makeRepoSandboxResources(overrides: Partial<RepoSandboxResources> = {}): RepoSandboxResources {
  return {
    override: null,
    effective: { cpus: 2, memoryMib: 4096 },
    running: null,
    ...overrides,
  }
}

interface RenderDialogOptions {
  resources?: RepoSandboxResources
  putResponse?: (request: RecordedFetchRequest) => FetchRouteResult
}

function renderDialog(options: RenderDialogOptions = {}) {
  const resources = options.resources ?? makeRepoSandboxResources()
  const onOpenChange = vi.fn()
  const routes: FetchRoute[] = [
    { method: 'GET', path: resourcesPath, respond: () => ({ json: resources }) },
    {
      method: 'PUT',
      path: resourcesPath,
      respond: (request) => (options.putResponse ? options.putResponse(request) : { json: resources }),
    },
    { method: 'POST', path: restartPath, respond: () => ({ status: 204 }) },
  ]
  const view = renderWithProviders(
    <SessionSandboxResourcesDialog repoId={1} directory="/repo" open onOpenChange={onOpenChange} />,
    { auth: false, theme: false, toaster: false, fetchRoutes: routes },
  )
  return { ...view, onOpenChange }
}

describe('SessionSandboxResourcesDialog', () => {
  it('prefills the draft from the repository override', async () => {
    const { fetchFake } = renderDialog({
      resources: makeRepoSandboxResources({
        override: { cpus: 4, memoryMib: 3072 },
        effective: { cpus: 2, memoryMib: 4096 },
      }),
    })

    await waitFor(() => expect(screen.getByLabelText('CPUs')).toHaveValue(4))
    expect(screen.getByLabelText('Memory (GiB)')).toHaveValue(3)
    expect(fetchFake.lastRequest('GET', resourcesPath)?.searchParams.get('directory')).toBe('/repo')
  })

  it('prefills the draft from the effective resources when no override exists', async () => {
    renderDialog({
      resources: makeRepoSandboxResources({ override: null, effective: { cpus: 8, memoryMib: 8192 } }),
    })

    await waitFor(() => expect(screen.getByLabelText('CPUs')).toHaveValue(8))
    expect(screen.getByLabelText('Memory (GiB)')).toHaveValue(8)
  })

  it('saves the repository override', async () => {
    const user = userEvent.setup()
    const { fetchFake, onOpenChange } = renderDialog()

    await waitFor(() => expect(screen.getByLabelText('CPUs')).toHaveValue(2))

    const cpus = screen.getByLabelText('CPUs')
    await user.clear(cpus)
    await user.type(cpus, '4')
    const memory = screen.getByLabelText('Memory (GiB)')
    await user.clear(memory)
    await user.type(memory, '3')

    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(fetchFake.lastRequest('PUT', resourcesPath)?.body).toEqual({ cpus: 4, memoryMib: 3072 }),
    )
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('clears the repository override with use defaults', async () => {
    const user = userEvent.setup()
    const { fetchFake, onOpenChange } = renderDialog({
      resources: makeRepoSandboxResources({ override: { cpus: 4, memoryMib: 3072 } }),
    })

    await waitFor(() => expect(screen.getByLabelText('CPUs')).toHaveValue(4))

    await user.click(screen.getByRole('button', { name: 'Use defaults' }))

    await waitFor(() => {
      const request = fetchFake.lastRequest('PUT', resourcesPath)
      expect(request?.body).toBeNull()
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('restarts the running sandbox and clears the stale resources notice', async () => {
    const user = userEvent.setup()
    const { fetchFake } = renderDialog({
      resources: makeRepoSandboxResources({
        effective: { cpus: 4, memoryMib: 3072 },
        running: { cpus: 2, memoryMib: 4096 },
      }),
    })

    await screen.findByText('Running with 2 CPUs, 4 GiB until the VM restarts')

    await user.click(screen.getByRole('button', { name: 'Restart sandbox now' }))

    await waitFor(() =>
      expect(fetchFake.lastRequest('POST', restartPath)?.body).toEqual({ directory: '/repo' }),
    )
    await waitFor(() =>
      expect(screen.queryByText('Running with 2 CPUs, 4 GiB until the VM restarts')).not.toBeInTheDocument(),
    )
  })

  it('shows the server error when the update fails', async () => {
    const user = userEvent.setup()
    const { onOpenChange } = renderDialog({
      putResponse: () => ({ status: 500, json: { error: 'CPU limit exceeded for this host' } }),
    })

    await waitFor(() => expect(screen.getByLabelText('CPUs')).toHaveValue(2))

    await user.click(screen.getByRole('button', { name: 'Save' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('CPU limit exceeded for this host')
    expect(onOpenChange).not.toHaveBeenCalled()
  })
})
