import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@/test/render'
import { UsageTokenComposition } from './UsageTokenComposition'

const providerOptions = { auth: false, theme: false, tts: false } as const

describe('UsageTokenComposition', () => {
  it('renders every label and formatted value, including zeros', () => {
    renderWithProviders(
      <UsageTokenComposition
        tokens={{
          input: 1500,
          output: 3400,
          reasoning: 0,
          cache: { read: 2400000, write: 0 },
        }}
      />,
      providerOptions,
    )

    expect(screen.getByText('Token composition')).toBeInTheDocument()

    const rows: Array<[string, string]> = [
      ['Input', '2k'],
      ['Output', '3k'],
      ['Reasoning', '0'],
      ['Cache read', '2.4M'],
      ['Cache write', '0'],
    ]

    for (const [label, value] of rows) {
      const term = screen.getByText(label)
      expect(term.nextElementSibling).toHaveTextContent(value)
      expect(term.nextElementSibling?.tagName).toBe('DD')
    }
  })
})
