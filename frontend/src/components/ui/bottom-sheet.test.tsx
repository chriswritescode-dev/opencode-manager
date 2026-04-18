import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { BottomSheet, BottomSheetHeader, BottomSheetContent } from './bottom-sheet'

describe('BottomSheet', () => {
  it('renders when isOpen is true', () => {
    render(
      <BottomSheet isOpen onClose={() => {}} ariaLabel="Test sheet">
        <div>Test content</div>
      </BottomSheet>,
    )
    expect(screen.getByText('Test content')).toBeInTheDocument()
  })

  it('does not render when isOpen is false', async () => {
    const { container } = render(
      <BottomSheet isOpen={false} onClose={() => {}} ariaLabel="Test sheet">
        <div>Test content</div>
      </BottomSheet>,
    )
    await waitFor(() => {
      expect(container.querySelector('[role="dialog"]')).not.toBeInTheDocument()
    })
  })

  it('calls onClose when backdrop is clicked', () => {
    const handleClose = vi.fn()
    render(
      <BottomSheet isOpen onClose={handleClose} ariaLabel="Test sheet">
        <div>Test content</div>
      </BottomSheet>,
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
      <BottomSheet isOpen onClose={handleClose} ariaLabel="Test sheet">
        <div>Test content</div>
      </BottomSheet>,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(handleClose).toHaveBeenCalled()
  })

  it('applies pb-safe class', () => {
    render(
      <BottomSheet isOpen onClose={() => {}} ariaLabel="Test sheet">
        <div>Test content</div>
      </BottomSheet>,
    )
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog).toHaveClass('pb-safe')
  })

  it('applies custom heightClass', () => {
    render(
      <BottomSheet isOpen onClose={() => {}} heightClass="h-[50dvh]" ariaLabel="Test sheet">
        <div>Test content</div>
      </BottomSheet>,
    )
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog).toHaveClass('h-[50dvh]')
  })
})

describe('BottomSheetHeader', () => {
  it('renders with title', () => {
    render(
      <BottomSheetHeader title="Test Title">
        <div>Header content</div>
      </BottomSheetHeader>,
    )
    expect(screen.getByText('Test Title')).toBeInTheDocument()
    expect(screen.getByText('Header content')).toBeInTheDocument()
  })

  it('renders without title', () => {
    render(
      <BottomSheetHeader>
        <div>Header content only</div>
      </BottomSheetHeader>,
    )
    expect(screen.getByText('Header content only')).toBeInTheDocument()
  })
})

describe('BottomSheetContent', () => {
  it('renders children with default padding', () => {
    render(
      <BottomSheetContent>
        <div>Content</div>
      </BottomSheetContent>,
    )
    expect(screen.getByText('Content')).toBeInTheDocument()
  })

  it('applies custom className', () => {
    render(
      <BottomSheetContent className="custom-class">
        <div>Content</div>
      </BottomSheetContent>,
    )
    const content = screen.getByText('Content').parentElement
    expect(content).toHaveClass('custom-class')
  })
})
