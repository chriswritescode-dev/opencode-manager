import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { SessionMessageAssistant, SessionMessageInfo } from '@opencode-manager/shared/opencode'
import type { ShellInfo } from '@/api/opencode'
import { BackgroundWorkBar } from './BackgroundWorkBar'

const api = vi.hoisted(() => ({
  backgroundSession: vi.fn(),
  listShells: vi.fn(),
  readShellOutput: vi.fn(),
  removeShell: vi.fn(),
}))

vi.mock('@/api/opencode', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/opencode')>()),
  ...api,
}))

vi.mock('@/lib/toast', () => ({
  showToast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), loading: vi.fn() },
}))

const shell = (id: string, sessionID = 'session-1', status: ShellInfo['status'] = 'running'): ShellInfo => ({
  id,
  status,
  command: `npm run ${id}`,
  cwd: '/repo',
  shell: 'zsh',
  file: `/tmp/${id}.log`,
  metadata: { sessionID },
  time: { started: 1 },
})

const runningShellTool = (): SessionMessageAssistant => ({
  id: 'msg-1',
  type: 'assistant',
  agent: 'build',
  model: { providerID: 'p', id: 'm' },
  content: [
    {
      type: 'tool',
      id: 'tool-1',
      name: 'shell',
      state: { status: 'running', input: { command: 'npm test' }, metadata: {} },
      time: { created: 1 },
    },
  ],
  time: { created: 1 },
})

function renderBar(messages: SessionMessageInfo[], isSessionActive: boolean) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return render(
    <BackgroundWorkBar sessionID="session-1" directory="/repo" messages={messages} isSessionActive={isSessionActive} />,
    { wrapper },
  )
}

describe('BackgroundWorkBar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.listShells.mockResolvedValue([])
    api.backgroundSession.mockResolvedValue(undefined)
    api.removeShell.mockResolvedValue(undefined)
    api.readShellOutput.mockResolvedValue({ output: '', cursor: 0, size: 0, truncated: false })
  })

  it('renders nothing when there is no running or background work', async () => {
    const { container } = renderBar([], false)
    await waitFor(() => expect(api.listShells).toHaveBeenCalledWith('/repo'))
    expect(container).toBeEmptyDOMElement()
  })

  it('moves running shell work to the background', async () => {
    renderBar([runningShellTool()], true)

    fireEvent.click(await screen.findByRole('button', { name: /Move to background/ }))

    await waitFor(() => expect(api.backgroundSession).toHaveBeenCalledWith('session-1'))
  })

  it('hides the background action once the session is idle', async () => {
    renderBar([runningShellTool()], false)
    await waitFor(() => expect(api.listShells).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: /Move to background/ })).not.toBeInTheDocument()
  })

  it('lists only this session\'s running shells and kills one', async () => {
    api.listShells.mockResolvedValue([shell('dev'), shell('other', 'session-2'), shell('done', 'session-1', 'exited')])
    renderBar([], false)

    fireEvent.click(await screen.findByRole('button', { name: /1 background shell$/ }))

    expect(screen.getByText('npm run dev')).toBeInTheDocument()
    expect(screen.queryByText('npm run other')).not.toBeInTheDocument()
    expect(screen.queryByText('npm run done')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Kill npm run dev' }))

    await waitFor(() => expect(api.removeShell).toHaveBeenCalledWith('dev', '/repo'))
    await waitFor(() => expect(screen.queryByText(/background shell/)).not.toBeInTheDocument())
  })

  it('shows the tail of a background shell output', async () => {
    api.listShells.mockResolvedValue([shell('dev')])
    api.readShellOutput.mockResolvedValue({ output: 'server listening on 3000', cursor: 24, size: 24, truncated: false })
    renderBar([], false)

    fireEvent.click(await screen.findByRole('button', { name: /1 background shell$/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Output' }))

    expect(await screen.findByText('server listening on 3000')).toBeInTheDocument()
    expect(api.readShellOutput).toHaveBeenCalledWith('dev', '/repo', 0, 50_000)
  })
})
