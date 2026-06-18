import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CommandsEditor } from './CommandsEditor'

vi.mock('./CommandDialog', () => ({
  CommandDialog: ({ open, editingCommand }: { open: boolean; editingCommand?: { name: string } | null }) =>
    open ? <div data-testid="command-dialog">{editingCommand ? 'Edit Command' : 'Create Command'}</div> : null,
}))

const mockCommands = {
  'review': {
    template: 'Review this code',
    description: 'Reviews code changes',
    agent: 'code-reviewer',
  },
  'build': {
    template: 'Build the project',
    description: 'Builds the project',
  },
}

describe('CommandsEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders empty state when no commands configured', () => {
    const onChange = vi.fn()
    render(<CommandsEditor commands={{}} onChange={onChange} />)

    expect(screen.getByText('No commands configured')).toBeInTheDocument()
    expect(screen.getByText('Add your first command to get started.')).toBeInTheDocument()
  })

  it('renders command names with leading slash', () => {
    const onChange = vi.fn()
    render(<CommandsEditor commands={mockCommands} onChange={onChange} />)

    expect(screen.getByText('/review')).toBeInTheDocument()
    expect(screen.getByText('/build')).toBeInTheDocument()
  })

  it('opens CommandDialog when clicking Edit on a row', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<CommandsEditor commands={mockCommands} onChange={onChange} />)

    const editButtons = screen.getAllByText('Edit')
    await user.click(editButtons[0])

    expect(screen.getByTestId('command-dialog')).toBeInTheDocument()
    expect(screen.getByText('Edit Command')).toBeInTheDocument()
  })

  it('opens CommandDialog when clicking row body', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<CommandsEditor commands={mockCommands} onChange={onChange} />)

    await user.click(screen.getByText('/review'))

    expect(screen.getByTestId('command-dialog')).toBeInTheDocument()
  })

  it('opens CommandDialog and displays Create Command text when clicking Add Command button', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<CommandsEditor commands={{}} onChange={onChange} />)

    await user.click(screen.getByText('Add Command'))

    expect(screen.getByTestId('command-dialog')).toBeInTheDocument()
    expect(screen.getByText('Create Command')).toBeInTheDocument()
  })

  it('calls onChange with command removed when Delete is clicked from overflow menu', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<CommandsEditor commands={mockCommands} onChange={onChange} />)

    await user.click(screen.getByLabelText('Actions for /review'))
    await user.click(screen.getByText('Delete'))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith({ build: mockCommands.build })
  })

  it('renders agent badge when command has agent', () => {
    const onChange = vi.fn()
    render(<CommandsEditor commands={mockCommands} onChange={onChange} />)

    expect(screen.getByText('code-reviewer')).toBeInTheDocument()
  })
})
