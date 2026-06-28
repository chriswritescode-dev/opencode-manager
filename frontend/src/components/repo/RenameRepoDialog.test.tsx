import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RenameRepoDialog } from './RenameRepoDialog'

describe('RenameRepoDialog', () => {
  const defaultProps = {
    isOpen: true,
    currentName: 'my-custom-name',
    derivedName: 'original-repo-name',
    onClose: vi.fn(),
    onSave: vi.fn(),
  }

  it('renders with the input prefilled from currentName', () => {
    render(<RenameRepoDialog {...defaultProps} />)
    const input = screen.getByRole('textbox')
    expect(input).toHaveValue('my-custom-name')
  })

  it('shows the derived name as placeholder', () => {
    render(<RenameRepoDialog {...defaultProps} />)
    const input = screen.getByRole('textbox')
    expect(input).toHaveAttribute('placeholder', 'original-repo-name')
  })

  it('calls onSave with trimmed value when submitting a new name', async () => {
    const onSave = vi.fn()
    const user = userEvent.setup()
    render(<RenameRepoDialog {...defaultProps} onSave={onSave} />)

    const input = screen.getByRole('textbox')
    await user.clear(input)
    await user.type(input, '  new-name  ')
    await user.keyboard('{Enter}')

    expect(onSave).toHaveBeenCalledWith('new-name')
  })

  it('calls onSave(null) when submitting an empty value', async () => {
    const onSave = vi.fn()
    const user = userEvent.setup()
    render(<RenameRepoDialog {...defaultProps} onSave={onSave} />)

    const input = screen.getByRole('textbox')
    await user.clear(input)
    await user.keyboard('{Enter}')

    expect(onSave).toHaveBeenCalledWith(null)
  })

  it('calls onClose without saving when pressing Escape', async () => {
    const onClose = vi.fn()
    const onSave = vi.fn()
    const user = userEvent.setup()
    render(<RenameRepoDialog {...defaultProps} onClose={onClose} onSave={onSave} />)

    await user.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('calls onClose without saving when clicking Cancel', async () => {
    const onClose = vi.fn()
    const onSave = vi.fn()
    const user = userEvent.setup()
    render(<RenameRepoDialog {...defaultProps} onClose={onClose} onSave={onSave} />)

    await user.click(screen.getByRole('button', { name: /cancel/i }))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('calls onSave(null) when input is cleared via the clear button and submitted', async () => {
    const onSave = vi.fn()
    const user = userEvent.setup()
    render(<RenameRepoDialog {...defaultProps} onSave={onSave} />)

    // Click the clear (X) button to clear the input
    const clearButton = screen.getByRole('button', { name: /clear/i })
    await user.click(clearButton)
    await user.keyboard('{Enter}')

    expect(onSave).toHaveBeenCalledWith(null)
  })
})
