import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from '@testing-library/react'
import { installMatchMedia, installWindowSize } from '@/test/browserFakes'
import { BottomSheet, BottomSheetHeader, BottomSheetContent } from './bottom-sheet'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

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

function OpenSheetHost({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>open sheet</button>
      <BottomSheet isOpen={open} onClose={() => { onClose(); setOpen(false) }} ariaLabel="Test sheet">
        <button type="button">first</button>
        <button type="button">last</button>
      </BottomSheet>
    </>
  )
}

function SheetWithMenu({ onClose }: { onClose: () => void }) {
  return (
    <BottomSheet isOpen onClose={onClose} ariaLabel="Test sheet">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button">row actions</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Delete session</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </BottomSheet>
  )
}

afterEach(() => {
  vi.useRealTimers()
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
    render(
      <BottomSheet isOpen={false} onClose={() => {}} ariaLabel="Test sheet">
        <div>Test content</div>
      </BottomSheet>,
    )
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  it('exposes the sheet as a labelled modal dialog', () => {
    render(
      <BottomSheet isOpen onClose={() => {}} ariaLabel="Test sheet">
        <div>Test content</div>
      </BottomSheet>,
    )

    const dialog = screen.getByRole('dialog', { name: 'Test sheet' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute('data-state', 'open')
  })

  it('moves focus into the sheet panel on open', () => {
    render(
      <BottomSheet isOpen onClose={() => {}} ariaLabel="Test sheet">
        <button type="button">inside</button>
      </BottomSheet>,
    )

    expect(screen.getByRole('dialog', { name: 'Test sheet' })).toHaveFocus()
  })

  it('keeps tab focus inside the sheet', () => {
    render(
      <BottomSheet isOpen onClose={() => {}} ariaLabel="Test sheet">
        <button type="button">first</button>
        <button type="button">last</button>
      </BottomSheet>,
    )

    const first = screen.getByRole('button', { name: 'first' })
    const last = screen.getByRole('button', { name: 'last' })
    last.focus()

    fireEvent.keyDown(last, { key: 'Tab' })

    expect(first).toHaveFocus()
  })

  it('calls onClose when the backdrop is clicked', async () => {
    const handleClose = vi.fn()
    render(
      <BottomSheet isOpen onClose={handleClose} ariaLabel="Test sheet">
        <div>Test content</div>
      </BottomSheet>,
    )
    const backdrop = document.querySelector('.bg-black\\/40')
    if (!backdrop) throw new Error('Missing sheet backdrop')

    await new Promise((resolve) => setTimeout(resolve, 0))
    fireEvent.pointerDown(backdrop)

    await waitFor(() => expect(handleClose).toHaveBeenCalledTimes(1))
  })

  it('calls onClose when Escape key is pressed', () => {
    const handleClose = vi.fn()
    render(
      <BottomSheet isOpen onClose={handleClose} ariaLabel="Test sheet">
        <div>Test content</div>
      </BottomSheet>,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(handleClose).toHaveBeenCalledTimes(1)
  })

  it('closes only the nested menu when Escape is pressed inside it', async () => {
    const user = userEvent.setup()
    const handleClose = vi.fn()
    render(<SheetWithMenu onClose={handleClose} />)

    await user.click(screen.getByRole('button', { name: 'row actions' }))
    expect(await screen.findByRole('menu')).toBeInTheDocument()

    await user.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    expect(handleClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Test sheet' })).toBeInTheDocument()

    await user.keyboard('{Escape}')

    expect(handleClose).toHaveBeenCalledTimes(1)
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
    const dialog = screen.getByRole('dialog', { name: 'Test sheet' })
    expect(dialog).toHaveClass('h-[50dvh]')
  })

  it.each([
    { dismissible: true, closes: 1 },
    { dismissible: false, closes: 0 },
  ])('dismisses on a downward swipe when dismissible is $dismissible', ({ dismissible, closes }) => {
    vi.useFakeTimers()
    installWindowSize(400)
    const handleClose = vi.fn()
    render(
      <BottomSheet isOpen onClose={handleClose} ariaLabel="Test sheet" dismissible={dismissible}>
        <div>Test content</div>
      </BottomSheet>,
    )
    const panel = screen.getByRole('dialog', { name: 'Test sheet' })

    fireEvent.touchStart(panel, { touches: [{ clientX: 10, clientY: 0 }], changedTouches: [{ clientX: 10, clientY: 0 }] })
    fireEvent.touchMove(panel, { touches: [{ clientX: 10, clientY: 120 }], changedTouches: [{ clientX: 10, clientY: 120 }] })
    fireEvent.touchEnd(panel, { touches: [], changedTouches: [{ clientX: 10, clientY: 120 }] })

    act(() => {
      vi.advanceTimersByTime(400)
    })

    expect(handleClose).toHaveBeenCalledTimes(closes)
  })

  it('moves focus to the chat prompt on desktop when it closes', async () => {
    installMatchMedia(true)
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

    await waitFor(() => expect(screen.getByLabelText('prompt')).toHaveFocus())
  })

  it('does not refocus the chat prompt on touch when it closes', async () => {
    installMatchMedia(false)
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

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByLabelText('prompt')).not.toHaveFocus()
  })

  it('restores focus to the opener when an autoFocus child takes focus on open', async () => {
    installMatchMedia(true)
    render(<AutoFocusSheetHost />)
    const opener = screen.getByRole('button', { name: 'open sheet' })
    opener.focus()

    fireEvent.click(opener)
    expect(screen.getByLabelText('sheet input')).toHaveFocus()

    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => expect(opener).toHaveFocus())
  })

  it('captures the opener when mounted already open and restores it on close', async () => {
    installMatchMedia(true)
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

    await waitFor(() => expect(opener).toHaveFocus())
  })

  it('returns focus to the opener after the sheet closes through the keyboard', async () => {
    const user = userEvent.setup()
    const handleClose = vi.fn()
    render(<OpenSheetHost onClose={handleClose} />)

    const opener = screen.getByRole('button', { name: 'open sheet' })
    await user.click(opener)
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Test sheet' })).toHaveFocus())

    await user.keyboard('{Escape}')

    expect(handleClose).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(opener).toHaveFocus())
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
