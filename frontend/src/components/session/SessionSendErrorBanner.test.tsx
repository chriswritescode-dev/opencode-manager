import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { SessionSendErrorBanner } from './SessionSendErrorBanner'
import { useSendErrorStore } from '@/stores/sendErrorStore'

vi.mock('@/lib/toast', () => ({
  showToast: { error: vi.fn() },
}))

const defaultProps = {
  sessionId: 'test-session',
  isConnected: true,
  isReconnecting: false,
}

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

    render(<SessionSendErrorBanner {...defaultProps} />)
    expect(screen.getByText('Error')).toBeInTheDocument()
    expect(screen.getByText('Something failed')).toBeInTheDocument()
    expect(screen.getByText('Stack trace here')).toBeInTheDocument()
  })

  it('does not render banner when no error exists', () => {
    render(<SessionSendErrorBanner {...defaultProps} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('does not render banner when sessionId is undefined', () => {
    useSendErrorStore.getState().setError({
      sessionID: 'test-session',
      title: 'Error',
      message: 'Something failed',
    })

    render(<SessionSendErrorBanner sessionId={undefined} isConnected={true} isReconnecting={false} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('clears error on dismiss', () => {
    useSendErrorStore.getState().setError({
      sessionID: 'test-session',
      title: 'Error',
      message: 'Something failed',
    })

    render(<SessionSendErrorBanner {...defaultProps} />)
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

    render(<SessionSendErrorBanner {...defaultProps} />)
    expect(showToast.error).not.toHaveBeenCalled()
  })

  it('does not render a network-kind error while disconnected', () => {
    useSendErrorStore.getState().setError({
      sessionID: 'test-session',
      title: 'Connection Failed',
      message: 'Could not connect.',
      kind: 'network',
    })

    render(<SessionSendErrorBanner sessionId="test-session" isConnected={false} isReconnecting={false} />)
    expect(screen.queryByText('Connection Failed')).not.toBeInTheDocument()
  })

  it('does not render a network-kind error while reconnecting', () => {
    useSendErrorStore.getState().setError({
      sessionID: 'test-session',
      title: 'Connection Failed',
      message: 'Could not connect.',
      kind: 'network',
    })

    render(<SessionSendErrorBanner sessionId="test-session" isConnected={true} isReconnecting={true} />)
    expect(screen.queryByText('Connection Failed')).not.toBeInTheDocument()
  })

  it('renders a network-kind error when connected and stable', () => {
    useSendErrorStore.getState().setError({
      sessionID: 'test-session',
      title: 'Connection Failed',
      message: 'Could not connect.',
      kind: 'network',
    })

    render(<SessionSendErrorBanner sessionId="test-session" isConnected={true} isReconnecting={false} />)
    expect(screen.getByText('Connection Failed')).toBeInTheDocument()
  })

  it('renders a session-kind error even while disconnected', () => {
    useSendErrorStore.getState().setQueuedPrompt('test-session', 'queued message')
    useSendErrorStore.getState().failQueuedPrompt({
      sessionID: 'test-session',
      title: 'Session error',
      message: 'Server reported failure',
    })

    render(<SessionSendErrorBanner sessionId="test-session" isConnected={false} isReconnecting={false} />)
    expect(screen.getByText('Session error')).toBeInTheDocument()
  })

  it('renders a previously hidden network error after reconnecting', () => {
    useSendErrorStore.getState().setError({
      sessionID: 'test-session',
      title: 'Connection Failed',
      message: 'Could not connect.',
      kind: 'network',
    })

    const { rerender } = render(
      <SessionSendErrorBanner sessionId="test-session" isConnected={false} isReconnecting={false} />,
    )
    expect(screen.queryByText('Connection Failed')).not.toBeInTheDocument()

    rerender(
      <SessionSendErrorBanner sessionId="test-session" isConnected={true} isReconnecting={false} />,
    )
    expect(screen.getByText('Connection Failed')).toBeInTheDocument()
  })
})
