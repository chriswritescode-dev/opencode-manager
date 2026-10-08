import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { CreatePreviewSessionResponse } from '@opencode-manager/shared/types'
import { createPreviewSession, usePreviewPorts } from '@/api/preview'
import { PreviewPanel, PreviewWorkspace } from './PreviewPanel'

vi.mock('@/api/preview', () => ({
  usePreviewPorts: vi.fn(),
  createPreviewSession: vi.fn(),
}))

type PreviewPortsResult = ReturnType<typeof usePreviewPorts>

const portsData = {
  enabled: true,
  ports: [{ port: 5173, host: '127.0.0.1' as const, pid: 10, command: 'vite', cwd: '/repo', inDirectory: true }],
}

let portsState: PreviewPortsResult['data'] = portsData
const refetchPorts = vi.fn()

const DEFAULT_ENTRY = '/repos/1?dialog=preview&previewPort=5173'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function panelElement(initialEntry: string) {
  return (
    <MemoryRouter initialEntries={[initialEntry]}>
      <PreviewPanel isOpen onClose={vi.fn()} directory="/repo" />
    </MemoryRouter>
  )
}

function workspaceElement(compact: boolean, initialEntry = DEFAULT_ENTRY) {
  return (
    <MemoryRouter initialEntries={[initialEntry]}>
      <PreviewWorkspace isOpen directory="/repo" compact={compact} />
    </MemoryRouter>
  )
}

function renderPanel(initialEntry = DEFAULT_ENTRY) {
  const result = render(panelElement(initialEntry))
  return {
    ...result,
    refresh: () => result.rerender(panelElement(initialEntry)),
  }
}

describe('PreviewPanel', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    portsState = portsData
    vi.mocked(usePreviewPorts).mockImplementation(
      () =>
        ({
          data: portsState,
          isLoading: false,
          refetch: refetchPorts,
        }) as unknown as PreviewPortsResult,
    )
    vi.mocked(createPreviewSession).mockResolvedValue({ token: 'tok', previewPort: 5004, publicUrl: null })
  })

  it('renders the iframe with the start URL and sandbox for a listed port', async () => {
    renderPanel()

    const iframe = await screen.findByTitle('Preview')
    expect(iframe).toHaveAttribute('src', 'http://localhost:5004/__ocm_preview/start?token=tok&path=%2F')
    expect(iframe.getAttribute('sandbox')).toContain('allow-scripts')
    expect(iframe.getAttribute('sandbox')).toContain('allow-same-origin')
  })

  it('creates a session and renders the iframe when a port is selected', async () => {
    const user = userEvent.setup()
    renderPanel('/repos/1?dialog=preview')

    await user.click(screen.getByRole('button', { name: /:5173/ }))

    const iframe = await screen.findByTitle('Preview')
    expect(iframe).toHaveAttribute('src', 'http://localhost:5004/__ocm_preview/start?token=tok&path=%2F')
    expect(createPreviewSession).toHaveBeenCalledWith(5173)
  })

  it('refuses to render an iframe when the preview origin is the manager origin', async () => {
    vi.mocked(createPreviewSession).mockResolvedValue({
      token: 'tok',
      previewPort: 5004,
      publicUrl: 'http://localhost',
    })
    renderPanel()

    expect(await screen.findByRole('alert')).toHaveTextContent(/different origin/i)
    expect(screen.queryByTitle('Preview')).not.toBeInTheDocument()
  })

  it('shows a waiting state for a port that is not listening', () => {
    renderPanel('/repos/1?dialog=preview&previewPort=6000')

    expect(screen.getByText(/Waiting for port 6000/)).toBeInTheDocument()
    expect(createPreviewSession).not.toHaveBeenCalled()
  })

  it('renders the disabled state', () => {
    portsState = { enabled: false, ports: [] }
    renderPanel('/repos/1?dialog=preview')

    expect(screen.getByText(/Preview is unavailable/)).toBeInTheDocument()
  })

  it('lists the dev servers of this repo when no port is selected', () => {
    portsState = {
      enabled: true,
      ports: [
        { port: 5173, host: '127.0.0.1', pid: 10, command: 'vite', cwd: '/repo', inDirectory: true },
        { port: 9000, host: '127.0.0.1', pid: 11, command: 'Discord', cwd: '/', inDirectory: false },
        { port: 9001, host: '127.0.0.1', pid: 12, command: 'figma_agent', cwd: null, inDirectory: false },
      ],
    }
    renderPanel('/repos/1?dialog=preview')

    expect(screen.getByRole('heading', { name: 'Dev servers in this repo' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /:5173 vite/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /:9000/ })).not.toBeInTheDocument()
    expect(screen.getByText(/2 other ports are listening elsewhere/)).toBeInTheDocument()
  })

  it('points to the port menu when no listening port belongs to this repo', () => {
    portsState = {
      enabled: true,
      ports: [{ port: 5173, host: '127.0.0.1', pid: 10, command: 'vite', cwd: '/elsewhere', inDirectory: false }],
    }
    renderPanel('/repos/1?dialog=preview')

    expect(screen.queryByRole('heading', { name: 'Dev servers in this repo' })).not.toBeInTheDocument()
    expect(screen.getByText(/1 port is listening\. Choose one from the port menu above\./)).toBeInTheDocument()
  })

  it('explains how to start a dev server when no port is listening', () => {
    portsState = { enabled: true, ports: [] }
    renderPanel('/repos/1?dialog=preview')

    expect(screen.getByText('No dev server is listening')).toBeInTheDocument()
  })

  it('groups repo ports first in the port menu and starts a session for the picked port', async () => {
    const user = userEvent.setup()
    portsState = {
      enabled: true,
      ports: [
        { port: 5173, host: '127.0.0.1', pid: 10, command: 'vite', cwd: '/repo', inDirectory: true },
        { port: 9000, host: '127.0.0.1', pid: 11, command: 'python3.12', cwd: '/srv/apps/demo/site', inDirectory: false },
      ],
    }
    renderPanel('/repos/1?dialog=preview')

    await user.click(screen.getByRole('combobox', { name: 'Preview port' }))

    const groups = screen.getAllByText(/^(This repo|Other ports)$/).map((element) => element.textContent)
    expect(groups).toEqual(['This repo', 'Other ports'])
    expect(screen.getByText('/.../apps/demo/site')).toBeInTheDocument()

    await user.type(screen.getByRole('combobox', { name: 'Preview port' }), 'python')
    expect(screen.queryByText('This repo')).not.toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: /:9000 python3\.12/ }))

    expect(await screen.findByTitle('Preview')).toBeInTheDocument()
    expect(createPreviewSession).toHaveBeenCalledWith(9000)
    expect(screen.getByRole('combobox', { name: 'Preview port' })).toHaveValue(':9000 python3.12')
  })

  it('keeps the port menu closed when the dialog opens', () => {
    renderPanel('/repos/1?dialog=preview')

    expect(screen.getByRole('combobox', { name: 'Preview port' })).not.toHaveFocus()
    expect(screen.getAllByRole('button', { name: /:5173/ })).toHaveLength(1)
    expect(refetchPorts).not.toHaveBeenCalled()
  })

  it('refreshes the port list when the port menu opens', async () => {
    const user = userEvent.setup()
    renderPanel()
    await screen.findByTitle('Preview')
    refetchPorts.mockClear()

    await user.click(screen.getByRole('combobox', { name: 'Preview port' }))

    expect(refetchPorts).toHaveBeenCalledTimes(1)
  })

  it('polls the port list while no preview session is active', () => {
    renderPanel('/repos/1?dialog=preview')

    const lastOptions = vi.mocked(usePreviewPorts).mock.calls.at(-1)?.[1]
    expect(lastOptions?.enabled).toBe(true)
    expect(lastOptions?.refetchInterval).toBe(2000)
  })

  it('stops polling once a preview session is active', async () => {
    renderPanel()

    await screen.findByTitle('Preview')

    const lastOptions = vi.mocked(usePreviewPorts).mock.calls.at(-1)?.[1]
    expect(lastOptions?.enabled).toBe(true)
    expect(lastOptions?.refetchInterval).toBe(false)
  })

  it('mints a fresh session when a listed port disappears and comes back', async () => {
    const first = deferred<CreatePreviewSessionResponse>()
    const second = deferred<CreatePreviewSessionResponse>()
    vi.mocked(createPreviewSession).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    const panel = renderPanel()

    first.resolve({ token: 'tok-1', previewPort: 5004, publicUrl: null })
    expect((await screen.findByTitle('Preview')).getAttribute('src')).toContain('token=tok-1')

    portsState = { enabled: true, ports: [] }
    panel.refresh()
    expect(screen.queryByTitle('Preview')).not.toBeInTheDocument()
    expect(screen.getByText(/Waiting for port 5173/)).toBeInTheDocument()

    portsState = portsData
    panel.refresh()
    second.resolve({ token: 'tok-2', previewPort: 5004, publicUrl: null })

    expect((await screen.findByTitle('Preview')).getAttribute('src')).toContain('token=tok-2')
    expect(createPreviewSession).toHaveBeenCalledTimes(2)
  })

  it('does not render the old token while a same-port path change is pending', async () => {
    const user = userEvent.setup()
    const first = deferred<CreatePreviewSessionResponse>()
    const second = deferred<CreatePreviewSessionResponse>()
    vi.mocked(createPreviewSession).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    renderPanel('/repos/1?dialog=preview&previewPort=5173&previewPath=%2F')

    first.resolve({ token: 'tok-1', previewPort: 5004, publicUrl: null })
    expect(await screen.findByTitle('Preview')).toBeInTheDocument()

    const pathInput = screen.getByLabelText('Preview path')
    await user.clear(pathInput)
    await user.type(pathInput, '/foo')
    await user.click(screen.getByRole('button', { name: 'Go' }))

    expect(screen.queryByTitle('Preview')).not.toBeInTheDocument()

    second.resolve({ token: 'tok-2', previewPort: 5004, publicUrl: null })
    const iframe = await screen.findByTitle('Preview')
    expect(iframe.getAttribute('src')).toContain('token=tok-2')
    expect(iframe.getAttribute('src')).toContain('path=%2Ffoo')
  })

  it('does not replay the old token while a reload is pending', async () => {
    const user = userEvent.setup()
    const first = deferred<CreatePreviewSessionResponse>()
    const second = deferred<CreatePreviewSessionResponse>()
    vi.mocked(createPreviewSession).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    renderPanel()

    first.resolve({ token: 'tok-1', previewPort: 5004, publicUrl: null })
    expect(await screen.findByTitle('Preview')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Reload preview' }))

    expect(screen.queryByTitle('Preview')).not.toBeInTheDocument()

    second.resolve({ token: 'tok-2', previewPort: 5004, publicUrl: null })
    expect((await screen.findByTitle('Preview')).getAttribute('src')).toContain('token=tok-2')
  })

  it('keeps the newest session when responses resolve out of order for the same port', async () => {
    const user = userEvent.setup()
    const first = deferred<CreatePreviewSessionResponse>()
    const second = deferred<CreatePreviewSessionResponse>()
    const third = deferred<CreatePreviewSessionResponse>()
    vi.mocked(createPreviewSession)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockReturnValueOnce(third.promise)

    renderPanel()

    first.resolve({ token: 'tok-1', previewPort: 5004, publicUrl: null })
    await screen.findByTitle('Preview')

    await user.click(screen.getByRole('button', { name: 'Reload preview' }))
    await user.click(screen.getByRole('button', { name: 'Reload preview' }))

    third.resolve({ token: 'tok-3', previewPort: 5004, publicUrl: null })
    second.resolve({ token: 'tok-2', previewPort: 5004, publicUrl: null })

    const iframe = await screen.findByTitle('Preview')
    expect(iframe.getAttribute('src')).toContain('token=tok-3')
    expect(iframe.getAttribute('src')).not.toContain('token=tok-2')
  })

  it('does not mint extra sessions when the port list refetches unchanged', async () => {
    const first = deferred<CreatePreviewSessionResponse>()
    vi.mocked(createPreviewSession).mockReturnValueOnce(first.promise)

    const panel = renderPanel()

    first.resolve({ token: 'tok-1', previewPort: 5004, publicUrl: null })
    await screen.findByTitle('Preview')

    panel.refresh()
    panel.refresh()

    expect(createPreviewSession).toHaveBeenCalledTimes(1)
  })

  it('keeps the port menu but hides the viewport presets in compact mode', async () => {
    render(workspaceElement(true))
    await screen.findByTitle('Preview')

    expect(screen.getByRole('combobox', { name: 'Preview port' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Mobile viewport')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Tablet viewport')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Full width viewport')).not.toBeInTheDocument()
  })

  it('shows the viewport presets when not compact', async () => {
    render(workspaceElement(false))
    await screen.findByTitle('Preview')

    expect(screen.getByRole('combobox', { name: 'Preview port' })).toBeInTheDocument()
    expect(screen.getByLabelText('Mobile viewport')).toBeInTheDocument()
  })
})
