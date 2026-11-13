import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { installMatchMedia, installWebSocket, installWindowSize, type WebSocketFake } from '@/test/browserFakes'
import { renderWithProviders, createTestQueryClient } from '@/test/render'
import type { FetchRoute, FetchRouteResult } from '@/test/fetchFake'
import type { TerminalInfo } from '@opencode-manager/shared/types'
import { TerminalPanel } from './TerminalPanel'

const runningTerminal: TerminalInfo = {
  id: 't1',
  title: 'Terminal',
  kind: 'shell',
  cwd: '/repo',
  status: 'running',
}

const exitedTerminal: TerminalInfo = {
  id: 't2',
  title: 'Build',
  kind: 'action',
  actionId: 'build',
  cwd: '/repo',
  status: 'exited',
  exitCode: 0,
}

const createTerminalRequestSchema = z.object({ directory: z.string(), title: z.string() })

interface PanelHarness {
  terminals: TerminalInfo[]
  createRequests: () => number
  deleteRequests: () => number
  listRequests: () => number
  finalTerminals: () => TerminalInfo[]
}

interface PanelOptions {
  route?: string
  terminals?: TerminalInfo[]
  listResponder?: FetchRoute['respond']
  width?: number
  onClose?: () => void
  seedEmptyCache?: boolean
}

function renderPanel(options: PanelOptions = {}) {
  installWindowSize(options.width ?? 900)
  const queryClient = createTestQueryClient()
  if (options.seedEmptyCache) {
    queryClient.setQueryData(['terminals', 1, '/repo'], [])
  }

  const state: PanelHarness = {
    terminals: options.terminals ?? [],
    createRequests: () => result.fetchFake.findRequests('POST', '/api/repos/1/terminals').length,
    deleteRequests: () => result.fetchFake.findRequests('DELETE', '/api/repos/1/terminals/:ptyID').length,
    listRequests: () => result.fetchFake.findRequests('GET', '/api/repos/1/terminals').length,
    finalTerminals: () => state.terminals,
  }
  let created = 0

  const routes: FetchRoute[] = [
    {
      method: 'GET',
      path: '/api/repos/1/terminals',
      respond: options.listResponder ?? (() => ({ json: { terminals: state.terminals } })),
    },
    {
      method: 'POST',
      path: '/api/repos/1/terminals',
      respond: (request) => {
        created += 1
        const body = createTerminalRequestSchema.parse(request.body)
        const terminal: TerminalInfo = {
          id: `created_${created}`,
          title: body.title,
          kind: 'shell',
          cwd: body.directory,
          status: 'running',
        }
        state.terminals = [...state.terminals, terminal]
        return { json: terminal }
      },
    },
    {
      method: 'DELETE',
      path: '/api/repos/1/terminals/:ptyID',
      respond: (_request, params) => {
        state.terminals = state.terminals.filter((terminal) => terminal.id !== params.ptyID)
        return { status: 204 }
      },
    },
    { method: 'PATCH', path: '/api/repos/1/terminals/:ptyID', respond: () => ({ status: 204 }) },
  ]

  const onClose = options.onClose ?? vi.fn()
  const result = renderWithProviders(
    <TerminalPanel target={{ kind: 'repo', repoId: 1 }} directory="/repo" isOpen onClose={onClose} />,
    {
      auth: false,
      theme: false,
      toaster: false,
      queryClient,
      initialEntries: [options.route ?? '/repos/1?dialog=terminal'],
      fetchRoutes: routes,
    },
  )

  return { ...result, queryClient, onClose, state }
}

function terminalView(ptyID: string): HTMLElement {
  const element = document.querySelector(`[data-terminal-id="${ptyID}"]`)
  if (!(element instanceof HTMLElement)) throw new Error(`terminal view ${ptyID} missing`)
  return element
}

async function waitForTerminal(ptyID: string): Promise<HTMLElement> {
  await waitFor(() => expect(document.querySelector(`[data-terminal-id="${ptyID}"]`)).not.toBeNull())
  return terminalView(ptyID)
}

function socketFor(socketFake: WebSocketFake, ptyID: string) {
  const connection = socketFake.connectionFor(`/terminals/${ptyID}/connect`)
  if (!connection) throw new Error(`terminal socket ${ptyID} missing`)
  return connection
}

async function closeSocket(socketFake: WebSocketFake, ptyID: string, code = 1000) {
  await waitForTerminal(ptyID)
  act(() => socketFor(socketFake, ptyID).serverClose(code))
}

let socketFake: WebSocketFake

beforeEach(() => {
  installMatchMedia(false)
  socketFake = installWebSocket()
})

describe('TerminalPanel', () => {
  it('auto-creates a terminal when the directory has none', async () => {
    const harness = renderPanel({ terminals: [] })

    await waitFor(() => expect(harness.state.createRequests()).toBe(1))
    expect(harness.fetchFake.lastRequest('POST', '/api/repos/1/terminals')?.body).toEqual({
      directory: '/repo',
      title: 'Terminal 1',
    })
    await waitForTerminal('created_1')
  })

  it('does not auto-create while the list request is unresolved or failed', async () => {
    const harness = renderPanel({
      listResponder: () => {
        throw new Error('terminals unavailable')
      },
    })

    expect(await screen.findByText('Could not load terminals: terminals unavailable')).toBeInTheDocument()
    expect(harness.state.createRequests()).toBe(0)
  })

  it('auto-creates once the list resolves successfully empty', async () => {
    let resolveList: (result: FetchRouteResult) => void = () => {}
    const harness = renderPanel({
      listResponder: () => new Promise<FetchRouteResult>((resolve) => { resolveList = resolve }),
    })

    expect(harness.state.createRequests()).toBe(0)

    await act(async () => {
      resolveList({ json: { terminals: [] } })
    })

    await waitFor(() => expect(harness.state.createRequests()).toBe(1))
  })

  it('auto-creates a shell when only exited terminals exist and none is requested', async () => {
    const harness = renderPanel({ terminals: [exitedTerminal] })

    await waitFor(() => expect(harness.state.createRequests()).toBe(1))
    expect(harness.fetchFake.lastRequest('POST', '/api/repos/1/terminals')?.body).toEqual({
      directory: '/repo',
      title: 'Terminal 1',
    })
  })

  it('decides on auto-creation once per opening, so a shell exiting later is not replaced', async () => {
    const harness = renderPanel({ terminals: [runningTerminal] })
    await waitForTerminal('t1')

    harness.state.terminals = [{ ...runningTerminal, status: 'exited', exitCode: 0 }]
    await act(async () => {
      await harness.queryClient.refetchQueries({ queryKey: ['terminals', 1, '/repo'] })
    })

    expect(await screen.findByText('exited (0)')).toBeInTheDocument()
    expect(harness.state.createRequests()).toBe(0)
  })

  it('shows a requested exited terminal without auto-creating a shell', async () => {
    const harness = renderPanel({
      terminals: [exitedTerminal],
      route: '/repos/1?dialog=terminal&terminal=t2',
    })

    const view = await waitForTerminal('t2')
    expect(view).not.toHaveClass('hidden')
    expect(harness.state.createRequests()).toBe(0)
  })

  it('selects a running terminal over an exited one when none is requested', async () => {
    const harness = renderPanel({ terminals: [exitedTerminal, runningTerminal] })

    const view = await waitForTerminal('t1')
    expect(view).not.toHaveClass('hidden')
    expect(terminalView('t2')).toHaveClass('hidden')
    expect(harness.state.createRequests()).toBe(0)
  })

  it('opens a requested terminal without auto-creating a shell from a stale cached empty list', async () => {
    let resolveList: (result: FetchRouteResult) => void = () => {}
    const harness = renderPanel({
      seedEmptyCache: true,
      route: '/repos/1?dialog=terminal&terminal=t2',
      listResponder: () => new Promise<FetchRouteResult>((resolve) => { resolveList = resolve }),
    })

    await waitFor(() => expect(harness.state.listRequests()).toBe(1))
    expect(harness.state.createRequests()).toBe(0)

    await act(async () => {
      resolveList({ json: { terminals: [exitedTerminal] } })
    })

    const view = await waitForTerminal('t2')
    expect(view).not.toHaveClass('hidden')
    expect(harness.state.createRequests()).toBe(0)
  })

  it('exposes an accessible name for the mobile panel close control', async () => {
    const harness = renderPanel({ terminals: [runningTerminal], width: 400 })
    await waitForTerminal('t1')

    fireEvent.click(screen.getByRole('button', { name: 'Close terminal panel' }))

    expect(harness.onClose).toHaveBeenCalledTimes(1)
  })

  it('activates the terminal referenced by the terminal URL param', async () => {
    renderPanel({
      terminals: [runningTerminal, exitedTerminal],
      route: '/repos/1?dialog=terminal&terminal=t2',
    })

    const active = await waitForTerminal('t2')
    expect(active).not.toHaveClass('hidden')
    expect(terminalView('t1')).toHaveClass('hidden')
  })

  it('shows an exited badge with the exit code', async () => {
    renderPanel({ terminals: [exitedTerminal] })
    await waitForTerminal('t2')

    expect(screen.getByText('exited (0)')).toBeInTheDocument()
  })

  it('asks for confirmation before closing a running terminal', async () => {
    const harness = renderPanel({ terminals: [runningTerminal] })
    await waitForTerminal('t1')

    fireEvent.click(screen.getByLabelText('Close Terminal'))

    expect(screen.getByText('Close this terminal?')).toBeInTheDocument()
    expect(harness.state.deleteRequests()).toBe(0)

    fireEvent.click(screen.getByRole('button', { name: 'Close terminal' }))

    await waitFor(() => expect(harness.fetchFake.lastRequest('DELETE', '/api/repos/1/terminals/:ptyID')?.path).toBe('/api/repos/1/terminals/t1'))
    await waitFor(() => expect(harness.fetchFake.lastRequest('DELETE', '/api/repos/1/terminals/:ptyID')?.searchParams.get('directory')).toBe('/repo'))
  })

  it('removes an exited terminal without confirmation', async () => {
    const harness = renderPanel({ terminals: [exitedTerminal] })
    await waitForTerminal('t2')

    fireEvent.click(screen.getByLabelText('Close Build'))

    expect(screen.queryByText('Close this terminal?')).not.toBeInTheDocument()
    await waitFor(() =>
      expect(harness.fetchFake.findRequests('DELETE', '/api/repos/1/terminals/:ptyID')).toHaveLength(1),
    )
  })

  it('removes a cleanly exited terminal, closes the panel when it was the last, and does not respawn', async () => {
    const harness = renderPanel({
      terminals: [runningTerminal],
      route: '/repos/1?dialog=terminal&terminal=t1',
    })
    await waitForTerminal('t1')

    harness.state.terminals = [{ ...runningTerminal, status: 'exited', exitCode: 0 }]
    await closeSocket(socketFake, 't1')

    await waitFor(() => expect(harness.onClose).toHaveBeenCalledTimes(1))
    expect(harness.state.deleteRequests()).toBe(1)
    expect(screen.queryByLabelText('Close Terminal')).not.toBeInTheDocument()
    expect(harness.state.createRequests()).toBe(0)
  })

  it('keeps a terminal that exited with a non-zero code so the failure stays inspectable', async () => {
    const harness = renderPanel({
      terminals: [runningTerminal],
      route: '/repos/1?dialog=terminal&terminal=t1',
    })
    await waitForTerminal('t1')

    harness.state.terminals = [{ ...runningTerminal, status: 'exited', exitCode: 2 }]
    await closeSocket(socketFake, 't1')

    expect(await screen.findByText('exited (2)')).toBeInTheDocument()
    expect(harness.state.deleteRequests()).toBe(0)
    expect(harness.onClose).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Close Terminal')).toBeInTheDocument()
  })

  it('keeps the panel open and selects another running terminal when one exits cleanly', async () => {
    const otherTerminal: TerminalInfo = { ...runningTerminal, id: 't3', title: 'Shell' }
    const harness = renderPanel({
      terminals: [runningTerminal, otherTerminal],
      route: '/repos/1?dialog=terminal&terminal=t3',
    })
    const view = await waitForTerminal('t3')
    expect(view).not.toHaveClass('hidden')

    harness.state.terminals = [runningTerminal, { ...otherTerminal, status: 'exited', exitCode: 0 }]
    await closeSocket(socketFake, 't3')

    await waitFor(() => expect(screen.queryByLabelText('Close Shell')).not.toBeInTheDocument())
    expect(harness.state.deleteRequests()).toBe(1)
    expect(harness.onClose).not.toHaveBeenCalled()
    const remaining = terminalView('t1')
    expect(remaining).not.toHaveClass('hidden')
    expect(harness.state.createRequests()).toBe(0)
  })

  it('keeps an action terminal that exited cleanly so its output stays visible', async () => {
    const runningActionTerminal: TerminalInfo = {
      id: 't4',
      title: 'Say hi',
      kind: 'action',
      actionId: 'say-hi',
      cwd: '/repo',
      status: 'running',
    }
    const harness = renderPanel({
      terminals: [runningActionTerminal],
      route: '/repos/1?dialog=terminal&terminal=t4',
    })
    await waitForTerminal('t4')

    harness.state.terminals = [{ ...runningActionTerminal, status: 'exited', exitCode: 0 }]
    await closeSocket(socketFake, 't4')

    expect(await screen.findByText('exited (0)')).toBeInTheDocument()
    expect(harness.state.deleteRequests()).toBe(0)
    expect(harness.onClose).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Close Say hi')).toBeInTheDocument()
  })

  it('sends a single delete when a closed terminal reports its exit', async () => {
    const harness = renderPanel({
      terminals: [runningTerminal],
      route: '/repos/1?dialog=terminal&terminal=t1',
    })
    await waitForTerminal('t1')

    fireEvent.click(screen.getByLabelText('Close Terminal'))
    fireEvent.click(screen.getByRole('button', { name: 'Close terminal' }))
    act(() => socketFor(socketFake, 't1').serverClose(1000))

    await waitFor(() => expect(harness.state.deleteRequests()).toBe(1))
    await waitFor(() => expect(screen.queryByLabelText('Close Terminal')).not.toBeInTheDocument())
    expect(harness.state.deleteRequests()).toBe(1)
    expect(harness.state.listRequests()).toBeGreaterThan(0)
  })

  it('closes the panel after the user closes the last terminal', async () => {
    const harness = renderPanel({
      terminals: [runningTerminal],
      route: '/repos/1?dialog=terminal&terminal=t1',
    })
    await waitForTerminal('t1')

    fireEvent.click(screen.getByLabelText('Close Terminal'))
    fireEvent.click(screen.getByRole('button', { name: 'Close terminal' }))

    await waitFor(() => expect(harness.onClose).toHaveBeenCalledTimes(1))
  })

  it('keeps the panel open when other terminals remain after a manual close', async () => {
    const otherTerminal: TerminalInfo = { ...runningTerminal, id: 't3', title: 'Shell' }
    const harness = renderPanel({
      terminals: [runningTerminal, otherTerminal],
      route: '/repos/1?dialog=terminal&terminal=t3',
    })
    await waitForTerminal('t3')

    fireEvent.click(screen.getByLabelText('Close Shell'))
    fireEvent.click(screen.getByRole('button', { name: 'Close terminal' }))

    await waitFor(() =>
      expect(harness.fetchFake.findRequests('DELETE', '/api/repos/1/terminals/:ptyID')).toHaveLength(1),
    )
    expect(harness.fetchFake.lastRequest('DELETE', '/api/repos/1/terminals/:ptyID')?.path).toBe('/api/repos/1/terminals/t3')
    expect(harness.onClose).not.toHaveBeenCalled()
  })

  it('numbers new shell tabs so they can be told apart', async () => {
    const harness = renderPanel({ terminals: [runningTerminal] })
    await waitForTerminal('t1')

    fireEvent.click(screen.getByRole('button', { name: 'New terminal' }))

    await waitFor(() => expect(harness.state.createRequests()).toBe(1))
    expect(harness.fetchFake.lastRequest('POST', '/api/repos/1/terminals')?.body).toEqual({
      directory: '/repo',
      title: 'Terminal 2',
    })
  })

  it('renders the key bar only on mobile', async () => {
    const desktop = renderPanel({ terminals: [runningTerminal] })
    await waitForTerminal('t1')
    expect(screen.queryByTestId('terminal-key-bar')).not.toBeInTheDocument()
    desktop.unmount()

    renderPanel({ terminals: [runningTerminal], width: 400 })
    await waitForTerminal('t1')
    expect(screen.getByTestId('terminal-key-bar')).toBeInTheDocument()
  })
})
