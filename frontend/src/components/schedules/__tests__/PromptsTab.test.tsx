import { useReducer } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PromptsTab } from '../PromptsTab'
import { renderWithProviders } from '@/test/render'
import type { FetchRoute } from '@/test/fetchFake'
import type { PromptTemplate } from '@opencode-manager/shared/types'

const sampleTemplate: PromptTemplate = {
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

const routes: FetchRoute[] = [
  { method: 'GET', path: '/api/prompt-templates', respond: () => ({ json: { templates: [sampleTemplate] } }) },
  { method: 'DELETE', path: '/api/prompt-templates/:id', respond: () => ({ status: 204 }) },
]

interface PromptsTabProps {
  promptDialog: 'new' | 'edit' | 'import' | 'delete' | null
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

function renderPromptsTab(overrides: Partial<PromptsTabProps> = {}) {
  const active: PromptsTabProps = createProps(overrides)
  const harness = { rerender: () => {} }

  function Harness() {
    const [, force] = useReducer((count: number) => count + 1, 0)
    harness.rerender = force
    return <PromptsTab {...active} />
  }

  const result = renderWithProviders(<Harness />, {
    auth: false,
    theme: false,
    toaster: false,
    fetchRoutes: routes,
  })

  return {
    ...result,
    rerenderWith: async (update: Partial<PromptsTabProps>) => {
      Object.assign(active, update)
      await act(async () => {
        harness.rerender()
      })
    },
  }
}

describe('PromptsTab', () => {
  it('filters templates by search and shows an empty match state', async () => {
    const user = userEvent.setup()
    renderPromptsTab()

    const search = await screen.findByRole('searchbox', { name: 'Search prompts' })
    await user.type(search, 'health')
    expect(screen.getByText('Weekly Health Report')).toBeInTheDocument()

    await user.clear(search)
    await user.type(search, 'nothing here')
    expect(screen.queryByText('Weekly Health Report')).not.toBeInTheDocument()
    expect(screen.getByText('No matching templates')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(screen.getByText('Weekly Health Report')).toBeInTheDocument()
  })

  it('renders the sample template title', async () => {
    renderPromptsTab()

    expect(await screen.findByText('Weekly Health Report')).toBeInTheDocument()
  })

  it('calls onNew when the New button is clicked', async () => {
    const user = userEvent.setup()
    const onNew = vi.fn()
    renderPromptsTab({ onNew })

    await user.click(screen.getByRole('button', { name: 'New' }))

    expect(onNew).toHaveBeenCalledTimes(1)
  })

  it('calls onDelete from the row actions menu', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()
    renderPromptsTab({ onDelete })

    await user.click(await screen.findByRole('button', { name: 'More actions' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))

    expect(onDelete).toHaveBeenCalledWith(sampleTemplate.id)
  })

  it('deletes the template when the delete dialog is confirmed', async () => {
    const user = userEvent.setup()
    const result = renderPromptsTab({ promptDialog: 'delete', templateId: sampleTemplate.id })

    await waitFor(() => expect(screen.getByText('Delete template')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() =>
      expect(result.fetchFake.lastRequest('DELETE', '/api/prompt-templates/:id')?.path).toBe(`/api/prompt-templates/${sampleTemplate.id}`),
    )
  })

  it('calls onEdit when a template row is clicked', async () => {
    const user = userEvent.setup()
    const onEdit = vi.fn()
    renderPromptsTab({ onEdit })

    await user.click(await screen.findByText('Weekly Health Report'))

    expect(onEdit).toHaveBeenCalledWith(sampleTemplate.id)
  })

  it('shows the edit dialog populated with template values', async () => {
    renderPromptsTab({ promptDialog: 'edit', templateId: sampleTemplate.id })

    await waitFor(() => expect(screen.getByText('Edit template')).toBeInTheDocument())

    expect(screen.getByRole('textbox', { name: 'Prompt' })).toHaveValue(sampleTemplate.prompt)
  })

  it('imports a markdown file and shows parsed values in the dialog', async () => {
    const user = userEvent.setup()
    const onImport = vi.fn()
    const fileContent = '---\ntitle: Imported\n---\nHello prompt'
    const { container, rerenderWith } = renderPromptsTab({ onImport })

    const fileInput = container.querySelector('input[type="file"]')
    if (!(fileInput instanceof HTMLInputElement)) throw new Error('template file input is not rendered')

    await user.upload(fileInput, new File([fileContent], 'template.md', { type: 'text/markdown' }))

    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1))

    await rerenderWith({ promptDialog: 'import' })

    await waitFor(() => expect(screen.getByText('New template')).toBeInTheDocument())

    expect(screen.getByRole('textbox', { name: 'Prompt' })).toHaveValue('Hello prompt')
  })
})
