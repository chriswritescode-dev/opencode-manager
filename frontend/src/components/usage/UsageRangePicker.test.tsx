import { beforeAll, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UsageRangePicker } from './UsageRangePicker'
import { installPointerCapture } from '@/test/browserFakes'
import { renderWithProviders } from '@/test/render'
import type { UsageRangeSelection } from '@/lib/usageRange'

const CUSTOM_FROM = new Date('2026-01-02T03:04').getTime()
const CUSTOM_TO = new Date('2026-01-03T04:05').getTime()

function renderPicker(value: UsageRangeSelection, onChange: (selection: UsageRangeSelection) => void) {
  return {
    ...renderWithProviders(<UsageRangePicker value={value} onChange={onChange} />, {
      auth: false,
      theme: false,
      tts: false,
    }),
    onChange,
  }
}

describe('UsageRangePicker', () => {
  beforeAll(() => {
    installPointerCapture()
  })

  it('renders the label for the current preset', () => {
    renderPicker({ preset: '4h' }, vi.fn())

    expect(screen.getByRole('combobox', { name: 'Range' })).toHaveTextContent('Last 4 hours')
  })

  it('calls onChange with only the preset when another preset is selected', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderPicker({ preset: '4h' }, onChange)

    await user.click(screen.getByRole('combobox', { name: 'Range' }))
    await user.click(screen.getByRole('option', { name: 'Last 7 days' }))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith({ preset: '7d' })
  })

  it('renders the From and To inputs for a custom selection', () => {
    renderPicker({ preset: 'custom', from: null, to: null }, vi.fn())

    expect(screen.getByText('From')).toBeInTheDocument()
    expect(screen.getByText('To')).toBeInTheDocument()
    expect(screen.getByLabelText('From')).toHaveAttribute('type', 'datetime-local')
    expect(screen.getByLabelText('To')).toHaveAttribute('type', 'datetime-local')
  })

  it('parses a changed From value into epoch milliseconds and preserves To', () => {
    const onChange = vi.fn()
    renderPicker({ preset: 'custom', from: null, to: CUSTOM_TO }, onChange)

    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-01-02T03:04' } })

    expect(onChange).toHaveBeenCalledWith({
      preset: 'custom',
      from: new Date('2026-01-02T03:04').getTime(),
      to: CUSTOM_TO,
    })
  })

  it('calls onChange with a null To when the To input is cleared', () => {
    const onChange = vi.fn()
    renderPicker({ preset: 'custom', from: CUSTOM_FROM, to: CUSTOM_TO }, onChange)

    fireEvent.change(screen.getByLabelText('To'), { target: { value: '' } })

    expect(onChange).toHaveBeenCalledWith({ preset: 'custom', from: CUSTOM_FROM, to: null })
  })

  it('renders existing custom values as local datetime input values', () => {
    renderPicker({ preset: 'custom', from: CUSTOM_FROM, to: CUSTOM_TO }, vi.fn())

    expect(screen.getByLabelText('From')).toHaveValue('2026-01-02T03:04')
    expect(screen.getByLabelText('To')).toHaveValue('2026-01-03T04:05')
  })

  it('does not call onChange when a custom selection re-renders', () => {
    const onChange = vi.fn()
    const { rerender } = renderPicker({ preset: 'custom', from: CUSTOM_FROM, to: CUSTOM_TO }, onChange)

    rerender(<UsageRangePicker value={{ preset: 'custom', from: CUSTOM_FROM, to: CUSTOM_TO }} onChange={onChange} />)

    expect(onChange).not.toHaveBeenCalled()
  })
})
