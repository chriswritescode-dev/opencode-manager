import { render, screen, act } from '@testing-library/react'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { ReconnectingBanner } from './ReconnectingBanner'

const GRACE_PERIOD_MS = 5000

describe('ReconnectingBanner', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('stays hidden during the initial grace period', () => {
    vi.useFakeTimers()
    render(<ReconnectingBanner connected={false} />)

    act(() => {
      vi.advanceTimersByTime(GRACE_PERIOD_MS - 1)
    })

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('reports a stream that never connects once the grace period elapses', () => {
    vi.useFakeTimers()
    render(<ReconnectingBanner connected={false} />)

    act(() => {
      vi.advanceTimersByTime(GRACE_PERIOD_MS)
    })

    const banner = screen.getByRole('status')
    expect(banner).toHaveTextContent('Not connected — live updates unavailable')
    expect(banner).toHaveAttribute('aria-live', 'polite')
  })

  it('hides the not-connected banner as soon as the stream connects', () => {
    vi.useFakeTimers()
    const { rerender } = render(<ReconnectingBanner connected={false} />)

    act(() => {
      vi.advanceTimersByTime(GRACE_PERIOD_MS)
    })
    expect(screen.getByRole('status')).toBeInTheDocument()

    rerender(<ReconnectingBanner connected />)

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('stays hidden while the stream is connected', () => {
    vi.useFakeTimers()
    render(<ReconnectingBanner connected />)

    act(() => {
      vi.advanceTimersByTime(GRACE_PERIOD_MS * 2)
    })

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('reports a dropped stream once it connected', () => {
    vi.useFakeTimers()
    const { rerender } = render(<ReconnectingBanner connected />)

    rerender(<ReconnectingBanner connected={false} />)

    const banner = screen.getByRole('status')
    expect(banner).toHaveTextContent('Reconnecting… live updates paused')
    expect(banner).toHaveAttribute('aria-live', 'polite')
  })

  it('keeps the reconnect message when the drop outlasts the grace period', () => {
    vi.useFakeTimers()
    const { rerender } = render(<ReconnectingBanner connected />)

    rerender(<ReconnectingBanner connected={false} />)
    act(() => {
      vi.advanceTimersByTime(GRACE_PERIOD_MS * 2)
    })

    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting… live updates paused')
  })

  it('hides again when the stream reconnects', () => {
    vi.useFakeTimers()
    const { rerender } = render(<ReconnectingBanner connected />)

    rerender(<ReconnectingBanner connected={false} />)
    rerender(<ReconnectingBanner connected />)

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('clears the grace timer on unmount', () => {
    vi.useFakeTimers()
    const { unmount } = render(<ReconnectingBanner connected={false} />)

    unmount()

    expect(vi.getTimerCount()).toBe(0)
  })
})
