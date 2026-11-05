import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
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
      { id: 'claude-opus-5-5-fast', modelID: 'claude-opus-5-5', name: 'Claude Opus 5.5', released: 0, free: false },
    ],
  },
]

describe('AgentDialog', () => {
  beforeAll(() => {
    Element.prototype.hasPointerCapture ??= () => false
    Element.prototype.setPointerCapture ??= () => {}
    Element.prototype.releasePointerCapture ??= () => {}
    Element.prototype.scrollIntoView ??= () => {}
  })

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
        editingAgent={{ name: 'reviewer', agent: { system: 'Review code', model: 'openai/gpt-4o' } }}
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
        editingAgent={{ name: 'reviewer', agent: { system: 'Review code', model: 'openai/gpt-4o#high' } }}
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
          agent: { system: 'Review code', model: { providerID: 'openai', model: 'gpt-4o', variant: 'high' } },
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

  it('submits null for a cleared model', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    render(
      <AgentDialog
        open
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
        editingAgent={{ name: 'reviewer', agent: { system: 'Review code' } }}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Update' }))

    const agent = onSubmit.mock.calls[0][1]
    expect(agent.model).toBeNull()
  })

  it('sends null for cleared description and model so the merge patch deletes them', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    render(
      <AgentDialog
        open
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
        editingAgent={{
          name: 'reviewer',
          agent: { system: 'Review code', description: 'Reviews changes', model: 'openai/gpt-4o' },
        }}
      />,
    )

    await user.clear(screen.getByLabelText('Description'))
    await user.clear(screen.getByLabelText('Model'))
    await user.click(screen.getByRole('button', { name: 'Update' }))

    expect(onSubmit).toHaveBeenCalledWith(
      'reviewer',
      expect.objectContaining({ description: null, model: null }),
    )
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

  it('maps v2 request body values and permission rules into the form and preserves unrelated fields on save', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    render(
      <AgentDialog
        open
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
        editingAgent={{
          name: 'reviewer',
          agent: {
            system: 'Review code',
            description: 'Reviews changes',
            mode: 'subagent',
            hidden: true,
            color: '#fff',
            steps: 7,
            request: {
              headers: { 'x-test': '1' },
              body: { temperature: 0.2, top_p: 0.5, reasoning_effort: 'high' },
            },
            permissions: [
              { action: 'shell', resource: '*', effect: 'deny' },
              { action: 'edit', resource: 'src/**', effect: 'ask' },
              { action: 'webfetch', resource: '*', effect: 'allow' },
            ],
          },
        }}
      />,
    )

    expect(screen.getByLabelText('Temperature')).toHaveValue(0.2)
    expect(screen.getByLabelText('Top P')).toHaveValue(0.5)
    expect(screen.getByText('Deny')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Update' }))

    const agent = onSubmit.mock.calls[0][1]
    expect(agent.request).toEqual({
      headers: { 'x-test': '1' },
      body: { temperature: 0.2, top_p: 0.5, reasoning_effort: 'high' },
    })
    expect(agent.permissions).toEqual([
      { action: 'shell', resource: '*', effect: 'deny' },
      { action: 'edit', resource: 'src/**', effect: 'ask' },
      { action: 'webfetch', resource: '*', effect: 'allow' },
    ])
    expect(agent.hidden).toBe(true)
    expect(agent.color).toBe('#fff')
    expect(agent.steps).toBe(7)
  })

  it('keeps a wildcard rule before a specific rule and writes the form effect in place', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    render(
      <AgentDialog
        open
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
        editingAgent={{
          name: 'reviewer',
          agent: {
            system: 'Review code',
            permissions: [
              { action: 'edit', resource: '*', effect: 'deny' },
              { action: 'edit', resource: 'src/**', effect: 'allow' },
            ],
          },
        }}
      />,
    )

    await user.click(screen.getByRole('combobox', { name: 'Edit' }))
    await user.click(screen.getByRole('option', { name: 'Ask' }))
    await user.click(screen.getByRole('button', { name: 'Update' }))

    const agent = onSubmit.mock.calls[0][1]
    expect(agent.permissions).toEqual([
      { action: 'edit', resource: '*', effect: 'ask' },
      { action: 'edit', resource: 'src/**', effect: 'allow' },
    ])
  })

  it('adds no wildcard rule for an unchanged action so it keeps inheriting the global permission', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    render(
      <AgentDialog
        open
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
        editingAgent={{
          name: 'reviewer',
          agent: {
            system: 'Review code',
            permissions: [
              { action: 'edit', resource: 'src/**', effect: 'deny' },
              { action: 'shell', resource: 'git status', effect: 'ask' },
            ],
          },
        }}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Update' }))

    const agent = onSubmit.mock.calls[0][1]
    expect(agent.permissions).toEqual([
      { action: 'edit', resource: 'src/**', effect: 'deny' },
      { action: 'shell', resource: 'git status', effect: 'ask' },
    ])
  })

  it('prepends a wildcard rule only for a changed action that has none', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    render(
      <AgentDialog
        open
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
        editingAgent={{
          name: 'reviewer',
          agent: {
            system: 'Review code',
            permissions: [{ action: 'shell', resource: 'git status', effect: 'ask' }],
          },
        }}
      />,
    )

    await user.click(screen.getByRole('combobox', { name: 'Shell' }))
    await user.click(screen.getByRole('option', { name: 'Deny' }))
    await user.click(screen.getByRole('button', { name: 'Update' }))

    const agent = onSubmit.mock.calls[0][1]
    expect(agent.permissions).toEqual([
      { action: 'shell', resource: '*', effect: 'deny' },
      { action: 'shell', resource: 'git status', effect: 'ask' },
    ])
  })

  it('writes no permissions for a prompt-only save of an agent without permission rules', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    render(
      <AgentDialog
        open
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
        editingAgent={{ name: 'reviewer', agent: { system: 'Review code' } }}
      />,
    )

    await user.type(screen.getByLabelText('Prompt'), ' carefully')
    await user.click(screen.getByRole('button', { name: 'Update' }))

    const agent = onSubmit.mock.calls[0][1]
    expect(agent.system).toBe('Review code carefully')
    expect(agent).not.toHaveProperty('permissions')
  })

  it('shows the last matching wildcard effect and applies the form effect to every occurrence', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    render(
      <AgentDialog
        open
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
        editingAgent={{
          name: 'reviewer',
          agent: {
            system: 'Review code',
            permissions: [
              { action: 'edit', resource: '*', effect: 'allow' },
              { action: 'edit', resource: '*', effect: 'deny' },
            ],
          },
        }}
      />,
    )

    expect(screen.getByRole('combobox', { name: 'Edit' })).toHaveTextContent('Deny')

    await user.click(screen.getByRole('combobox', { name: 'Edit' }))
    await user.click(screen.getByRole('option', { name: 'Ask' }))
    await user.click(screen.getByRole('button', { name: 'Update' }))

    const agent = onSubmit.mock.calls[0][1]
    expect(agent.permissions).toEqual([
      { action: 'edit', resource: '*', effect: 'ask' },
      { action: 'edit', resource: '*', effect: 'ask' },
    ])
  })
})
