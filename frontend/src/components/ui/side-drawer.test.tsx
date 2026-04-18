import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { SideDrawer, SideDrawerHeader, SideDrawerContent } from './side-drawer'

describe('SideDrawer', () => {
  it('renders when isOpen is true', () => {
    render(
      <SideDrawer isOpen onClose={() => {}} ariaLabel="Test drawer">
        <div>Test content</div>
      </SideDrawer>,
    )
    expect(screen.getByText('Test content')).toBeInTheDocument()
  })

  it('does not render when isOpen is false', async () => {
    const { container } = render(
      <SideDrawer isOpen={false} onClose={() => {}} ariaLabel="Test drawer">
        <div>Test content</div>
      </SideDrawer>,
    )
    await waitFor(() => {
      expect(container.querySelector('[role="dialog"]')).not.toBeInTheDocument()
    })
  })

  it('calls onClose when backdrop is clicked', () => {
    const handleClose = vi.fn()
    render(
      <SideDrawer isOpen onClose={handleClose} ariaLabel="Test drawer">
        <div>Test content</div>
      </SideDrawer>,
    )
    const backdrop = document.querySelector('.bg-black\\/40')
    if (backdrop) {
      fireEvent.click(backdrop)
    }
    expect(handleClose).toHaveBeenCalled()
  })

  it('calls onClose when Escape key is pressed', () => {
    const handleClose = vi.fn()
    render(
      <SideDrawer isOpen onClose={handleClose} ariaLabel="Test drawer">
        <div>Test content</div>
      </SideDrawer>,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(handleClose).toHaveBeenCalled()
  })

  it('applies pt-safe and pb-safe classes', () => {
    render(
      <SideDrawer isOpen onClose={() => {}} ariaLabel="Test drawer">
        <div>Test content</div>
      </SideDrawer>,
    )
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog).toHaveClass('pt-safe')
    expect(dialog).toHaveClass('pb-safe')
  })

  it('defaults to right side', () => {
    render(
      <SideDrawer isOpen onClose={() => {}} ariaLabel="Test drawer">
        <div>Test content</div>
      </SideDrawer>,
    )
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog).toHaveClass('right-0')
  })

  it('applies left side when specified', () => {
    render(
      <SideDrawer isOpen onClose={() => {}} side="left" ariaLabel="Test drawer">
        <div>Test content</div>
      </SideDrawer>,
    )
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog).toHaveClass('left-0')
  })

  it('applies custom widthClass', () => {
    render(
      <SideDrawer isOpen onClose={() => {}} widthClass="w-80" ariaLabel="Test drawer">
        <div>Test content</div>
      </SideDrawer>,
    )
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog).toHaveClass('w-80')
  })
})

describe('SideDrawerHeader', () => {
  it('renders with title and close button', () => {
    const handleClose = vi.fn()
    render(
      <SideDrawerHeader title="Test Title" onClose={handleClose} />,
    )
    expect(screen.getByText('Test Title')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument()
  })

  it('calls onClose when close button is clicked', () => {
    const handleClose = vi.fn()
    render(
      <SideDrawerHeader title="Test Title" onClose={handleClose} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(handleClose).toHaveBeenCalled()
  })
})

describe('SideDrawerContent', () => {
  it('renders children with default padding', () => {
    render(
      <SideDrawerContent>
        <div>Content</div>
      </SideDrawerContent>,
    )
    expect(screen.getByText('Content')).toBeInTheDocument()
  })

  it('applies custom className', () => {
    render(
      <SideDrawerContent className="custom-class">
        <div>Content</div>
      </SideDrawerContent>,
    )
    const content = screen.getByText('Content').parentElement
    expect(content).toHaveClass('custom-class')
  })
})
