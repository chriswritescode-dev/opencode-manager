import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { stubMatchMedia } from '@/test/test-utils'
import { SideDrawer, SideDrawerHeader, SideDrawerContent } from './side-drawer'

function renderDrawer(isOpen: boolean) {
  return render(
    <>
      <textarea data-prompt-input aria-label="prompt" />
      <SideDrawer isOpen={isOpen} onClose={() => {}} ariaLabel="Test drawer">
        <button type="button">inside</button>
      </SideDrawer>
    </>,
  )
}

afterEach(() => {
  Reflect.deleteProperty(window, 'matchMedia')
})

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

  it('ignores an Escape key already handled by a nested layer', () => {
    const handleClose = vi.fn()
    render(
      <SideDrawer isOpen onClose={handleClose} ariaLabel="Test drawer">
        <div>Test content</div>
      </SideDrawer>,
    )
    const handled = (event: KeyboardEvent) => event.preventDefault()
    document.addEventListener('keydown', handled, { capture: true })
    fireEvent.keyDown(document, { key: 'Escape' })
    document.removeEventListener('keydown', handled, { capture: true })
    expect(handleClose).not.toHaveBeenCalled()
  })

  it('closes only the topmost drawer on Escape when drawers are stacked', () => {
    const closeOuter = vi.fn()
    const closeInner = vi.fn()
    render(
      <>
        <SideDrawer isOpen onClose={closeOuter} ariaLabel="Outer">
          <div>Outer</div>
        </SideDrawer>
        <SideDrawer isOpen onClose={closeInner} ariaLabel="Inner">
          <div>Inner</div>
        </SideDrawer>
      </>,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(closeInner).toHaveBeenCalledTimes(1)
    expect(closeOuter).not.toHaveBeenCalled()
  })

  it('moves focus to the chat prompt on desktop when it closes', () => {
    stubMatchMedia(true)
    const { rerender } = renderDrawer(false)

    rerender(
      <>
        <textarea data-prompt-input aria-label="prompt" />
        <SideDrawer isOpen onClose={() => {}} ariaLabel="Test drawer">
          <button type="button">inside</button>
        </SideDrawer>
      </>,
    )
    screen.getByRole('button', { name: 'inside' }).focus()

    rerender(
      <>
        <textarea data-prompt-input aria-label="prompt" />
        <SideDrawer isOpen={false} onClose={() => {}} ariaLabel="Test drawer">
          <button type="button">inside</button>
        </SideDrawer>
      </>,
    )

    expect(screen.getByLabelText('prompt')).toHaveFocus()
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
})
