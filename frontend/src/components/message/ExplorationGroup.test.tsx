import { describe, expect, it } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import type { SessionMessageAssistantTool } from '@opencode-manager/shared/opencode'
import { ExplorationGroup } from './ExplorationGroup'
import { renderWithProviders } from '@/test/render'
import { makeSettingsResponse, makeUserPreferences } from '@/test/fixtures/api'

const readTool = (id: string, status: 'completed' | 'running' | 'error'): SessionMessageAssistantTool => {
  if (status === 'completed') {
    return {
      type: 'tool',
      id,
      name: 'read',
      state: { status, input: { filePath: '/repo/a.ts' }, content: [], metadata: {} },
      time: { created: 0, ran: 1, completed: 2 },
    }
  }
  if (status === 'error') {
    return {
      type: 'tool',
      id,
      name: 'read',
      state: { status, input: { filePath: '/repo/missing.ts' }, error: { type: 'tool.failed', message: 'File not found' }, metadata: {} },
      time: { created: 0, ran: 1, completed: 2 },
    }
  }
  return {
    type: 'tool',
    id,
    name: 'read',
    state: { status, input: { filePath: '/repo/a.ts' } },
    time: { created: 0, ran: 1 },
  }
}

function renderGroup(parts: SessionMessageAssistantTool[]) {
  return renderWithProviders(<ExplorationGroup parts={parts} messageID="msg_1" />, {
    auth: false,
    theme: false,
    toaster: false,
    fetchRoutes: [
      {
        method: 'GET',
        path: '/api/settings',
        respond: () => ({ json: makeSettingsResponse({ preferences: makeUserPreferences({ expandToolCalls: false }) }) }),
      },
    ],
  })
}

describe('ExplorationGroup', () => {
  it('summarises a successful run and keeps the arrow marker', async () => {
    renderGroup([readTool('r1', 'completed'), readTool('r2', 'completed')])

    const summary = await screen.findByRole('button', { name: /Explored: 2 reads/ })
    expect(summary).toHaveTextContent('→')
    expect(summary).not.toHaveTextContent('✗')
  })

  it('marks a run with a failed member and counts it in the label', async () => {
    renderGroup([readTool('r1', 'completed'), readTool('r2', 'error')])

    const summary = await screen.findByRole('button', { name: /Explored: 2 reads, 1 failed/ })
    const marker = screen.getByText('✗')
    expect(marker).toHaveClass('text-destructive')
    expect(summary).not.toHaveTextContent('→')
  })

  it('keeps the spinner while an exploration run is still in progress', async () => {
    const { container } = renderGroup([readTool('r1', 'error'), readTool('r2', 'running')])

    expect(await screen.findByRole('button', { name: /Exploring: 2 reads/ })).toBeInTheDocument()
    expect(screen.queryByText('✗')).not.toBeInTheDocument()
    expect(container.querySelector('.animate-spin')).not.toBeNull()
  })

  it('expands the members when the summary is clicked', async () => {
    renderGroup([readTool('r1', 'completed'), readTool('r2', 'completed')])

    const summary = await screen.findByRole('button', { name: /Explored: 2 reads/ })
    expect(summary).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(summary)

    expect(summary).toHaveAttribute('aria-expanded', 'true')
  })
})
