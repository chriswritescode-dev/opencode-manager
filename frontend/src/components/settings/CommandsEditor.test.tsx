import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CommandsEditor } from './CommandsEditor'

const mocks = vi.hoisted(() => ({
  installOpenCodeDirectoryFiles: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}))

vi.mock('./CommandDialog', () => ({
  CommandDialog: ({ open, editingCommand }: { open: boolean; editingCommand?: { name: string } | null }) =>
    open ? <div data-testid="command-dialog">{editingCommand ? 'Edit Command' : 'Create Command'}</div> : null,
}))

vi.mock('@/api/settings', () => ({
  settingsApi: {
    installOpenCodeDirectoryFiles: mocks.installOpenCodeDirectoryFiles,
  },
}))

vi.mock('sonner', () => ({
  toast: {
    error: mocks.toastError,
    success: mocks.toastSuccess,
  },
}))

const createWrapper = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

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
    mocks.installOpenCodeDirectoryFiles.mockResolvedValue({ kind: 'commands', filesInstalled: ['git/commit.md'] })
  })

  it('renders empty state when no commands configured', () => {
    const onChange = vi.fn()
    render(<CommandsEditor commands={{}} onChange={onChange} />, { wrapper: createWrapper() })

    expect(screen.getByText('No commands configured')).toBeInTheDocument()
    expect(screen.getByText('Add your first command to get started.')).toBeInTheDocument()
  })

  it('renders command names with leading slash', () => {
    const onChange = vi.fn()
    render(<CommandsEditor commands={mockCommands} onChange={onChange} />, { wrapper: createWrapper() })

    expect(screen.getByText('/review')).toBeInTheDocument()
    expect(screen.getByText('/build')).toBeInTheDocument()
  })

  it('opens CommandDialog when clicking Edit on a row', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<CommandsEditor commands={mockCommands} onChange={onChange} />, { wrapper: createWrapper() })

    const editButtons = screen.getAllByText('Edit')
    await user.click(editButtons[0])

    expect(screen.getByTestId('command-dialog')).toBeInTheDocument()
    expect(screen.getByText('Edit Command')).toBeInTheDocument()
  })

  it('opens CommandDialog when clicking row body', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<CommandsEditor commands={mockCommands} onChange={onChange} />, { wrapper: createWrapper() })

    await user.click(screen.getByText('/review'))

    expect(screen.getByTestId('command-dialog')).toBeInTheDocument()
  })

  it('opens CommandDialog and displays Create Command text when clicking Add Command button', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<CommandsEditor commands={{}} onChange={onChange} />, { wrapper: createWrapper() })

    await user.click(screen.getByText('Add Command'))

    expect(screen.getByTestId('command-dialog')).toBeInTheDocument()
    expect(screen.getByText('Create Command')).toBeInTheDocument()
  })

  it('calls onChange with command removed when Delete is clicked from overflow menu', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<CommandsEditor commands={mockCommands} onChange={onChange} />, { wrapper: createWrapper() })

    await user.click(screen.getByLabelText('Actions for /review'))
    await user.click(screen.getByText('Delete'))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith({ build: mockCommands.build })
  })

  it('renders agent badge when command has agent', () => {
    const onChange = vi.fn()
    render(<CommandsEditor commands={mockCommands} onChange={onChange} />, { wrapper: createWrapper() })

    expect(screen.getByText('code-reviewer')).toBeInTheDocument()
  })

  it('uploads only markdown files from a selected commands folder', async () => {
    const onChange = vi.fn()
    const markdownFile = new File(['commit body'], 'commit.md', { type: 'text/markdown' })
    const systemFile = new File(['metadata'], '.DS_Store')
    Object.defineProperty(markdownFile, 'webkitRelativePath', { value: 'commands/git/commit.md' })
    Object.defineProperty(systemFile, 'webkitRelativePath', { value: 'commands/.DS_Store' })

    const { container } = render(<CommandsEditor commands={{}} onChange={onChange} />, { wrapper: createWrapper() })
    const input = container.querySelector('input[type="file"]') as HTMLInputElement

    fireEvent.change(input, { target: { files: [markdownFile, systemFile] } })

    await waitFor(() => {
      expect(mocks.installOpenCodeDirectoryFiles).toHaveBeenCalledWith({ kind: 'commands', files: [markdownFile] })
    })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Uploaded 1 command file')
  })

  it('shows an error when a selected commands folder has no markdown files', async () => {
    const onChange = vi.fn()
    const systemFile = new File(['metadata'], '.DS_Store')
    Object.defineProperty(systemFile, 'webkitRelativePath', { value: 'commands/.DS_Store' })

    const { container } = render(<CommandsEditor commands={{}} onChange={onChange} />, { wrapper: createWrapper() })
    const input = container.querySelector('input[type="file"]') as HTMLInputElement

    fireEvent.change(input, { target: { files: [systemFile] } })

    expect(mocks.installOpenCodeDirectoryFiles).not.toHaveBeenCalled()
    expect(mocks.toastError).toHaveBeenCalledWith('No markdown commands files found')
  })
})
