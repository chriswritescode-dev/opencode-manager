import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AgentDialog } from './AgentDialog'

vi.mock('@/hooks/useProvidersWithModels', () => ({
  useProvidersWithModels: () => ({ data: [] }),
}))

const renderDialog = (editingAgent: { name: string; agent: { prompt: string; model?: string } } | null) =>
  render(<AgentDialog open onOpenChange={vi.fn()} onSubmit={vi.fn()} editingAgent={editingAgent} />)

describe('AgentDialog model parsing', () => {
  beforeAll(() => {
    Element.prototype.hasPointerCapture ??= () => false
    Element.prototype.setPointerCapture ??= () => {}
    Element.prototype.releasePointerCapture ??= () => {}
    Element.prototype.scrollIntoView ??= () => {}
  })

  it('loads provider and model from a model reference', async () => {
    renderDialog({ name: 'reviewer', agent: { prompt: 'Review code', model: 'openai/gpt-4o' } })

    await waitFor(() => expect(screen.getByPlaceholderText('Select or type provider...')).toHaveValue('openai'))
    expect(screen.getByPlaceholderText('Select or type model...')).toHaveValue('gpt-4o')
  })

  it('keeps the variant attached to the model id', async () => {
    renderDialog({ name: 'reviewer', agent: { prompt: 'Review code', model: 'openai/gpt-4o#high' } })

    await waitFor(() => expect(screen.getByPlaceholderText('Select or type provider...')).toHaveValue('openai'))
    expect(screen.getByPlaceholderText('Select or type model...')).toHaveValue('gpt-4o#high')
  })

  it('leaves provider and model empty when the agent has no model', async () => {
    renderDialog({ name: 'reviewer', agent: { prompt: 'Review code' } })

    await waitFor(() => expect(screen.getByPlaceholderText('Select or type provider...')).toHaveValue(''))
    expect(screen.getByPlaceholderText('Select or type model...')).toHaveValue('')
  })

  it('round-trips a variant model reference on submit', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    render(
      <AgentDialog
        open
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
        editingAgent={{ name: 'reviewer', agent: { prompt: 'Review code', model: 'openai/gpt-4o#high' } }}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Update' }))

    expect(onSubmit).toHaveBeenCalledWith(
      'reviewer',
      expect.objectContaining({ model: 'openai/gpt-4o#high' }),
    )
  })
})
