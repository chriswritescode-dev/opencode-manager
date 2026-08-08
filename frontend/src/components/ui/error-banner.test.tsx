import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ErrorBanner } from './error-banner'

describe('ErrorBanner', () => {
  it('renders summary text', () => {
    render(<ErrorBanner summary="Something went wrong" />)
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
  })

  it('renders title when provided', () => {
    render(<ErrorBanner title="Error" summary="Something went wrong" />)
    expect(screen.getByText('Error')).toBeInTheDocument()
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
  })

  it('renders detail when provided', () => {
    render(
      <ErrorBanner
        summary="Something went wrong"
        detail="Stack trace here"
      />,
    )
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByText('Stack trace here')).toBeInTheDocument()
  })

  it('does not render dismiss button when onDismiss is not provided', () => {
    render(<ErrorBanner summary="Something went wrong" />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('renders dismiss button when onDismiss is provided', () => {
    const onDismiss = vi.fn()
    render(
      <ErrorBanner summary="Something went wrong" onDismiss={onDismiss} />,
    )
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('calls onDismiss when dismiss button is clicked', () => {
    const onDismiss = vi.fn()
    render(
      <ErrorBanner summary="Something went wrong" onDismiss={onDismiss} />,
    )
    fireEvent.click(screen.getByRole('button'))
    expect(onDismiss).toHaveBeenCalled()
  })

  it('applies custom className', () => {
    const { container } = render(
      <ErrorBanner summary="Something went wrong" className="custom-class" />,
    )
    expect(container.firstChild).toHaveClass('custom-class')
  })
})