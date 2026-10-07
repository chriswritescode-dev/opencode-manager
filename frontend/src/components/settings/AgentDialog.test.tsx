import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AgentDialog } from './AgentDialog'
import type { Provider } from '@/api/providers'

const mocks = vi.hoisted(() => ({
  useProviders: vi.fn(),
  useOpenCodeModelState: vi.fn(),
  useOpenCodeDefaultModel: vi.fn(),
}))

vi.mock('@/hooks/useProviders', () => ({
  useProviders: mocks.useProviders,
}))

vi.mock('@/hooks/useModelSelection', () => ({
  useOpenCodeModelState: mocks.useOpenCodeModelState,
  useOpenCodeDefaultModel: mocks.useOpenCodeDefaultModel,
}))

const providers: Provider[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    models: [
      { id: 'claude-opus-5-5', key: 'claude-opus-5-5-fast', name: 'Claude Opus 5.5', released: 0, free: false },
    ],
  },
]

describe('AgentDialog model field', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useProviders.mockReturnValue({ data: { providers, models: [] } })
    mocks.useOpenCodeModelState.mockReturnValue({ data: { favorite: [], recent: [], variant: {} } })
    mocks.useOpenCodeDefaultModel.mockReturnValue({ data: null })
  })

  it('loads the stored model reference', async () => {
    render(
      <AgentDialog
        open
        onOpenChange={vi.fn()}
        onSubmit={vi.fn()}
        editingAgent={{ name: 'reviewer', agent: { prompt: 'Review code', model: 'openai/gpt-4o' } }}
      />,
    )

    await waitFor(() => expect(screen.getByLabelText('Model')).toHaveValue('openai/gpt-4o'))
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

  it('loads and round-trips an object-form agent model', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    render(
      <AgentDialog
        open
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
        editingAgent={{
          name: 'reviewer',
          agent: { prompt: 'Review code', model: { providerID: 'openai', model: 'gpt-4o', variant: 'high' } },
        }}
      />,
    )

    await waitFor(() => expect(screen.getByLabelText('Model')).toHaveValue('openai/gpt-4o#high'))

    await user.click(screen.getByRole('button', { name: 'Update' }))

    expect(onSubmit).toHaveBeenCalledWith(
      'reviewer',
      expect.objectContaining({ model: 'openai/gpt-4o#high' }),
    )
  })

  it('submits no model when the field is empty', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    render(
      <AgentDialog
        open
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
        editingAgent={{ name: 'reviewer', agent: { prompt: 'Review code' } }}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Update' }))

    const agent = onSubmit.mock.calls[0][1]
    expect(agent.model).toBeUndefined()
  })

  it('saves the OpenCode key of an aliased model on create', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    render(<AgentDialog open onOpenChange={vi.fn()} onSubmit={onSubmit} editingAgent={null} />)

    await user.type(screen.getByLabelText('Agent Name'), 'reviewer')
    await user.type(screen.getByLabelText('Prompt'), 'Review code')
    await user.click(screen.getByLabelText('Model'))
    await user.click(screen.getByRole('option', { name: /Claude Opus 5\.5/ }))
    await user.click(screen.getByRole('button', { name: 'Create' }))

    expect(onSubmit).toHaveBeenCalledWith(
      'reviewer',
      expect.objectContaining({ model: 'anthropic/claude-opus-5-5-fast' }),
    )
  })
})
