import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SessionCostIndicator } from './SessionCostIndicator'

const mocks = vi.hoisted(() => ({
  useSessionCost: vi.fn(),
}))

vi.mock('@/hooks/useSessionCost', () => ({
  useSessionCost: mocks.useSessionCost,
}))

function renderIndicator() {
  return render(<SessionCostIndicator sessionID="ses_1" />)
}

describe('SessionCostIndicator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the cost and token total with exact numbers in the tooltip', () => {
    mocks.useSessionCost.mockReturnValue({
      totalCost: 0.1234,
      totalTokens: 1234,
      messageCount: 3,
      isLoading: false,
    })
    renderIndicator()

    expect(screen.getByText('$0.1234 • 1.2K tokens')).toBeInTheDocument()
    expect(screen.getByTestId('session-cost-indicator')).toHaveAttribute(
      'title',
      '3 assistant messages • 1,234 tokens • $0.123400',
    )
  })

  it('omits the dollar figure for zero-cost sessions', () => {
    mocks.useSessionCost.mockReturnValue({
      totalCost: 0,
      totalTokens: 1234,
      messageCount: 2,
      isLoading: false,
    })
    renderIndicator()

    expect(screen.getByText('1.2K tokens')).toBeInTheDocument()
    expect(screen.queryByText(/\$0\.0000/)).not.toBeInTheDocument()
    expect(screen.getByTestId('session-cost-indicator')).toHaveAttribute(
      'title',
      '2 assistant messages • 1,234 tokens • free',
    )
  })

  it('abbreviates large token totals', () => {
    mocks.useSessionCost.mockReturnValue({
      totalCost: 1.25,
      totalTokens: 3_700_000,
      messageCount: 12,
      isLoading: false,
    })
    renderIndicator()

    expect(screen.getByText('$1.2500 • 3.7M tokens')).toBeInTheDocument()
    expect(screen.getByTestId('session-cost-indicator')).toHaveAttribute(
      'title',
      '12 assistant messages • 3,700,000 tokens • $1.250000',
    )
  })

  it('renders nothing when there are no assistant messages', () => {
    mocks.useSessionCost.mockReturnValue({
      totalCost: 0,
      totalTokens: 0,
      messageCount: 0,
      isLoading: false,
    })
    renderIndicator()

    expect(screen.queryByTestId('session-cost-indicator')).not.toBeInTheDocument()
  })

  it('renders a loading state while the transcript is pending', () => {
    mocks.useSessionCost.mockReturnValue({
      totalCost: 0,
      totalTokens: 0,
      messageCount: 0,
      isLoading: true,
    })
    renderIndicator()

    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })
})
