import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { PreviewPanel, PreviewWorkspace } from './PreviewPanel'
import { renderWithProviders } from '@/test/render'
import { installPointerCapture } from '@/test/browserFakes'
import type { FetchRoute, FetchRouteResult } from '@/test/fetchFake'
import type { CreatePreviewSessionResponse, PreviewPortsResponse } from '@opencode-manager/shared/types'

const DEFAULT_ENTRY = '/repos/1?dialog=preview&previewPort=5173'

const repoPorts: PreviewPortsResponse = {
  enabled: true,
  ports: [{ port: 5173, host: '127.0.0.1', pid: 10, command: 'vite', cwd: '/repo', inDirectory: true }],
}

const immediateSessionRoute: FetchRoute = {
  method: 'POST',
  path: '/api/preview/sessions',
  respond: () => ({ json: { token: 'tok', previewPort: 5004, publicUrl: null } }),
}

interface DeferredSessions {
  route: FetchRoute
  calls: Array<{ port: number; resolve: (response: CreatePreviewSessionResponse) => void }>
}

const sessionRequestSchema = z.object({ port: z.number() })

function deferredSessions(): DeferredSessions {
  const calls: DeferredSessions['calls'] = []
  return {
    calls,
    route: {
      method: 'POST',
      path: '/api/preview/sessions',
      respond: (request) => new Promise<FetchRouteResult>((resolve) => {
        const parsed = sessionRequestSchema.safeParse(request.body)
        calls.push({
          port: parsed.success ? parsed.data.port : 0,
          resolve: (response) => resolve({ json: response }),
        })
      }),
    },
  }
}

function renderPreview(options: {
  ports?: PreviewPortsResponse
  sessionRoute?: FetchRoute
  entry?: string
  compact?: boolean
}) {
  installPointerCapture()
  let ports = options.ports ?? repoPorts
  const routes: FetchRoute[] = [
    { method: 'GET', path: '/api/preview/ports', respond: () => ({ json: ports }) },
    options.sessionRoute ?? immediateSessionRoute,
  ]
  const view = renderWithProviders(
    options.compact === undefined
      ? <PreviewPanel isOpen onClose={() => undefined} directory="/repo" />
      : <PreviewWorkspace isOpen directory="/repo" compact={options.compact} />,
    { auth: false, theme: false, route: options.entry ?? DEFAULT_ENTRY, fetchRoutes: routes },
  )
  return {
    ...view,
    setPorts: (next: PreviewPortsResponse) => {
      ports = next
    },
  }
}

async function waitForPortsRequest(result: ReturnType<typeof renderPreview>): Promise<void> {
  await waitFor(() => expect(result.fetchFake.findRequests('GET', '/api/preview/ports').length).toBeGreaterThan(0))
}

describe('PreviewPanel', () => {
  it('renders the iframe with the start URL and sandbox for a listed port', async () => {
    renderPreview({})

    const iframe = await screen.findByTitle('Preview')
    expect(iframe).toHaveAttribute('src', 'http://localhost:5004/__ocm_preview/start?token=tok&path=%2F')
    expect(iframe.getAttribute('sandbox')).toContain('allow-scripts')
    expect(iframe.getAttribute('sandbox')).toContain('allow-same-origin')
  })

  it('creates a session and renders the iframe when a port is selected', async () => {
    const user = userEvent.setup()
    const result = renderPreview({ entry: '/repos/1?dialog=preview' })

    await user.click(await screen.findByRole('button', { name: /:5173/ }))

    const iframe = await screen.findByTitle('Preview')
    expect(iframe).toHaveAttribute('src', 'http://localhost:5004/__ocm_preview/start?token=tok&path=%2F')
    expect(result.fetchFake.lastRequest('POST', '/api/preview/sessions')?.body).toEqual({ port: 5173 })
  })

  it('refuses to render an iframe when the preview origin is the manager origin', async () => {
    renderPreview({
      sessionRoute: {
        method: 'POST',
        path: '/api/preview/sessions',
        respond: () => ({ json: { token: 'tok', previewPort: 5004, publicUrl: 'http://localhost' } }),
      },
    })

    expect(await screen.findByRole('alert')).toHaveTextContent(/different origin/i)
    expect(screen.queryByTitle('Preview')).not.toBeInTheDocument()
  })

  it('shows a waiting state for a port that is not listening', async () => {
    const result = renderPreview({ entry: '/repos/1?dialog=preview&previewPort=6000' })

    expect(screen.getByText(/Waiting for port 6000/)).toBeInTheDocument()
    await waitForPortsRequest(result)
    expect(result.fetchFake.findRequests('POST', '/api/preview/sessions')).toHaveLength(0)
  })

  it('renders the disabled state', async () => {
    const result = renderPreview({ ports: { enabled: false, ports: [] }, entry: '/repos/1?dialog=preview' })

    expect(await screen.findByText(/Preview is unavailable/)).toBeInTheDocument()
    expect(result.fetchFake.findRequests('POST', '/api/preview/sessions')).toHaveLength(0)
  })

  it('lists the dev servers of this repo when no port is selected', async () => {
    renderPreview({
      ports: {
        enabled: true,
        ports: [
          { port: 5173, host: '127.0.0.1', pid: 10, command: 'vite', cwd: '/repo', inDirectory: true },
          { port: 9000, host: '127.0.0.1', pid: 11, command: 'Discord', cwd: '/', inDirectory: false },
          { port: 9001, host: '127.0.0.1', pid: 12, command: 'figma_agent', cwd: null, inDirectory: false },
        ],
      },
      entry: '/repos/1?dialog=preview',
    })

    expect(await screen.findByRole('heading', { name: 'Dev servers in this repo' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /:5173 vite/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /:9000/ })).not.toBeInTheDocument()
    expect(screen.getByText(/2 other ports are listening elsewhere/)).toBeInTheDocument()
  })

  it('points to the port menu when no listening port belongs to this repo', async () => {
    renderPreview({
      ports: {
        enabled: true,
        ports: [{ port: 5173, host: '127.0.0.1', pid: 10, command: 'vite', cwd: '/elsewhere', inDirectory: false }],
      },
      entry: '/repos/1?dialog=preview',
    })

    expect(await screen.findByText(/1 port is listening\. Choose one from the port menu above\./)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Dev servers in this repo' })).not.toBeInTheDocument()
  })

  it('explains how to start a dev server when no port is listening', async () => {
    renderPreview({ ports: { enabled: true, ports: [] }, entry: '/repos/1?dialog=preview' })

    expect(await screen.findByText('No dev server is listening')).toBeInTheDocument()
  })

  it('groups repo ports first in the port menu and starts a session for the picked port', async () => {
    const user = userEvent.setup()
    const result = renderPreview({
      ports: {
        enabled: true,
        ports: [
          { port: 5173, host: '127.0.0.1', pid: 10, command: 'vite', cwd: '/repo', inDirectory: true },
          { port: 9000, host: '127.0.0.1', pid: 11, command: 'python3.12', cwd: '/srv/apps/demo/site', inDirectory: false },
        ],
      },
      entry: '/repos/1?dialog=preview',
    })

    const combobox = await screen.findByRole('combobox', { name: 'Preview port' })
    await user.click(combobox)

    const groups = screen.getAllByText(/^(This repo|Other ports)$/).map((element) => element.textContent)
    expect(groups).toEqual(['This repo', 'Other ports'])
    expect(screen.getByText('/.../apps/demo/site')).toBeInTheDocument()

    await user.type(combobox, 'python')
    expect(screen.queryByText('This repo')).not.toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: /:9000 python3\.12/ }))

    expect(await screen.findByTitle('Preview')).toBeInTheDocument()
    expect(result.fetchFake.lastRequest('POST', '/api/preview/sessions')?.body).toEqual({ port: 9000 })
    expect(screen.getByRole('combobox', { name: 'Preview port' })).toHaveValue(':9000 python3.12')
  })

  it('keeps the port menu closed when the dialog opens', async () => {
    const result = renderPreview({ entry: '/repos/1?dialog=preview' })

    await waitForPortsRequest(result)
    expect(screen.getByRole('combobox', { name: 'Preview port' })).not.toHaveFocus()
    expect(await screen.findAllByRole('button', { name: /:5173/ })).toHaveLength(1)
    expect(result.fetchFake.findRequests('GET', '/api/preview/ports')).toHaveLength(1)
  })

  it('refreshes the port list when the port menu opens', async () => {
    const user = userEvent.setup()
    const result = renderPreview({})

    await screen.findByTitle('Preview')
    const before = result.fetchFake.findRequests('GET', '/api/preview/ports').length

    await user.click(screen.getByRole('combobox', { name: 'Preview port' }))

    await waitFor(() =>
      expect(result.fetchFake.findRequests('GET', '/api/preview/ports').length).toBeGreaterThan(before),
    )
  })

  it('polls the port list while no preview session is active', async () => {
    const result = renderPreview({ entry: '/repos/1?dialog=preview' })

    await waitFor(() => expect(result.fetchFake.findRequests('GET', '/api/preview/ports').length).toBeGreaterThan(0))

    await waitFor(
      () => expect(result.fetchFake.findRequests('GET', '/api/preview/ports').length).toBeGreaterThan(1),
      { timeout: 4000 },
    )
  })

  it('stops polling once a preview session is active', async () => {
    const result = renderPreview({})

    await screen.findByTitle('Preview')
    const afterSession = result.fetchFake.findRequests('GET', '/api/preview/ports').length

    await new Promise((resolve) => setTimeout(resolve, 2300))

    expect(result.fetchFake.findRequests('GET', '/api/preview/ports')).toHaveLength(afterSession)
  })

  it('mints a fresh session when a listed port disappears and comes back', async () => {
    const sessions = deferredSessions()
    const result = renderPreview({ sessionRoute: sessions.route })

    await waitFor(() => expect(sessions.calls).toHaveLength(1))
    sessions.calls[0]?.resolve({ token: 'tok-1', previewPort: 5004, publicUrl: null })
    expect((await screen.findByTitle('Preview')).getAttribute('src')).toContain('token=tok-1')

    result.setPorts({ enabled: true, ports: [] })
    await result.queryClient.refetchQueries({ queryKey: ['previewPorts', '/repo'] })
    await waitFor(() => expect(screen.queryByTitle('Preview')).not.toBeInTheDocument())
    expect(screen.getByText(/Waiting for port 5173/)).toBeInTheDocument()

    result.setPorts(repoPorts)
    await result.queryClient.refetchQueries({ queryKey: ['previewPorts', '/repo'] })
    await waitFor(() => expect(sessions.calls).toHaveLength(2))
    sessions.calls[1]?.resolve({ token: 'tok-2', previewPort: 5004, publicUrl: null })

    expect((await screen.findByTitle('Preview')).getAttribute('src')).toContain('token=tok-2')
    expect(result.fetchFake.findRequests('POST', '/api/preview/sessions')).toHaveLength(2)
  })

  it('does not render the old token while a same-port path change is pending', async () => {
    const user = userEvent.setup()
    const sessions = deferredSessions()
    renderPreview({ sessionRoute: sessions.route })

    await waitFor(() => expect(sessions.calls).toHaveLength(1))
    sessions.calls[0]?.resolve({ token: 'tok-1', previewPort: 5004, publicUrl: null })
    expect(await screen.findByTitle('Preview')).toBeInTheDocument()

    const pathInput = screen.getByLabelText('Preview path')
    await user.clear(pathInput)
    await user.type(pathInput, '/foo')
    await user.click(screen.getByRole('button', { name: 'Go' }))

    await waitFor(() => expect(sessions.calls).toHaveLength(2))
    expect(screen.queryByTitle('Preview')).not.toBeInTheDocument()

    sessions.calls[1]?.resolve({ token: 'tok-2', previewPort: 5004, publicUrl: null })
    const iframe = await screen.findByTitle('Preview')
    expect(iframe.getAttribute('src')).toContain('token=tok-2')
    expect(iframe.getAttribute('src')).toContain('path=%2Ffoo')
  })

  it('does not replay the old token while a reload is pending', async () => {
    const user = userEvent.setup()
    const sessions = deferredSessions()
    renderPreview({ sessionRoute: sessions.route })

    await waitFor(() => expect(sessions.calls).toHaveLength(1))
    sessions.calls[0]?.resolve({ token: 'tok-1', previewPort: 5004, publicUrl: null })
    expect(await screen.findByTitle('Preview')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Reload preview' }))

    await waitFor(() => expect(sessions.calls).toHaveLength(2))
    expect(screen.queryByTitle('Preview')).not.toBeInTheDocument()

    sessions.calls[1]?.resolve({ token: 'tok-2', previewPort: 5004, publicUrl: null })
    expect((await screen.findByTitle('Preview')).getAttribute('src')).toContain('token=tok-2')
  })

  it('keeps the newest session when responses resolve out of order for the same port', async () => {
    const user = userEvent.setup()
    const sessions = deferredSessions()
    renderPreview({ sessionRoute: sessions.route })

    await waitFor(() => expect(sessions.calls).toHaveLength(1))
    sessions.calls[0]?.resolve({ token: 'tok-1', previewPort: 5004, publicUrl: null })
    await screen.findByTitle('Preview')

    await user.click(screen.getByRole('button', { name: 'Reload preview' }))
    await user.click(screen.getByRole('button', { name: 'Reload preview' }))
    await waitFor(() => expect(sessions.calls).toHaveLength(3))

    sessions.calls[2]?.resolve({ token: 'tok-3', previewPort: 5004, publicUrl: null })
    sessions.calls[1]?.resolve({ token: 'tok-2', previewPort: 5004, publicUrl: null })

    const iframe = await screen.findByTitle('Preview')
    expect(iframe.getAttribute('src')).toContain('token=tok-3')
    expect(iframe.getAttribute('src')).not.toContain('token=tok-2')
  })

  it('does not mint extra sessions when the port list refetches unchanged', async () => {
    const sessions = deferredSessions()
    const result = renderPreview({ sessionRoute: sessions.route })

    await waitFor(() => expect(sessions.calls).toHaveLength(1))
    sessions.calls[0]?.resolve({ token: 'tok-1', previewPort: 5004, publicUrl: null })
    await screen.findByTitle('Preview')

    await result.queryClient.refetchQueries({ queryKey: ['previewPorts', '/repo'] })
    await result.queryClient.refetchQueries({ queryKey: ['previewPorts', '/repo'] })

    expect(sessions.calls).toHaveLength(1)
  })

  it('keeps the port menu but hides the viewport presets in compact mode', async () => {
    renderPreview({ compact: true })

    await screen.findByTitle('Preview')

    expect(screen.getByRole('combobox', { name: 'Preview port' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Mobile viewport')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Tablet viewport')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Full width viewport')).not.toBeInTheDocument()
  })

  it('shows the viewport presets when not compact', async () => {
    renderPreview({ compact: false })

    await screen.findByTitle('Preview')

    expect(screen.getByRole('combobox', { name: 'Preview port' })).toBeInTheDocument()
    expect(screen.getByLabelText('Mobile viewport')).toBeInTheDocument()
  })
})
