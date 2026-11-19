import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import type { FetchRoute } from '@/test/fetchFake'
import { installPointerCapture } from '@/test/browserFakes'
import { renderWithProviders } from '@/test/render'
import { AgentDialog } from './AgentDialog'

const providerRoutes = [
  {
    method: 'GET',
    path: '/api/opencode/api/provider',
    respond: () => ({ json: { data: [{ id: 'anthropic', name: 'Anthropic', activation: 'enabled' }] } }),
  },
  {
    method: 'GET',
    path: '/api/opencode/api/model',
    respond: () => ({
      json: {
        data: [
          {
            id: 'claude-haiku-4',
            modelID: 'claude-haiku-4',
            providerID: 'anthropic',
            name: 'Claude Haiku 4',
            capabilities: {},
            enabled: true,
            status: 'active',
            limit: { context: 200000, output: 64000 },
            time: { released: 10 },
            cost: [{ input: 1, output: 5 }],
            variants: [],
          },
          {
            id: 'claude-opus-5-5-fast',
            modelID: 'claude-opus-5-5',
            providerID: 'anthropic',
            name: 'Claude Opus 5.5',
            capabilities: {},
            enabled: true,
            status: 'active',
            limit: { context: 200000, output: 64000 },
            time: { released: 0 },
            cost: [{ input: 3, output: 15 }],
            variants: [],
          },
        ],
      },
    }),
  },
  { method: 'GET', path: '/api/opencode/api/model/default', respond: () => ({ json: { data: null } }) },
  { method: 'GET', path: '/api/opencode/api/config', respond: () => ({ json: {} }) },
  { method: 'GET', path: '/api/providers/model-state', respond: () => ({ json: {} }) },
] satisfies FetchRoute[]

function render(ui: ReactElement) {
  installPointerCapture()
  return renderWithProviders(ui, {
    auth: false,
    theme: false,
    tts: false,
    toaster: false,
    fetchRoutes: providerRoutes,
  })
}

describe('AgentDialog', () => {
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

  it('prepends a wildcard rule only for an action set away from Default', async () => {
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

  it('writes an explicit Allow over an inherited permission and removes the wildcard rule for Default', async () => {
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

    expect(screen.getByRole('combobox', { name: 'Shell' })).toHaveTextContent('Default')

    await user.click(screen.getByRole('combobox', { name: 'Shell' }))
    await user.click(screen.getByRole('option', { name: 'Allow' }))
    await user.click(screen.getByRole('combobox', { name: 'Edit' }))
    await user.click(screen.getByRole('option', { name: 'Default' }))
    await user.click(screen.getByRole('button', { name: 'Update' }))

    const agent = onSubmit.mock.calls[0][1]
    expect(agent.permissions).toEqual([
      { action: 'shell', resource: '*', effect: 'allow' },
      { action: 'edit', resource: 'src/**', effect: 'allow' },
    ])
  })

  it('places a new wildcard rule after a catch-all rule and before later exceptions', async () => {
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
              { action: '*', resource: '*', effect: 'allow' },
              { action: 'shell', resource: 'git status', effect: 'allow' },
            ],
          },
        }}
      />,
    )

    await user.click(screen.getByRole('combobox', { name: 'Shell' }))
    await user.click(screen.getByRole('option', { name: 'Deny' }))
    await user.click(screen.getByRole('button', { name: 'Update' }))

    const agent = onSubmit.mock.calls[0][1]
    expect(agent.permissions).toEqual([
      { action: '*', resource: '*', effect: 'allow' },
      { action: 'shell', resource: '*', effect: 'deny' },
      { action: 'shell', resource: 'git status', effect: 'allow' },
    ])
  })

  it('deletes the permissions key when every action returns to Default', async () => {
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
            permissions: [{ action: 'shell', resource: '*', effect: 'deny' }],
          },
        }}
      />,
    )

    await user.click(screen.getByRole('combobox', { name: 'Shell' }))
    await user.click(screen.getByRole('option', { name: 'Default' }))
    await user.click(screen.getByRole('button', { name: 'Update' }))

    const agent = onSubmit.mock.calls[0][1]
    expect(agent.permissions).toBeNull()
  })

  it('deletes the request key when the last sampling value is cleared', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    render(
      <AgentDialog
        open
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
        editingAgent={{
          name: 'reviewer',
          agent: { system: 'Review code', request: { body: { temperature: 0.2 } } },
        }}
      />,
    )

    await user.clear(screen.getByLabelText('Temperature'))
    await user.click(screen.getByRole('button', { name: 'Update' }))

    const agent = onSubmit.mock.calls[0][1]
    expect(agent.request).toBeNull()
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
    expect(agent).not.toHaveProperty('request')
  })

  it('leaves sampling values unset by default and removes a cleared stored value', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    render(
      <AgentDialog
        open
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
        editingAgent={{
          name: 'reviewer',
          agent: { system: 'Review code', request: { body: { temperature: 0.2, reasoning_effort: 'high' } } },
        }}
      />,
    )

    expect(screen.getByLabelText('Top P')).toHaveValue(null)

    await user.clear(screen.getByLabelText('Temperature'))
    await user.click(screen.getByRole('button', { name: 'Update' }))

    const agent = onSubmit.mock.calls[0][1]
    expect(agent.request).toEqual({ body: { temperature: null, reasoning_effort: 'high' } })
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
