import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SessionGoalBar } from './SessionGoalBar'
import { useSessionGoal, useSessionGoalCommand } from '@/hooks/useSessionGoals'
import type { GoalState, SessionGoalRead } from '@opencode-manager/shared/opencode'

vi.mock('@/hooks/useSessionGoals')

const baseGoal: GoalState = {
  id: 'goal_1',
  objective: 'Ship the feature',
  status: 'active',
  rounds: 3,
  maxRounds: 50,
  boot: 'boot_1',
  updatedAt: 1,
}

function mockGoal(
  read: SessionGoalRead,
  overrides: { mutate?: ReturnType<typeof vi.fn>; isPending?: boolean } = {},
) {
  vi.mocked(useSessionGoal).mockReturnValue({ data: read } as ReturnType<typeof useSessionGoal>)
  vi.mocked(useSessionGoalCommand).mockReturnValue({
    mutate: overrides.mutate ?? vi.fn(),
    isPending: overrides.isPending ?? false,
  } as unknown as ReturnType<typeof useSessionGoalCommand>)
}

function renderBar() {
  return render(<SessionGoalBar sessionID="ses_1" directory="/repo" />)
}

describe('SessionGoalBar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders nothing when the active goal is empty', () => {
    mockGoal({ supported: true, goal: null })
    const { container } = renderBar()
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when the server does not support goals', () => {
    mockGoal({ supported: false })
    const { container } = renderBar()
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the active goal and pauses it', async () => {
    const user = userEvent.setup()
    const mutate = vi.fn()
    mockGoal({ supported: true, goal: { ...baseGoal } }, { mutate })
    renderBar()

    expect(screen.getByText('Goal active')).toBeInTheDocument()
    expect(screen.getByText('Round 3/50')).toBeInTheDocument()
    expect(screen.getByText('Ship the feature')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Pause' }))
    expect(mutate).toHaveBeenCalledWith({ sessionID: 'ses_1', text: 'pause' })

    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(mutate).toHaveBeenCalledWith({ sessionID: 'ses_1', text: 'clear' })
  })

  it('resumes a paused goal and shows the pause reason', async () => {
    const user = userEvent.setup()
    const mutate = vi.fn()
    mockGoal({ supported: true, goal: { ...baseGoal, status: 'paused', reason: 'Paused by the user' } }, { mutate })
    renderBar()

    expect(screen.getByText('Goal paused')).toBeInTheDocument()
    expect(screen.getByText('Paused by the user')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Resume' }))
    expect(mutate).toHaveBeenCalledWith({ sessionID: 'ses_1', text: 'resume' })
  })

  it('shows a completed goal with its reason and clears it', async () => {
    const user = userEvent.setup()
    const mutate = vi.fn()
    mockGoal({ supported: true, goal: { ...baseGoal, status: 'complete', reason: 'Objective met' } }, { mutate })
    renderBar()

    expect(screen.getByText('Goal completed')).toBeInTheDocument()
    expect(screen.getByText('Objective met')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(mutate).toHaveBeenCalledWith({ sessionID: 'ses_1', text: 'clear' })
  })

  it('disables the goal buttons while the command is pending', () => {
    mockGoal({ supported: true, goal: { ...baseGoal } }, { isPending: true })
    renderBar()

    expect(screen.getByRole('button', { name: 'Pause' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled()
  })
})
