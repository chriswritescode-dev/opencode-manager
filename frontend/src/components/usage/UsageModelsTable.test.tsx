import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import type { SessionStatsModelUsage } from '@opencode-manager/shared/opencode'
import { renderWithProviders } from '@/test/render'
import { UsageModelsTable } from './UsageModelsTable'

const providerOptions = { auth: false, theme: false, tts: false } as const

interface ModelUsageOptions {
  id: string
  cost: number
  steps?: number
  inputTokens?: number
}

function modelUsage({ id, cost, steps = 1, inputTokens = 0 }: ModelUsageOptions): SessionStatsModelUsage {
  return {
    model: { id, providerID: 'anthropic' },
    steps,
    tokens: {
      input: inputTokens,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    cost,
  }
}

describe('UsageModelsTable', () => {
  it('renders the model key, steps, tokens, cost and share', () => {
    const { unmount } = renderWithProviders(
      <UsageModelsTable
        models={[modelUsage({ id: 'claude-sonnet-4', cost: 0.25, steps: 3, inputTokens: 1500 })]}
      />,
      providerOptions,
    )

    expect(screen.getByRole('heading', { name: 'Models' })).toBeInTheDocument()
    expect(screen.getByText('anthropic/claude-sonnet-4')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('2k')).toBeInTheDocument()
    expect(screen.getByText('$0.2500')).toBeInTheDocument()
    expect(screen.getByText('100.0%')).toBeInTheDocument()

    unmount()

    renderWithProviders(
      <UsageModelsTable
        models={[modelUsage({ id: 'costly', cost: 3 }), modelUsage({ id: 'cheap', cost: 1 })]}
      />,
      providerOptions,
    )

    expect(screen.getByText('25.0%')).toBeInTheDocument()
    expect(screen.getByText('75.0%')).toBeInTheDocument()
  })

  it('preserves the input order of rows', () => {
    renderWithProviders(
      <UsageModelsTable
        models={[modelUsage({ id: 'zeta', cost: 2 }), modelUsage({ id: 'alpha', cost: 1 })]}
      />,
      providerOptions,
    )

    const rows = screen.getAllByRole('row').slice(1)

    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('anthropic/zeta')
    expect(rows[1]).toHaveTextContent('anthropic/alpha')
  })

  it('shows a dash for share when every cost is zero', () => {
    renderWithProviders(
      <UsageModelsTable
        models={[modelUsage({ id: 'alpha', cost: 0 }), modelUsage({ id: 'beta', cost: 0 })]}
      />,
      providerOptions,
    )

    expect(screen.getAllByText('—')).toHaveLength(2)
  })

  it('shows the empty message and no table when there are no models', () => {
    renderWithProviders(<UsageModelsTable models={[]} />, providerOptions)

    expect(screen.getByRole('heading', { name: 'Models' })).toBeInTheDocument()
    expect(screen.getByText('No model usage in this range.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})
