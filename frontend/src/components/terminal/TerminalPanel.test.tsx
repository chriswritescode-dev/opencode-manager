import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { TerminalInfo } from '@opencode-manager/shared/types'
import { useCreateTerminal, useRemoveTerminal, useTerminals } from '@/api/terminals'
import { useMobile } from '@/hooks/useMobile'
import { TerminalPanel } from './TerminalPanel'

vi.mock('@/api/terminals', () => ({
  useTerminals: vi.fn(),
  useCreateTerminal: vi.fn(),
  useRemoveTerminal: vi.fn(),
}))

vi.mock('@/hooks/useMobile', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useMobile')>('@/hooks/useMobile')
  return { ...actual, useMobile: vi.fn(() => false) }
})

vi.mock('./TerminalView', async () => {
  const React = await import('react')
  return {
    TerminalView: React.forwardRef(function MockTerminalView(
      props: { ptyID: string; active: boolean; onExited: () => void },
      ref: React.Ref<unknown>,
    ) {
      React.useImperativeHandle(ref, () => ({ send: vi.fn() }))
      return React.createElement(
        'div',
        {
          'data-testid': 'terminal-view',
          'data-pty-id': props.ptyID,
          'data-active': String(props.active),
        },
        React.createElement(
          'button',
          { type: 'button', 'aria-label': `exit ${props.ptyID}`, onClick: props.onExited },
          'exit',
        ),
      )
    }),
  }
})

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

const createMutate = vi.fn()
const removeMutate = vi.fn()
const refetch = vi.fn()

function mockTerminalHooks(
  terminals: TerminalInfo[] | undefined,
  options: { isLoading?: boolean; isSuccess?: boolean } = {},
) {
  vi.mocked(useTerminals).mockReturnValue({
    data: terminals,
    isLoading: options.isLoading ?? false,
    isSuccess: options.isSuccess ?? terminals !== undefined,
    refetch,
  } as unknown as ReturnType<typeof useTerminals>)
  vi.mocked(useCreateTerminal).mockReturnValue({
    mutate: createMutate,
    isPending: false,
  } as unknown as ReturnType<typeof useCreateTerminal>)
  vi.mocked(useRemoveTerminal).mockReturnValue({
    mutate: removeMutate,
    isPending: false,
  } as unknown as ReturnType<typeof useRemoveTerminal>)
}

function renderPanel(initialEntry = '/repos/1?dialog=terminal', onClose = vi.fn()) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <TerminalPanel target={{ kind: 'repo', repoId: 1 }} directory="/repo" isOpen onClose={onClose} />
    </MemoryRouter>,
  )
}

describe('TerminalPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createMutate.mockReset()
    removeMutate.mockReset()
    refetch.mockReset()
    refetch.mockResolvedValue({ data: [] })
    vi.mocked(useMobile).mockReturnValue(false)
    mockTerminalHooks([])
  })

  it('renders a loading fallback before the lazy terminal view resolves', async () => {
    mockTerminalHooks([runningTerminal])
    renderPanel()

    expect(screen.getByText('Loading terminal...')).toBeInTheDocument()
    expect(await screen.findAllByTestId('terminal-view')).toHaveLength(1)
  })

  it('auto-creates a terminal when the directory has none', () => {
    mockTerminalHooks([])
    renderPanel()

    expect(createMutate).toHaveBeenCalledTimes(1)
    expect(createMutate).toHaveBeenCalledWith({ directory: '/repo', title: 'Terminal 1' }, expect.any(Object))
  })

  it('does not auto-create while the list request is unresolved or failed', () => {
    mockTerminalHooks(undefined, { isSuccess: false })
    renderPanel()

    expect(createMutate).not.toHaveBeenCalled()
  })

  it('auto-creates once the list resolves successfully empty', () => {
    mockTerminalHooks(undefined, { isSuccess: false })
    const { rerender } = renderPanel()
    expect(createMutate).not.toHaveBeenCalled()

    mockTerminalHooks([], { isSuccess: true })
    rerender(
      <MemoryRouter initialEntries={['/repos/1?dialog=terminal']}>
        <TerminalPanel target={{ kind: 'repo', repoId: 1 }} directory="/repo" isOpen onClose={vi.fn()} />
      </MemoryRouter>,
    )

    expect(createMutate).toHaveBeenCalledTimes(1)
    expect(createMutate).toHaveBeenCalledWith({ directory: '/repo', title: 'Terminal 1' }, expect.any(Object))
  })

  it('auto-creates a shell when only exited terminals exist and none is requested', () => {
    mockTerminalHooks([exitedTerminal])
    renderPanel()

    expect(createMutate).toHaveBeenCalledTimes(1)
    expect(createMutate).toHaveBeenCalledWith({ directory: '/repo', title: 'Terminal 1' }, expect.any(Object))
  })

  it('decides on auto-creation once per opening, so a shell exiting later is not replaced', () => {
    mockTerminalHooks([runningTerminal])
    const { rerender } = renderPanel()
    expect(createMutate).not.toHaveBeenCalled()

    mockTerminalHooks([{ ...runningTerminal, status: 'exited', exitCode: 0 }])
    rerender(
      <MemoryRouter initialEntries={['/repos/1?dialog=terminal']}>
        <TerminalPanel target={{ kind: 'repo', repoId: 1 }} directory="/repo" isOpen onClose={vi.fn()} />
      </MemoryRouter>,
    )

    expect(createMutate).not.toHaveBeenCalled()
  })

  it('shows a requested exited terminal without auto-creating a shell', async () => {
    mockTerminalHooks([exitedTerminal])
    renderPanel('/repos/1?dialog=terminal&terminal=t2')

    const view = await screen.findByTestId('terminal-view')
    expect(view).toHaveAttribute('data-active', 'true')
    expect(createMutate).not.toHaveBeenCalled()
  })

  it('selects a running terminal over an exited one when none is requested', async () => {
    mockTerminalHooks([exitedTerminal, runningTerminal])
    renderPanel()

    const views = await screen.findAllByTestId('terminal-view')
    expect(views.find((view) => view.getAttribute('data-pty-id') === 't1')).toHaveAttribute('data-active', 'true')
    expect(createMutate).not.toHaveBeenCalled()
  })

  it('opens a requested terminal without auto-creating a shell from a stale cached empty list', async () => {
    const actual = await vi.importActual<typeof import('@/api/terminals')>('@/api/terminals')
    vi.mocked(useTerminals).mockImplementation(actual.useTerminals)
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(['terminals', 1, '/repo'], [])
    let resolveList: (response: Response) => void = () => {}
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { resolveList = resolve }))
    vi.stubGlobal('fetch', fetchMock)
    const panel = (isOpen: boolean) => (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/repos/1?dialog=terminal&terminal=t2']}>
          <TerminalPanel target={{ kind: 'repo', repoId: 1 }} directory="/repo" isOpen={isOpen} onClose={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>
    )

    try {
      const { rerender } = render(panel(false))
      rerender(panel(true))

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
      expect(createMutate).not.toHaveBeenCalled()

      resolveList(new Response(JSON.stringify({ terminals: [exitedTerminal] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))

      const view = await screen.findByTestId('terminal-view')
      expect(view).toHaveAttribute('data-pty-id', 't2')
      expect(view).toHaveAttribute('data-active', 'true')
      expect(createMutate).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('exposes an accessible name for the mobile panel close control', async () => {
    mockTerminalHooks([runningTerminal])
    vi.mocked(useMobile).mockReturnValue(true)
    const onClose = vi.fn()
    renderPanel('/repos/1?dialog=terminal', onClose)
    await screen.findAllByTestId('terminal-view')

    fireEvent.click(screen.getByRole('button', { name: 'Close terminal panel' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('activates the terminal referenced by the terminal URL param', async () => {
    mockTerminalHooks([runningTerminal, exitedTerminal])
    renderPanel('/repos/1?dialog=terminal&terminal=t2')

    const views = await screen.findAllByTestId('terminal-view')
    const active = views.find((view) => view.getAttribute('data-pty-id') === 't2')
    const inactive = views.find((view) => view.getAttribute('data-pty-id') === 't1')

    expect(active).toHaveAttribute('data-active', 'true')
    expect(inactive).toHaveAttribute('data-active', 'false')
  })

  it('shows an exited badge with the exit code', async () => {
    mockTerminalHooks([exitedTerminal])
    renderPanel()
    await screen.findAllByTestId('terminal-view')

    expect(screen.getByText('exited (0)')).toBeInTheDocument()
  })

  it('asks for confirmation before closing a running terminal', async () => {
    mockTerminalHooks([runningTerminal])
    renderPanel()
    await screen.findAllByTestId('terminal-view')

    fireEvent.click(screen.getByLabelText('Close Terminal'))

    expect(screen.getByText('Close this terminal?')).toBeInTheDocument()
    expect(removeMutate).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Close terminal' }))

    expect(removeMutate).toHaveBeenCalledWith({ ptyID: 't1', directory: '/repo' }, expect.any(Object))
  })

  it('removes an exited terminal without confirmation', async () => {
    mockTerminalHooks([exitedTerminal])
    renderPanel()
    await screen.findAllByTestId('terminal-view')

    fireEvent.click(screen.getByLabelText('Close Build'))

    expect(screen.queryByText('Close this terminal?')).not.toBeInTheDocument()
    expect(removeMutate).toHaveBeenCalledWith({ ptyID: 't2', directory: '/repo' }, expect.any(Object))
  })

  it('removes a cleanly exited terminal, closes the panel when it was the last, and does not respawn', async () => {
    mockTerminalHooks([runningTerminal])
    refetch.mockResolvedValue({ data: [{ ...runningTerminal, status: 'exited', exitCode: 0 }] })
    removeMutate.mockImplementation((_variables: unknown, options: { onSuccess?: () => void }) => {
      options.onSuccess?.()
    })
    const onClose = vi.fn()
    renderPanel('/repos/1?dialog=terminal&terminal=t1', onClose)
    await screen.findAllByTestId('terminal-view')

    fireEvent.click(screen.getByLabelText('exit t1'))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(removeMutate).toHaveBeenCalledWith({ ptyID: 't1', directory: '/repo' }, expect.any(Object))
    expect(screen.queryByLabelText('Close Terminal')).not.toBeInTheDocument()
    expect(createMutate).not.toHaveBeenCalled()
  })

  it('keeps a terminal that exited with a non-zero code so the failure stays inspectable', async () => {
    mockTerminalHooks([runningTerminal])
    refetch.mockResolvedValue({ data: [{ ...runningTerminal, status: 'exited', exitCode: 2 }] })
    const onClose = vi.fn()
    const { rerender } = renderPanel('/repos/1?dialog=terminal&terminal=t1', onClose)
    await screen.findAllByTestId('terminal-view')

    fireEvent.click(screen.getByLabelText('exit t1'))

    await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1))
    expect(removeMutate).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Close Terminal')).toBeInTheDocument()

    mockTerminalHooks([{ ...runningTerminal, status: 'exited', exitCode: 2 }])
    rerender(
      <MemoryRouter initialEntries={['/repos/1?dialog=terminal&terminal=t1']}>
        <TerminalPanel target={{ kind: 'repo', repoId: 1 }} directory="/repo" isOpen onClose={onClose} />
      </MemoryRouter>,
    )

    expect(await screen.findByText('exited (2)')).toBeInTheDocument()
  })

  it('keeps the panel open and selects another running terminal when one exits cleanly', async () => {
    const otherTerminal: TerminalInfo = { ...runningTerminal, id: 't3', title: 'Shell' }
    mockTerminalHooks([runningTerminal, otherTerminal])
    refetch.mockResolvedValue({
      data: [runningTerminal, { ...otherTerminal, status: 'exited', exitCode: 0 }],
    })
    removeMutate.mockImplementation((_variables: unknown, options: { onSuccess?: () => void }) => {
      options.onSuccess?.()
    })
    const onClose = vi.fn()
    renderPanel('/repos/1?dialog=terminal&terminal=t3', onClose)

    const views = await screen.findAllByTestId('terminal-view')
    expect(views.find((view) => view.getAttribute('data-pty-id') === 't3')).toHaveAttribute('data-active', 'true')

    fireEvent.click(screen.getByLabelText('exit t3'))

    await waitFor(() => expect(screen.queryByLabelText('Close Shell')).not.toBeInTheDocument())
    expect(removeMutate).toHaveBeenCalledWith({ ptyID: 't3', directory: '/repo' }, expect.any(Object))
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByTestId('terminal-view')).toHaveAttribute('data-pty-id', 't1')
    expect(screen.getByTestId('terminal-view')).toHaveAttribute('data-active', 'true')
    expect(createMutate).not.toHaveBeenCalled()
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
    mockTerminalHooks([runningActionTerminal])
    refetch.mockResolvedValue({ data: [{ ...runningActionTerminal, status: 'exited', exitCode: 0 }] })
    const onClose = vi.fn()
    const { rerender } = renderPanel('/repos/1?dialog=terminal&terminal=t4', onClose)
    await screen.findAllByTestId('terminal-view')

    fireEvent.click(screen.getByLabelText('exit t4'))

    await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1))
    expect(removeMutate).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Close Say hi')).toBeInTheDocument()

    mockTerminalHooks([{ ...runningActionTerminal, status: 'exited', exitCode: 0 }])
    rerender(
      <MemoryRouter initialEntries={['/repos/1?dialog=terminal&terminal=t4']}>
        <TerminalPanel target={{ kind: 'repo', repoId: 1 }} directory="/repo" isOpen onClose={onClose} />
      </MemoryRouter>,
    )

    expect(await screen.findByText('exited (0)')).toBeInTheDocument()
  })

  it('sends a single delete when a closed terminal reports its exit', async () => {
    mockTerminalHooks([runningTerminal])
    const onClose = vi.fn()
    renderPanel('/repos/1?dialog=terminal&terminal=t1', onClose)
    await screen.findAllByTestId('terminal-view')

    fireEvent.click(screen.getByLabelText('Close Terminal'))
    fireEvent.click(screen.getByRole('button', { name: 'Close terminal' }))

    expect(removeMutate).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByLabelText('exit t1'))

    expect(refetch).not.toHaveBeenCalled()
    expect(removeMutate).toHaveBeenCalledTimes(1)
  })

  it('closes the panel after the user closes the last terminal', async () => {
    mockTerminalHooks([runningTerminal])
    removeMutate.mockImplementation((_variables: unknown, options: { onSuccess?: () => void }) => {
      options.onSuccess?.()
    })
    const onClose = vi.fn()
    renderPanel('/repos/1?dialog=terminal&terminal=t1', onClose)
    await screen.findAllByTestId('terminal-view')

    fireEvent.click(screen.getByLabelText('Close Terminal'))
    fireEvent.click(screen.getByRole('button', { name: 'Close terminal' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps the panel open when other terminals remain after a manual close', async () => {
    const otherTerminal: TerminalInfo = { ...runningTerminal, id: 't3', title: 'Shell' }
    mockTerminalHooks([runningTerminal, otherTerminal])
    removeMutate.mockImplementation((_variables: unknown, options: { onSuccess?: () => void }) => {
      options.onSuccess?.()
    })
    const onClose = vi.fn()
    renderPanel('/repos/1?dialog=terminal&terminal=t3', onClose)
    await screen.findAllByTestId('terminal-view')

    fireEvent.click(screen.getByLabelText('Close Shell'))
    fireEvent.click(screen.getByRole('button', { name: 'Close terminal' }))

    expect(removeMutate).toHaveBeenCalledWith({ ptyID: 't3', directory: '/repo' }, expect.any(Object))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('numbers new shell tabs so they can be told apart', async () => {
    mockTerminalHooks([runningTerminal])
    renderPanel()
    await screen.findAllByTestId('terminal-view')

    fireEvent.click(screen.getByRole('button', { name: 'New terminal' }))

    expect(createMutate).toHaveBeenCalledWith({ directory: '/repo', title: 'Terminal 2' }, expect.any(Object))
  })

  it('renders the key bar only on mobile', async () => {
    mockTerminalHooks([runningTerminal])

    vi.mocked(useMobile).mockReturnValue(false)
    const first = renderPanel()
    await screen.findAllByTestId('terminal-view')
    expect(screen.queryByTestId('terminal-key-bar')).not.toBeInTheDocument()

    first.unmount()

    vi.mocked(useMobile).mockReturnValue(true)
    renderPanel()
    await screen.findAllByTestId('terminal-view')
    expect(screen.getByTestId('terminal-key-bar')).toBeInTheDocument()
  })
})
