import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AgentsEditor } from './AgentsEditor'

vi.mock('./AgentDialog', () => ({
  AgentDialog: ({ open, editingAgent }: { open: boolean; editingAgent?: { name: string } | null }) =>
    open ? <div data-testid="agent-dialog">{editingAgent ? 'Edit Agent' : 'Create Agent'}</div> : null,
}))

const createWrapper = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

const mockAgents = {
  'code-reviewer': {
    description: 'Reviews code changes',
    mode: 'subagent' as const,
  },
  'helper': {
    description: 'General helper agent',
    mode: 'primary' as const,
    disable: true,
  },
}

describe('AgentsEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders empty state when no agents configured', () => {
    const onChange = vi.fn()
    render(<AgentsEditor agents={{}} onChange={onChange} />, { wrapper: createWrapper() })

    expect(screen.getByText('No agents configured')).toBeInTheDocument()
    expect(screen.getByText('Add your first agent to get started.')).toBeInTheDocument()
  })

  it('renders agent names', () => {
    const onChange = vi.fn()
    render(<AgentsEditor agents={mockAgents} onChange={onChange} />, { wrapper: createWrapper() })

    expect(screen.getByText('code-reviewer')).toBeInTheDocument()
    expect(screen.getByText('helper')).toBeInTheDocument()
  })

  it('renders uploaded directory agent files', () => {
    const onChange = vi.fn()
    render(
      <AgentsEditor
        agents={{}}
        directoryAgents={[{ kind: 'agents', name: 'planner', relativePath: 'team/planner.md' }]}
        onChange={onChange}
      />,
      { wrapper: createWrapper() },
    )

    expect(screen.getByText('planner')).toBeInTheDocument()
    expect(screen.getByText('Uploaded file: team/planner.md')).toBeInTheDocument()
    expect(screen.getByText('File')).toBeInTheDocument()
    expect(screen.queryByText('No agents configured')).not.toBeInTheDocument()
  })

  it('opens AgentDialog when clicking Edit on a row', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<AgentsEditor agents={mockAgents} onChange={onChange} />, { wrapper: createWrapper() })

    const editButtons = screen.getAllByText('Edit')
    await user.click(editButtons[0])

    expect(screen.getByTestId('agent-dialog')).toBeInTheDocument()
    expect(screen.getByText('Edit Agent')).toBeInTheDocument()
  })

  it('opens AgentDialog when clicking row body', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<AgentsEditor agents={mockAgents} onChange={onChange} />, { wrapper: createWrapper() })

    await user.click(screen.getByText('code-reviewer'))

    expect(screen.getByTestId('agent-dialog')).toBeInTheDocument()
  })

  it('opens AgentDialog and displays Create Agent text when clicking Add Agent button', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<AgentsEditor agents={{}} onChange={onChange} />, { wrapper: createWrapper() })

    await user.click(screen.getByText('Add Agent'))

    expect(screen.getByTestId('agent-dialog')).toBeInTheDocument()
    expect(screen.getByText('Create Agent')).toBeInTheDocument()
  })

  it('calls onChange with agent removed when Delete is clicked from overflow menu', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<AgentsEditor agents={mockAgents} onChange={onChange} />, { wrapper: createWrapper() })

    await user.click(screen.getByLabelText('Actions for code-reviewer'))
    await user.click(screen.getByText('Delete'))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith({ helper: mockAgents.helper })
  })

  it('renders mode and disabled badges for agents', () => {
    const onChange = vi.fn()
    render(<AgentsEditor agents={mockAgents} onChange={onChange} />, { wrapper: createWrapper() })

    expect(screen.getByText('subagent')).toBeInTheDocument()
    expect(screen.getByText('Disabled')).toBeInTheDocument()
  })
})
