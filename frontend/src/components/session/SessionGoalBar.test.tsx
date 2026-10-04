import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SessionGoalBar } from './SessionGoalBar'
import {
  useCancelSessionGoal,
  usePauseSessionGoal,
  useResumeSessionGoal,
  useSessionGoal,
} from '@/hooks/useSessionGoals'
import type { SessionGoal } from '@opencode-manager/shared/schemas'

vi.mock('@/hooks/useSessionGoals')

const baseGoal: SessionGoal = {
  id: 1,
  sessionId: 'ses_1',
  directory: '/repo',
  objective: 'Ship the feature',
  status: 'active',
  stopReason: null,
  turnState: 'running',
  continuationCount: 2,
  maxContinuations: 20,
  tokenBudget: null,
  tokensUsed: 0,
  consecutiveBlocked: 0,
  lastVerdict: null,
  lastReason: null,
  createdAt: 1,
  updatedAt: 1,
  finishedAt: null,
}

function mockGoals(
  goal: SessionGoal | null,
  overrides: {
    pause?: ReturnType<typeof vi.fn>
    resume?: ReturnType<typeof vi.fn>
    cancel?: ReturnType<typeof vi.fn>
  } = {},
) {
  vi.mocked(useSessionGoal).mockReturnValue({ data: goal } as ReturnType<typeof useSessionGoal>)
  vi.mocked(usePauseSessionGoal).mockReturnValue({
    mutate: overrides.pause ?? vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof usePauseSessionGoal>)
  vi.mocked(useResumeSessionGoal).mockReturnValue({
    mutate: overrides.resume ?? vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useResumeSessionGoal>)
  vi.mocked(useCancelSessionGoal).mockReturnValue({
    mutate: overrides.cancel ?? vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useCancelSessionGoal>)
}

describe('SessionGoalBar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders nothing when there is no goal', () => {
    mockGoals(null)
    const { container } = render(<SessionGoalBar sessionID="ses_1" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the turn counter and pauses the active goal', async () => {
    const user = userEvent.setup()
    const pause = vi.fn()
    mockGoals({ ...baseGoal }, { pause })
    render(<SessionGoalBar sessionID="ses_1" />)

    expect(screen.getByText('Goal active')).toBeInTheDocument()
    expect(screen.getByText('Turn 2/20')).toBeInTheDocument()
    expect(screen.getByText('Ship the feature')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Pause' }))

    expect(pause).toHaveBeenCalledWith(1)
  })

  it('shows token usage when a budget is set', () => {
    mockGoals({ ...baseGoal, tokenBudget: 1000, tokensUsed: 250 })
    render(<SessionGoalBar sessionID="ses_1" />)

    expect(screen.getByText('250/1,000 tokens')).toBeInTheDocument()
  })

  it('resumes a paused goal', async () => {
    const user = userEvent.setup()
    const resume = vi.fn()
    mockGoals({ ...baseGoal, status: 'paused' }, { resume })
    render(<SessionGoalBar sessionID="ses_1" />)

    expect(screen.getByText('Goal paused')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Resume' }))

    expect(resume).toHaveBeenCalledWith(1)
  })

  it('shows a terminal summary and can be dismissed', async () => {
    const user = userEvent.setup()
    mockGoals({ ...baseGoal, status: 'completed', stopReason: 'continuation_limit' })
    render(<SessionGoalBar sessionID="ses_1" />)

    expect(screen.getByText('Goal completed')).toBeInTheDocument()
    expect(screen.getByText('Continuation limit reached')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Dismiss' }))

    expect(screen.queryByText('Goal completed')).not.toBeInTheDocument()
  })

  it('shows the shared stop-reason wording for a user-paused goal', () => {
    mockGoals({ ...baseGoal, status: 'stopped', stopReason: 'user_paused' })
    render(<SessionGoalBar sessionID="ses_1" />)

    expect(screen.getByText('Goal stopped')).toBeInTheDocument()
    expect(screen.getByText('Paused by user')).toBeInTheDocument()
  })

  it('shows the shared stop-reason wording for an audit failure', () => {
    mockGoals({ ...baseGoal, status: 'blocked', stopReason: 'audit_failed' })
    render(<SessionGoalBar sessionID="ses_1" />)

    expect(screen.getByText('Goal blocked')).toBeInTheDocument()
    expect(screen.getByText('Audit failed')).toBeInTheDocument()
  })

  it('cancels the goal through the cancel API', async () => {
    const user = userEvent.setup()
    const cancel = vi.fn()
    mockGoals({ ...baseGoal }, { cancel })
    render(<SessionGoalBar sessionID="ses_1" />)

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(cancel).toHaveBeenCalledWith(1)
  })
})
