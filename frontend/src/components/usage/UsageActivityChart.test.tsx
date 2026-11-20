import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@/test/render'
import { UsageActivityChart } from './UsageActivityChart'

const providerOptions = { auth: false, theme: false, tts: false } as const

function barHeight(label: string): string {
  const bar = screen.getByRole('img', { name: label })
  return bar.style.height
}

describe('UsageActivityChart', () => {
  it('renders one accessible bar per day', () => {
    renderWithProviders(
      <UsageActivityChart
        activity={[
          { date: '2026-01-01', steps: 3 },
          { date: '2026-01-02', steps: 1 },
        ]}
      />,
      providerOptions,
    )

    expect(screen.getByText('Activity')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '2026-01-01: 3 steps' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '2026-01-02: 1 steps' })).toBeInTheDocument()
    expect(screen.getAllByRole('img')).toHaveLength(2)
  })

  it('scales bar heights against the busiest day', () => {
    renderWithProviders(
      <UsageActivityChart
        activity={[
          { date: '2026-01-01', steps: 10 },
          { date: '2026-01-02', steps: 5 },
        ]}
      />,
      providerOptions,
    )

    expect(barHeight('2026-01-01: 10 steps')).toBe('100%')
    expect(barHeight('2026-01-02: 5 steps')).toBe('50%')
  })

  it('renders nothing when there is no activity', () => {
    renderWithProviders(<UsageActivityChart activity={[]} />, providerOptions)

    expect(screen.queryByText('Activity')).not.toBeInTheDocument()
    expect(screen.queryAllByRole('img')).toHaveLength(0)
  })

  it('keeps all-zero activity visible without throwing', () => {
    renderWithProviders(
      <UsageActivityChart
        activity={[
          { date: '2026-01-01', steps: 0 },
          { date: '2026-01-02', steps: 0 },
        ]}
      />,
      providerOptions,
    )

    expect(screen.getAllByRole('img')).toHaveLength(2)
    expect(barHeight('2026-01-01: 0 steps')).toBe('0%')
  })
})
