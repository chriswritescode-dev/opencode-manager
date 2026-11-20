import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@/test/render'
import { UsageSummaryCards } from './UsageSummaryCards'

const tokens = {
  input: 1500,
  output: 0,
  reasoning: 0,
  cache: { read: 0, write: 0 },
}

const providerOptions = { auth: false, theme: false, tts: false } as const

describe('UsageSummaryCards', () => {
  it('renders spend, tokens and steps with formatted values', () => {
    renderWithProviders(
      <UsageSummaryCards cost={1.5} tokens={tokens} steps={7} />,
      providerOptions,
    )

    expect(screen.getByText('Spend')).toBeInTheDocument()
    expect(screen.getByText('$1.50')).toBeInTheDocument()
    expect(screen.getByText('Tokens')).toBeInTheDocument()
    expect(screen.getByText('2k')).toBeInTheDocument()
    expect(screen.getByText('Steps')).toBeInTheDocument()
    expect(screen.getByText('7')).toBeInTheDocument()
  })

  it('renders prompts, active days and streak when provided', () => {
    renderWithProviders(
      <UsageSummaryCards
        cost={0.25}
        tokens={tokens}
        steps={7}
        prompts={4}
        activeDays={3}
        streak={2}
      />,
      providerOptions,
    )

    expect(screen.getByText('Prompts')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.getByText('Active days')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('Streak')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('renders average tokens per second after spend when provided', () => {
    renderWithProviders(
      <UsageSummaryCards cost={1.5} tokens={tokens} steps={7} tokensPerSecond={100} />,
      providerOptions,
    )

    const labels = screen.getAllByText(/^(Spend|Avg tokens\/s|Tokens|Steps)$/)
    expect(labels.map((node) => node.textContent)).toEqual([
      'Spend',
      'Avg tokens/s',
      'Tokens',
      'Steps',
    ])
    expect(screen.getByText('100.0 tok/s')).toBeInTheDocument()
  })

  it('omits average tokens per second when undefined', () => {
    renderWithProviders(
      <UsageSummaryCards cost={1.5} tokens={tokens} steps={7} />,
      providerOptions,
    )

    expect(screen.queryByText('Avg tokens/s')).not.toBeInTheDocument()
  })

  it('omits prompts, active days and streak when undefined', () => {
    renderWithProviders(
      <UsageSummaryCards cost={1.5} tokens={tokens} steps={7} />,
      providerOptions,
    )

    expect(screen.queryByText('Prompts')).not.toBeInTheDocument()
    expect(screen.queryByText('Active days')).not.toBeInTheDocument()
    expect(screen.queryByText('Streak')).not.toBeInTheDocument()
  })
})
