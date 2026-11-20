import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import { renderWithProviders } from '@/test/render'
import { UsageToolsTable } from './UsageToolsTable'

const providerOptions = { auth: false, theme: false, tts: false } as const

const totals = {
  calls: 4,
  succeeded: 3,
  failed: 1,
  unfinished: 0,
}

function cellTexts(row: HTMLElement): Array<string | null> {
  return within(row).getAllByRole('cell').map((cell) => cell.textContent)
}

describe('UsageToolsTable', () => {
  it('renders a tool row with counts and P50 duration', () => {
    renderWithProviders(
      <UsageToolsTable
        totals={totals}
        usage={[{ name: 'bash', calls: 3, succeeded: 2, failed: 1, unfinished: 0, durationP50: 120 }]}
      />,
      providerOptions,
    )

    const rows = screen.getAllByRole('row')

    expect(screen.getByRole('heading', { name: 'Tools' })).toBeInTheDocument()
    expect(cellTexts(rows[1])).toEqual(['bash', '3', '2', '1', '0', '120 ms'])
  })

  it('shows a dash for a missing P50 duration', () => {
    renderWithProviders(
      <UsageToolsTable
        totals={totals}
        usage={[{ name: 'read', calls: 1, succeeded: 1, failed: 0, unfinished: 0 }]}
      />,
      providerOptions,
    )

    const rows = screen.getAllByRole('row')

    expect(cellTexts(rows[1])).toEqual(['read', '1', '1', '0', '0', '—'])
  })

  it('renders the total footer from totals', () => {
    renderWithProviders(
      <UsageToolsTable
        totals={totals}
        usage={[{ name: 'bash', calls: 4, succeeded: 3, failed: 1, unfinished: 0 }]}
      />,
      providerOptions,
    )

    const rows = screen.getAllByRole('row')
    const footer = rows[rows.length - 1]

    expect(footer.parentElement?.tagName).toBe('TFOOT')
    expect(cellTexts(footer)).toEqual(['Total', '4', '3', '1', '0', '—'])
  })

  it('shows the empty message and no table when there is no usage', () => {
    renderWithProviders(<UsageToolsTable totals={totals} usage={[]} />, providerOptions)

    expect(screen.getByRole('heading', { name: 'Tools' })).toBeInTheDocument()
    expect(screen.getByText('No tool calls in this range.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})
