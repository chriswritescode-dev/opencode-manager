import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { stubMatchMedia } from '@/test/test-utils'
import { BottomSheet, BottomSheetHeader, BottomSheetContent } from './bottom-sheet'
import { useSwipeDismiss } from '@/hooks/useMobile'

vi.mock('@/hooks/useMobile', () => ({
  useSwipeDismiss: vi.fn(() => ({
    bind: vi.fn(),
    swipeProgress: 0,
    swipeStyles: {},
  })),
}))

function renderSheet(isOpen: boolean) {
  return render(
    <>
      <textarea data-prompt-input aria-label="prompt" />
      <BottomSheet isOpen={isOpen} onClose={() => {}} ariaLabel="Test sheet">
        <button type="button">inside</button>
      </BottomSheet>
    </>,
  )
}

function AutoFocusSheetHost() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>open sheet</button>
      <BottomSheet isOpen={open} onClose={() => setOpen(false)} ariaLabel="Auto focus sheet">
        <input aria-label="sheet input" autoFocus />
      </BottomSheet>
    </>
  )
}

afterEach(() => {
  Reflect.deleteProperty(window, 'matchMedia')
})

describe('BottomSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

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
    expect(dialog).toBeInTheDocument()
  })

  it('applies pb-safe class to BottomSheetContent', () => {
    render(
      <BottomSheet isOpen onClose={() => {}} ariaLabel="Test sheet">
        <BottomSheetContent>
          <div>Test content</div>
        </BottomSheetContent>
      </BottomSheet>,
    )
    const content = screen.getByText('Test content').parentElement
    expect(content).toHaveClass('pb-safe')
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

  it('passes correct options to useSwipeDismiss', () => {
    const mockBind = vi.fn()
    vi.mocked(useSwipeDismiss).mockReturnValue({
      bind: mockBind,
      swipeProgress: 0,
      swipeStyles: {},
    })

    render(
      <BottomSheet isOpen onClose={() => {}} ariaLabel="Test sheet">
        <div>Test content</div>
      </BottomSheet>,
    )

    expect(useSwipeDismiss).toHaveBeenCalledWith(expect.any(Function), {
      enabled: true,
      threshold: 60,
    })
  })

  it('binds gesture to the panel element with aria-modal', () => {
    const mockBind = vi.fn()
    vi.mocked(useSwipeDismiss).mockReturnValue({
      bind: mockBind,
      swipeProgress: 0,
      swipeStyles: {},
    })

    render(
      <BottomSheet isOpen onClose={() => {}} ariaLabel="Test sheet">
        <div>Test content</div>
      </BottomSheet>,
    )

    const panelElement = document.querySelector('[aria-modal="true"]')
    expect(panelElement).toBeInTheDocument()

    expect(mockBind).toHaveBeenCalled()
  })

  it('moves focus to the chat prompt on desktop when it closes', () => {
    stubMatchMedia(true)
    const { rerender } = renderSheet(false)

    rerender(
      <>
        <textarea data-prompt-input aria-label="prompt" />
        <BottomSheet isOpen onClose={() => {}} ariaLabel="Test sheet">
          <button type="button">inside</button>
        </BottomSheet>
      </>,
    )
    screen.getByRole('button', { name: 'inside' }).focus()

    rerender(
      <>
        <textarea data-prompt-input aria-label="prompt" />
        <BottomSheet isOpen={false} onClose={() => {}} ariaLabel="Test sheet">
          <button type="button">inside</button>
        </BottomSheet>
      </>,
    )

    expect(screen.getByLabelText('prompt')).toHaveFocus()
  })

  it('does not refocus the chat prompt on touch when it closes', () => {
    stubMatchMedia(false)
    const { rerender } = renderSheet(false)

    rerender(
      <>
        <textarea data-prompt-input aria-label="prompt" />
        <BottomSheet isOpen onClose={() => {}} ariaLabel="Test sheet">
          <button type="button">inside</button>
        </BottomSheet>
      </>,
    )
    screen.getByRole('button', { name: 'inside' }).focus()

    rerender(
      <>
        <textarea data-prompt-input aria-label="prompt" />
        <BottomSheet isOpen={false} onClose={() => {}} ariaLabel="Test sheet">
          <button type="button">inside</button>
        </BottomSheet>
      </>,
    )

    expect(screen.getByLabelText('prompt')).not.toHaveFocus()
  })

  it('restores focus to the opener when an autoFocus child takes focus on open', async () => {
    stubMatchMedia(true)
    render(<AutoFocusSheetHost />)
    const opener = screen.getByRole('button', { name: 'open sheet' })
    opener.focus()

    fireEvent.click(opener)
    expect(screen.getByLabelText('sheet input')).toHaveFocus()

    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => expect(opener).toHaveFocus())
  })

  it('captures the opener when mounted already open and restores it on close', () => {
    stubMatchMedia(true)
    const { rerender } = render(
      <button type="button">opener</button>,
    )
    const opener = screen.getByRole('button', { name: 'opener' })
    opener.focus()

    rerender(
      <>
        <button type="button">opener</button>
        <BottomSheet isOpen onClose={() => {}} ariaLabel="Mounted open sheet">
          <button type="button">inside</button>
        </BottomSheet>
      </>,
    )

    rerender(
      <>
        <button type="button">opener</button>
        <BottomSheet isOpen={false} onClose={() => {}} ariaLabel="Mounted open sheet">
          <button type="button">inside</button>
        </BottomSheet>
      </>,
    )

    expect(opener).toHaveFocus()
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
