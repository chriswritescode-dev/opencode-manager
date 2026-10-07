import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Combobox, type ComboboxOption } from './combobox'

const options = [
  { value: 'builtin', label: 'Built-in Browser' },
  { value: 'external', label: 'External API' },
]

function renderCombobox(onOpen = vi.fn()) {
  render(
    <div>
      <Combobox value="builtin" onChange={vi.fn()} options={options} allowCustomValue={false} ariaLabel="Provider" onOpen={onOpen} />
      <button type="button">Outside</button>
    </div>,
  )
  return screen.getByRole('combobox', { name: 'Provider' })
}

describe('Combobox', () => {
  it('restores the selected label, not the raw value, on Escape', async () => {
    const user = userEvent.setup()
    const input = renderCombobox()

    await user.clear(input)
    await user.type(input, 'Ext')
    await user.keyboard('{Escape}')

    expect(input).toHaveValue('Built-in Browser')
  })

  it('restores the selected label, not the raw value, on an outside click', async () => {
    const user = userEvent.setup()
    const input = renderCombobox()

    await user.clear(input)
    await user.type(input, 'Ext')
    await user.click(screen.getByRole('button', { name: 'Outside' }))

    expect(input).toHaveValue('Built-in Browser')
  })

  it('filters options as the user types', async () => {
    const user = userEvent.setup()
    const input = renderCombobox()

    await user.clear(input)
    await user.type(input, 'ext')

    expect(screen.getByRole('option', { name: 'External API' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Built-in Browser' })).not.toBeInTheDocument()
  })

  it('calls onOpen each time the options open', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    const input = renderCombobox(onOpen)

    await user.click(input)
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Outside' }))
    await user.click(input)

    expect(onOpen).toHaveBeenCalledTimes(2)
  })

  it('merges listClassName into the listbox and drops the default height', async () => {
    const user = userEvent.setup()
    render(
      <Combobox
        value="builtin"
        onChange={vi.fn()}
        options={options}
        allowCustomValue={false}
        ariaLabel="Provider"
        listClassName="max-h-96"
      />,
    )

    await user.click(screen.getByRole('combobox', { name: 'Provider' }))

    const listbox = screen.getByRole('listbox')
    expect(listbox).toHaveClass('max-h-96')
    expect(listbox).not.toHaveClass('max-h-60')
  })

  const modelOptions = [{ value: 'openai/gpt-5', label: 'GPT-5' }]

  function renderCustomCombobox(onChange = vi.fn()) {
    render(
      <div>
        <Combobox
          value="openai/gpt-5"
          onChange={onChange}
          options={modelOptions}
          allowCustomValue
          ariaLabel="Model"
        />
        <button type="button">Outside</button>
      </div>,
    )
    return { input: screen.getByRole('combobox', { name: 'Model' }), onChange }
  }

  it('does not commit the display label on an outside click without typing', async () => {
    const user = userEvent.setup()
    const { input, onChange } = renderCustomCombobox()

    await user.click(input)
    await user.click(screen.getByRole('button', { name: 'Outside' }))

    expect(onChange).not.toHaveBeenCalled()
    expect(input).toHaveValue('GPT-5')
  })

  it('does not commit the display label on Tab without typing', async () => {
    const user = userEvent.setup()
    const { input, onChange } = renderCustomCombobox()

    await user.click(input)
    await user.keyboard('{Tab}')

    expect(onChange).not.toHaveBeenCalled()
    expect(input).toHaveValue('GPT-5')
  })

  it('commits a typed custom value on an outside click', async () => {
    const user = userEvent.setup()
    const { input, onChange } = renderCustomCombobox()

    await user.click(input)
    await user.clear(input)
    await user.type(input, 'custom/x')
    await user.click(screen.getByRole('button', { name: 'Outside' }))

    expect(onChange).toHaveBeenLastCalledWith('custom/x')
  })

  it('commits a typed custom value on Tab', async () => {
    const user = userEvent.setup()
    const { input, onChange } = renderCustomCombobox()

    await user.click(input)
    await user.clear(input)
    await user.type(input, 'custom/x')
    await user.keyboard('{Tab}')

    expect(onChange).toHaveBeenLastCalledWith('custom/x')
  })

  it('routes filtering through filterOptions when provided', async () => {
    const user = userEvent.setup()
    const filterOptions = vi.fn((list: ComboboxOption[], query: string) =>
      list.filter((option) => option.label.toLowerCase().startsWith(query.toLowerCase())),
    )

    render(
      <Combobox
        value=""
        onChange={vi.fn()}
        options={options}
        allowCustomValue={false}
        ariaLabel="Provider"
        filterOptions={filterOptions}
      />,
    )

    const input = screen.getByRole('combobox', { name: 'Provider' })
    await user.click(input)
    await user.type(input, 'ext')

    expect(filterOptions).toHaveBeenCalled()
    expect(screen.getByRole('option', { name: 'External API' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Built-in Browser' })).not.toBeInTheDocument()
  })

  it('shows every option when the value matches a provided option without typing', async () => {
    const user = userEvent.setup()
    const filterOptions = vi.fn((list: ComboboxOption[]) => list.slice(0, 1))

    render(
      <Combobox
        value="builtin"
        onChange={vi.fn()}
        options={options}
        allowCustomValue={false}
        ariaLabel="Provider"
        filterOptions={filterOptions}
      />,
    )

    await user.click(screen.getByRole('combobox', { name: 'Provider' }))

    expect(filterOptions).not.toHaveBeenCalled()
    expect(screen.getByRole('option', { name: 'Built-in Browser' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'External API' })).toBeInTheDocument()
  })
})
