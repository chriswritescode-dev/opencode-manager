import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RestartServerDialog } from './RestartServerDialog'

const baseProps = {
  open: true,
  onOpenChange: vi.fn(),
  onConfirm: vi.fn(),
  onCancel: vi.fn(),
}

describe('RestartServerDialog', () => {
  it('renders the title and description when open is true', () => {
    render(<RestartServerDialog {...baseProps} />)

    expect(screen.getByText('Restart OpenCode Server?')).toBeInTheDocument()
    expect(
      screen.getByText(/Restart the OpenCode server after your changes are saved to apply them to the running server\./)
    ).toBeInTheDocument()
  })

  it('renders nothing visible when open is false', () => {
    render(<RestartServerDialog {...baseProps} open={false} />)

    expect(screen.queryByText('Restart OpenCode Server?')).not.toBeInTheDocument()
  })

  it('calls onConfirm when Restart now is clicked', async () => {
    const onConfirm = vi.fn()
    const user = userEvent.setup()
    render(<RestartServerDialog {...baseProps} onConfirm={onConfirm} />)

    await user.click(screen.getByRole('button', { name: /restart now/i }))
    expect(onConfirm).toHaveBeenCalled()
  })

  it('calls onCancel when Later is clicked', async () => {
    const onCancel = vi.fn()
    const user = userEvent.setup()
    render(<RestartServerDialog {...baseProps} onCancel={onCancel} />)

    await user.click(screen.getByRole('button', { name: /later/i }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('disables confirm button and shows Restarting... when isRestarting is true', () => {
    render(<RestartServerDialog {...baseProps} isRestarting={true} />)

    const confirmButton = screen.getByRole('button', { name: /restarting/i })
    expect(confirmButton).toBeDisabled()
    expect(screen.getByText('Restarting...')).toBeInTheDocument()
  })

  it('disables Later button when isRestarting is true', () => {
    render(<RestartServerDialog {...baseProps} isRestarting={true} />)

    const laterButton = screen.getByRole('button', { name: /later/i })
    expect(laterButton).toBeDisabled()
  })

  it('renders the active-session warning when activeSessionCount > 0', () => {
    render(<RestartServerDialog {...baseProps} activeSessionCount={2} />)

    expect(screen.getByText(/2 sessions/)).toBeInTheDocument()
    expect(screen.getByText(/continue/)).toBeInTheDocument()
  })

  it('does not render the active-session warning when activeSessionCount is omitted', () => {
    render(<RestartServerDialog {...baseProps} />)

    expect(
      screen.getByText(/Restart the OpenCode server after your changes are saved to apply them to the running server\./)
    ).toBeInTheDocument()
    expect(screen.queryByText(/sessions? currently working/)).not.toBeInTheDocument()
  })
})
