import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AgentsEditor } from './AgentsEditor'
import { renderWithProviders } from '@/test/render'
import type { FetchRoute } from '@/test/fetchFake'

const mockAgents = {
  'code-reviewer': {
    description: 'Reviews code changes',
    mode: 'subagent' as const,
  },
  'helper': {
    description: 'General helper agent',
    mode: 'primary' as const,
    disabled: true,
  },
}

const modelRoutes: FetchRoute[] = [
  { method: 'GET', path: '/api/providers/model-state', respond: () => ({ json: { recent: [], favorite: [], variant: {} } }) },
  { method: 'GET', path: '/api/opencode/api/provider', respond: () => ({ json: { data: [] } }) },
  { method: 'GET', path: '/api/opencode/api/model', respond: () => ({ json: { data: [] } }) },
  { method: 'GET', path: '/api/opencode/api/config', respond: () => ({ json: {} }) },
  { method: 'GET', path: '/api/opencode/api/model/default', respond: () => ({ json: { data: null } }) },
]

function renderEditor(ui: Parameters<typeof renderWithProviders>[0]) {
  return renderWithProviders(ui, { auth: false, theme: false, tts: false, fetchRoutes: modelRoutes })
}

describe('AgentsEditor', () => {
  it('renders empty state when no agents configured', () => {
    renderEditor(<AgentsEditor agents={{}} onSave={vi.fn()} onDelete={vi.fn()} />)

    expect(screen.getByText('No agents configured')).toBeInTheDocument()
    expect(screen.getByText('Add your first agent to get started.')).toBeInTheDocument()
  })

  it('renders agent names', () => {
    renderEditor(<AgentsEditor agents={mockAgents} onSave={vi.fn()} onDelete={vi.fn()} />)

    expect(screen.getByText('code-reviewer')).toBeInTheDocument()
    expect(screen.getByText('helper')).toBeInTheDocument()
  })

  it('renders uploaded directory agent files', () => {
    renderEditor(
      <AgentsEditor
        agents={{}}
        directoryAgents={[{ kind: 'agents', name: 'planner', relativePath: 'team/planner.md' }]}
        onSave={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    expect(screen.getByText('planner')).toBeInTheDocument()
    expect(screen.getByText('Uploaded file: team/planner.md')).toBeInTheDocument()
    expect(screen.getByText('File')).toBeInTheDocument()
    expect(screen.queryByText('No agents configured')).not.toBeInTheDocument()
  })

  it('opens the edit dialog from the row action', async () => {
    const user = userEvent.setup()
    renderEditor(<AgentsEditor agents={mockAgents} onSave={vi.fn()} onDelete={vi.fn()} />)

    await user.click(screen.getAllByText('Edit')[0])

    expect(await screen.findByRole('dialog', { name: 'Edit Agent' })).toBeInTheDocument()
  })

  it('opens the edit dialog from the row body', async () => {
    const user = userEvent.setup()
    renderEditor(<AgentsEditor agents={mockAgents} onSave={vi.fn()} onDelete={vi.fn()} />)

    await user.click(screen.getByText('code-reviewer'))

    expect(await screen.findByRole('dialog', { name: 'Edit Agent' })).toBeInTheDocument()
  })

  it('opens the create dialog from the add button', async () => {
    const user = userEvent.setup()
    renderEditor(<AgentsEditor agents={{}} onSave={vi.fn()} onDelete={vi.fn()} />)

    await user.click(screen.getByText('Add Agent'))

    expect(await screen.findByRole('dialog', { name: 'Create Agent' })).toBeInTheDocument()
  })

  it('calls onDelete with the agent name when Delete is clicked from overflow menu', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()
    renderEditor(<AgentsEditor agents={mockAgents} onSave={vi.fn()} onDelete={onDelete} />)

    await user.click(screen.getByLabelText('Actions for code-reviewer'))
    await user.click(screen.getByText('Delete'))

    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(onDelete).toHaveBeenCalledWith('code-reviewer')
  })

  it('renders mode and disabled badges for agents', () => {
    renderEditor(<AgentsEditor agents={mockAgents} onSave={vi.fn()} onDelete={vi.fn()} />)

    expect(screen.getByText('subagent')).toBeInTheDocument()
    expect(screen.getByText('Disabled')).toBeInTheDocument()
  })
})
