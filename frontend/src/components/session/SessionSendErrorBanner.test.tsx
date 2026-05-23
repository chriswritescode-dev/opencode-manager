import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { SessionSendErrorBanner } from './SessionSendErrorBanner'
import { useSendErrorStore } from '@/stores/sendErrorStore'

vi.mock('@/lib/toast', () => ({
  showToast: { error: vi.fn() },
}))

describe('SessionSendErrorBanner', () => {
  beforeEach(() => {
    useSendErrorStore.setState({ errors: {} })
  })

  it('renders banner when error exists for session', () => {
    useSendErrorStore.getState().setError({
      sessionID: 'test-session',
      title: 'Error',
      message: 'Something failed',
      detail: 'Stack trace here',
    })

    render(<SessionSendErrorBanner sessionId="test-session" />)
    expect(screen.getByText('Error')).toBeInTheDocument()
    expect(screen.getByText('Something failed')).toBeInTheDocument()
    expect(screen.getByText('Stack trace here')).toBeInTheDocument()
  })

  it('does not render banner when no error exists', () => {
    render(<SessionSendErrorBanner sessionId="test-session" />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('does not render banner when sessionId is undefined', () => {
    useSendErrorStore.getState().setError({
      sessionID: 'test-session',
      title: 'Error',
      message: 'Something failed',
    })

    render(<SessionSendErrorBanner sessionId={undefined} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('clears error on dismiss', () => {
    useSendErrorStore.getState().setError({
      sessionID: 'test-session',
      title: 'Error',
      message: 'Something failed',
    })

    render(<SessionSendErrorBanner sessionId="test-session" />)
    expect(screen.getByText('Something failed')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button'))
    expect(screen.queryByText('Something failed')).not.toBeInTheDocument()
    expect(useSendErrorStore.getState().getError('test-session')).toBeNull()
  })

  it('does not call showToast.error', async () => {
    const { showToast } = await import('@/lib/toast')
    useSendErrorStore.getState().setError({
      sessionID: 'test-session',
      title: 'Error',
      message: 'Something failed',
    })

    render(<SessionSendErrorBanner sessionId="test-session" />)
    expect(showToast.error).not.toHaveBeenCalled()
  })
})
