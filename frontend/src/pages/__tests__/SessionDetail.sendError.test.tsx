import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SessionSendErrorBanner } from '@/components/session/SessionSendErrorBanner'
import { useSendErrorStore } from '@/stores/sendErrorStore'

vi.mock('@/lib/toast', () => ({
  showToast: { error: vi.fn() },
}))

describe('SessionDetail send error integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSendErrorStore.setState({ errors: {} })
  })

  it('shows error banner with title, message, and detail when store is seeded', () => {
    useSendErrorStore.getState().setError({
      sessionID: 'sess-1',
      title: 'Model Unavailable',
      message: 'Selected model is no longer available.',
      detail: '409 Conflict',
    })

    render(<SessionSendErrorBanner sessionId="sess-1" />)

    expect(screen.getByText('Model Unavailable')).toBeInTheDocument()
    expect(screen.getByText('Selected model is no longer available.')).toBeInTheDocument()
    expect(screen.getByText('409 Conflict')).toBeInTheDocument()
  })

  it('dismisses banner and clears store entry on click', () => {
    useSendErrorStore.getState().setError({
      sessionID: 'sess-2',
      title: 'Error',
      message: 'Something failed',
    })

    render(<SessionSendErrorBanner sessionId="sess-2" />)
    expect(screen.getByText('Something failed')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button'))

    expect(screen.queryByText('Something failed')).not.toBeInTheDocument()
    expect(useSendErrorStore.getState().getError('sess-2')).toBeNull()
  })

  it('does not trigger a toast error when banner renders', async () => {
    const { showToast } = await import('@/lib/toast')

    useSendErrorStore.getState().setError({
      sessionID: 'sess-3',
      title: 'Error',
      message: 'No toast please',
    })

    render(<SessionSendErrorBanner sessionId="sess-3" />)
    expect(screen.getByText('No toast please')).toBeInTheDocument()
    expect(showToast.error).not.toHaveBeenCalled()
  })

  it('does not render banner when no error exists for session', () => {
    render(<SessionSendErrorBanner sessionId="sess-empty" />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
