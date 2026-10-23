import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { SessionMessageAssistantTool } from '@opencode-manager/shared/opencode'
import { ExplorationGroup } from './ExplorationGroup'

const mocks = vi.hoisted(() => ({
  useSettings: vi.fn(),
  useToolCallPermission: vi.fn(),
}))

vi.mock('@/hooks/useSettings', () => ({
  useSettings: mocks.useSettings,
}))

vi.mock('@/contexts/EventContext', () => ({
  useToolCallPermission: mocks.useToolCallPermission,
}))

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

describe('ExplorationGroup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useSettings.mockReturnValue({
      preferences: { expandToolCalls: false },
      isLoading: false,
      updateSettings: vi.fn(),
      isUpdating: false,
    })
    mocks.useToolCallPermission.mockReturnValue(null)
  })

  it('summarises a successful run and keeps the arrow marker', () => {
    render(<ExplorationGroup parts={[readTool('r1', 'completed'), readTool('r2', 'completed')]} messageID="msg_1" />)

    const summary = screen.getByRole('button', { name: /Explored: 2 reads/ })
    expect(summary).toHaveTextContent('→')
    expect(summary).not.toHaveTextContent('✗')
  })

  it('marks a run with a failed member and counts it in the label', () => {
    render(<ExplorationGroup parts={[readTool('r1', 'completed'), readTool('r2', 'error')]} messageID="msg_1" />)

    const summary = screen.getByRole('button', { name: /Explored: 2 reads, 1 failed/ })
    const marker = screen.getByText('✗')
    expect(marker).toHaveClass('text-destructive')
    expect(summary).not.toHaveTextContent('→')
  })

  it('keeps the spinner while an exploration run is still in progress', () => {
    const { container } = render(
      <ExplorationGroup parts={[readTool('r1', 'error'), readTool('r2', 'running')]} messageID="msg_1" />,
    )

    expect(screen.getByRole('button', { name: /Exploring: 2 reads/ })).toBeInTheDocument()
    expect(screen.queryByText('✗')).not.toBeInTheDocument()
    expect(container.querySelector('.animate-spin')).not.toBeNull()
  })
})
