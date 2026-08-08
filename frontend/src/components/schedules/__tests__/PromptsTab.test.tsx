import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PromptsTab } from '../PromptsTab'
import type { PromptDialog } from '@/hooks/useScheduleUrlState'

const sampleTemplate = {
  id: 1,
  title: 'Weekly Health Report',
  category: 'Health',
  cadenceHint: 'Weekly',
  suggestedName: 'weekly-health',
  suggestedDescription: 'Runs a weekly health check',
  description: 'A weekly health report template',
  prompt: 'Run a health check on the repository',
  createdAt: 1_000_000,
  updatedAt: 1_000_000,
}

const mocks = vi.hoisted(() => ({
  deleteMutate: vi.fn(),
}))

vi.mock('@/hooks/usePromptTemplates', () => ({
  usePromptTemplates: () => ({ data: [sampleTemplate], isLoading: false }),
  useCreatePromptTemplate: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdatePromptTemplate: () => ({ mutate: vi.fn(), isPending: false }),
  useDeletePromptTemplate: () => ({ mutate: mocks.deleteMutate, isPending: false }),
}))

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

interface PromptsTabProps {
  promptDialog: PromptDialog
  templateId: number | null
  onNew: () => void
  onEdit: (id: number) => void
  onDelete: (id: number) => void
  onImport: () => void
  onCloseDialog: () => void
}

function createProps(overrides: Partial<PromptsTabProps> = {}): PromptsTabProps {
  return {
    promptDialog: null,
    templateId: null,
    onNew: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onImport: vi.fn(),
    onCloseDialog: vi.fn(),
    ...overrides,
  }
}

describe('PromptsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the sample template title', () => {
    render(<PromptsTab {...createProps()} />, { wrapper: createWrapper() })
    expect(screen.getByText('Weekly Health Report')).toBeInTheDocument()
  })

  it('calls onNew when the New button is clicked', async () => {
    const user = userEvent.setup()
    const onNew = vi.fn()

    render(<PromptsTab {...createProps({ onNew })} />, { wrapper: createWrapper() })

    await user.click(screen.getByRole('button', { name: 'New' }))
    expect(onNew).toHaveBeenCalledTimes(1)
  })

  it('calls onDelete when the delete button on a template card is clicked', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()
    const { container } = render(<PromptsTab {...createProps({ onDelete })} />, {
      wrapper: createWrapper(),
    })

    const deleteButton = container.querySelector('.lucide-trash2')?.closest('button')
    expect(deleteButton).toBeTruthy()
    await user.click(deleteButton!)
    expect(onDelete).toHaveBeenCalledWith(sampleTemplate.id)
  })

  it('calls deleteMutate when confirming the delete dialog', async () => {
    const user = userEvent.setup()

    render(
      <PromptsTab {...createProps({ promptDialog: 'delete', templateId: sampleTemplate.id })} />,
      { wrapper: createWrapper() },
    )

    await waitFor(() => {
      expect(screen.getByText('Delete template')).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(mocks.deleteMutate).toHaveBeenCalledWith(sampleTemplate.id, expect.any(Object))
  })

  it('calls onEdit when the edit button on a template card is clicked', async () => {
    const user = userEvent.setup()
    const onEdit = vi.fn()
    const { container } = render(<PromptsTab {...createProps({ onEdit })} />, {
      wrapper: createWrapper(),
    })

    const editButton = container.querySelector('.lucide-pencil')?.closest('button')
    expect(editButton).toBeTruthy()
    await user.click(editButton!)
    expect(onEdit).toHaveBeenCalledWith(sampleTemplate.id)
  })

  it('shows the edit dialog populated with template values', async () => {
    render(
      <PromptsTab
        {...createProps({ promptDialog: 'edit', templateId: sampleTemplate.id })}
      />,
      { wrapper: createWrapper() },
    )

    await waitFor(() => {
      expect(screen.getByText('Edit template')).toBeInTheDocument()
    })

    const promptTextarea = screen.getByRole('textbox', { name: 'Prompt' })
    expect(promptTextarea).toHaveValue(sampleTemplate.prompt)
  })

  it('imports a markdown file and shows parsed values in the dialog', async () => {
    const user = userEvent.setup()
    const fileContent = '---\ntitle: Imported\n---\nHello prompt'

    const mockFileReader = {
      onload: null as ((e: { target: { result: string } }) => void) | null,
      readAsText: vi.fn(function (this: typeof mockFileReader, _file: Blob) {
        if (this.onload) {
          this.onload({ target: { result: fileContent } })
        }
      }),
    }
    vi.stubGlobal('FileReader', vi.fn(() => mockFileReader))

    const onImport = vi.fn()
    const { container, rerender } = render(
      <PromptsTab {...createProps({ onImport })} />,
      { wrapper: createWrapper() },
    )

    const fileInput = container.querySelector('input[type="file"]')!
    const file = new File([fileContent], 'template.md', { type: 'text/markdown' })
    await user.upload(fileInput, file)

    await waitFor(() => {
      expect(onImport).toHaveBeenCalledTimes(1)
    })

    rerender(
      <PromptsTab
        promptDialog="import"
        templateId={null}
        onNew={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onImport={onImport}
        onCloseDialog={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText('New template')).toBeInTheDocument()
    })

    const promptTextarea = screen.getByRole('textbox', { name: 'Prompt' })
    expect(promptTextarea).toHaveValue('Hello prompt')
  })
})
