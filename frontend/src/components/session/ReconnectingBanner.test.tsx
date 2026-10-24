import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { ReconnectingBanner } from './ReconnectingBanner'

describe('ReconnectingBanner', () => {
  it('stays hidden before the stream has connected', () => {
    render(<ReconnectingBanner connected={false} />)

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('stays hidden while the stream is connected', () => {
    render(<ReconnectingBanner connected />)

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('reports a dropped stream once it connected', () => {
    const { rerender } = render(<ReconnectingBanner connected />)

    rerender(<ReconnectingBanner connected={false} />)

    const banner = screen.getByRole('status')
    expect(banner).toHaveTextContent('Reconnecting… live updates paused')
    expect(banner).toHaveAttribute('aria-live', 'polite')
  })

  it('hides again when the stream reconnects', () => {
    const { rerender } = render(<ReconnectingBanner connected />)

    rerender(<ReconnectingBanner connected={false} />)
    rerender(<ReconnectingBanner connected />)

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
