import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ContextUsageIndicator } from './ContextUsageIndicator'

const mocks = vi.hoisted(() => ({
  useContextUsage: vi.fn(),
  useMobile: vi.fn(),
}))

vi.mock('@/hooks/useContextUsage', () => ({
  useContextUsage: mocks.useContextUsage,
}))

vi.mock('@/hooks/useMobile', () => ({
  useMobile: mocks.useMobile,
}))

function renderIndicator() {
  return render(<ContextUsageIndicator sessionID="ses_1" isConnected={true} />)
}

describe('ContextUsageIndicator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders tokens and percentage on desktop', () => {
    mocks.useMobile.mockReturnValue(false)
    mocks.useContextUsage.mockReturnValue({ usage: { totalTokens: 1234, usagePercentage: 42 }, isLoading: false })
    renderIndicator()

    expect(screen.getByText('1,234 (42%)')).toBeInTheDocument()
    expect(screen.queryByText('42%')).not.toBeInTheDocument()
  })

  it('renders only the percentage on mobile', () => {
    mocks.useMobile.mockReturnValue(true)
    mocks.useContextUsage.mockReturnValue({ usage: { totalTokens: 1234, usagePercentage: 42 }, isLoading: false })
    renderIndicator()

    expect(screen.getByText('42%')).toBeInTheDocument()
    expect(screen.queryByText('1,234 (42%)')).not.toBeInTheDocument()
  })

  it('renders only the token count on mobile without a percentage', () => {
    mocks.useMobile.mockReturnValue(true)
    mocks.useContextUsage.mockReturnValue({ usage: { totalTokens: 1234, usagePercentage: null }, isLoading: false })
    renderIndicator()

    expect(screen.getByText('1,234')).toBeInTheDocument()
  })
})
