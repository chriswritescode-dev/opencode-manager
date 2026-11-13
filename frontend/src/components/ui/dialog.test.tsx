import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installMatchMedia } from '@/test/browserFakes'
import { Combobox } from './combobox'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './dialog'

function withMobileViewport(fn: () => void) {
  const originalWidth = window.innerWidth
  Object.defineProperty(window, 'innerWidth', {
    writable: true,
    configurable: true,
    value: 375,
  })
  fn()
  Object.defineProperty(window, 'innerWidth', {
    writable: true,
    configurable: true,
    value: originalWidth,
  })
}

interface TouchPoint {
  clientX: number
  clientY: number
}

function swipeHorizontally(element: Element, fromX: number, toX: number, clientY = 100) {
  const start: TouchPoint = { clientX: fromX, clientY }
  const end: TouchPoint = { clientX: toX, clientY }
  fireEvent.touchStart(element, { touches: [start], changedTouches: [start] })
  fireEvent.touchMove(element, { touches: [end], changedTouches: [end] })
  fireEvent.touchEnd(element, { touches: [], changedTouches: [end] })
}

function dragHorizontally(element: Element, fromX: number, toX: number, clientY = 100) {
  const start: TouchPoint = { clientX: fromX, clientY }
  const end: TouchPoint = { clientX: toX, clientY }
  fireEvent.touchStart(element, { touches: [start], changedTouches: [start] })
  fireEvent.touchMove(element, { touches: [end], changedTouches: [end] })
}

function swipeCloseTrigger(): HTMLButtonElement {
  const trigger = document.querySelector('[data-swipe-close-trigger]')
  if (!(trigger instanceof HTMLButtonElement)) throw new Error('Missing swipe close trigger')
  return trigger
}

describe('DialogContent', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 375,
    })
  })

  it('closes an open combobox on Escape before closing the dialog', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogTitle>Test Dialog</DialogTitle>
          <Combobox value="" onChange={vi.fn()} options={[{ value: 'a', label: 'Alpha' }]} ariaLabel="Choice" />
        </DialogContent>
      </Dialog>,
    )
    const combobox = screen.getByRole('combobox', { name: 'Choice' })

    await user.click(combobox)
    expect(combobox).toHaveAttribute('aria-expanded', 'true')
    await user.keyboard('{Escape}')
    expect(combobox).toHaveAttribute('aria-expanded', 'false')
    expect(onOpenChange).not.toHaveBeenCalled()

    await user.keyboard('{Escape}')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it.each([
    { label: 'fullscreen', props: { fullscreen: true } },
    { label: 'mobileFullscreen', props: { mobileFullscreen: true } },
  ])(
    'applies safe-area padding and inset-0 when $label is set',
    ({ props }) => {
      render(
        <Dialog open>
          <DialogContent {...props} data-testid="dialog-content">
            <DialogHeader>
              <DialogTitle>Test Dialog</DialogTitle>
            </DialogHeader>
          </DialogContent>
        </Dialog>,
      )
      const content = screen.getByTestId('dialog-content')
      expect(content).toHaveStyle({ paddingTop: 'env(safe-area-inset-top, 0px)' })
      expect(content).toHaveClass('inset-0')
    },
  )

  it('does not apply safe-area padding or inset-0 when neither fullscreen prop is set', () => {
    render(
      <Dialog open>
        <DialogContent data-testid="dialog-content">
          <DialogTitle>Test Dialog</DialogTitle>
        </DialogContent>
      </Dialog>,
    )
    const content = screen.getByTestId('dialog-content')
    const style = content.getAttribute('style') || ''
    expect(style).not.toContain('safe-area')
    expect(content).not.toHaveClass('inset-0')
  })

  it('hides close button when fullscreen is true', () => {
    render(
      <Dialog open>
        <DialogContent fullscreen data-testid="dialog-content">
          <DialogTitle>Test Dialog</DialogTitle>
        </DialogContent>
      </Dialog>,
    )
    expect(screen.queryByRole('button', { name: /close/i })).not.toBeInTheDocument()
  })

  it('shows close button when mobileFullscreen is true', () => {
    render(
      <Dialog open>
        <DialogContent mobileFullscreen data-testid="dialog-content">
          <DialogTitle>Test Dialog</DialogTitle>
        </DialogContent>
      </Dialog>,
    )
    expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument()
  })

  it('hides close button when hideCloseButton is true', () => {
    render(
      <Dialog open>
        <DialogContent hideCloseButton data-testid="dialog-content">
          <DialogTitle>Test Dialog</DialogTitle>
        </DialogContent>
      </Dialog>,
    )
    expect(screen.queryByRole('button', { name: /close/i })).not.toBeInTheDocument()
  })

  it('extends the close button hit area without enlarging the icon', () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Close Target Dialog</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>,
    )

    const closeButton = screen.getByRole('button', { name: 'Close' })
    const icon = closeButton.querySelector('svg')

    expect(closeButton).toHaveClass('after:-inset-2', 'pointer-coarse:after:-inset-3.5')
    expect(icon).toHaveClass('h-4', 'w-4')
  })

  it('renders a labelled hidden close trigger on mobile by default and closes the dialog through it', () => {
    withMobileViewport(() => {
      const onOpenChange = vi.fn()
      render(
        <Dialog open onOpenChange={onOpenChange}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Swipe Dialog</DialogTitle>
            </DialogHeader>
          </DialogContent>
        </Dialog>,
      )

      const closeTrigger = swipeCloseTrigger()
      expect(closeTrigger).toHaveAccessibleName('Dismiss dialog')

      closeTrigger.click()
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })
  })

  it('does not render the hidden close trigger when mobileSwipeToClose is false', () => {
    withMobileViewport(() => {
      render(
        <Dialog open>
          <DialogContent mobileSwipeToClose={false}>
            <DialogHeader>
              <DialogTitle>Swipe Dialog</DialogTitle>
            </DialogHeader>
          </DialogContent>
        </Dialog>,
      )
      expect(document.querySelector('[data-swipe-close-trigger]')).not.toBeInTheDocument()
    })
  })

  it('calls onSwipeBack when canSwipeBack is true and the swipe completes', () => {
    withMobileViewport(() => {
      const mockOnSwipeBack = vi.fn()
      const onOpenChange = vi.fn()
      render(
        <Dialog open onOpenChange={onOpenChange}>
          <DialogContent
            canSwipeBack={() => true}
            onSwipeBack={mockOnSwipeBack}
            data-testid="swipe-dialog"
          >
            <DialogTitle>Swipe Dialog</DialogTitle>
          </DialogContent>
        </Dialog>,
      )

      swipeHorizontally(screen.getByTestId('swipe-dialog'), 10, 100)

      expect(mockOnSwipeBack).toHaveBeenCalled()
      expect(onOpenChange).not.toHaveBeenCalled()
    })
  })

  it('attempts close when canSwipeBack is false and the swipe completes', () => {
    withMobileViewport(() => {
      const mockOnSwipeBack = vi.fn()
      const onOpenChange = vi.fn()
      render(
        <Dialog open onOpenChange={onOpenChange}>
          <DialogContent
            canSwipeBack={() => false}
            onSwipeBack={mockOnSwipeBack}
            data-testid="swipe-dialog"
          >
            <DialogTitle>Swipe Dialog</DialogTitle>
          </DialogContent>
        </Dialog>,
      )

      swipeHorizontally(screen.getByTestId('swipe-dialog'), 10, 100)

      expect(mockOnSwipeBack).not.toHaveBeenCalled()
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })
  })

  it('applies the swipe transform to fullscreen dialogs during touchmove', () => {
    withMobileViewport(() => {
      render(
        <Dialog open>
          <DialogContent fullscreen data-testid="dialog-content">
            <DialogTitle>Test Dialog</DialogTitle>
          </DialogContent>
        </Dialog>,
      )
      const content = screen.getByTestId('dialog-content')
      dragHorizontally(content, 10, 50)

      expect(content.getAttribute('style') || '').toMatch(/transform/)
    })
  })

  it('does not apply a swipe transform to non-fullscreen dialogs during touchmove', () => {
    withMobileViewport(() => {
      render(
        <Dialog open>
          <DialogContent data-testid="dialog-content">
            <DialogTitle>Test Dialog</DialogTitle>
          </DialogContent>
        </Dialog>,
      )
      const content = screen.getByTestId('dialog-content')
      dragHorizontally(content, 10, 50)

      expect(content.getAttribute('style') || '').not.toMatch(/transform/)
    })
  })
})

describe('DialogHeader', () => {
  it('can shrink so a long title truncates instead of widening the dialog', () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogHeader data-testid="dialog-header">
            <DialogTitle className="truncate">a very long command that would otherwise widen the dialog</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>,
    )
    expect(screen.getByTestId('dialog-header')).toHaveClass('min-w-0')
  })
})

function ReturnFocusHost({ onCloseAutoFocus }: { onCloseAutoFocus?: (event: Event) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <textarea aria-label="prompt" />
      <button type="button" onClick={() => setOpen(true)}>open</button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent onCloseAutoFocus={onCloseAutoFocus}>
          <DialogTitle>Focus Dialog</DialogTitle>
          <input aria-label="dialog input" autoFocus />
        </DialogContent>
      </Dialog>
    </>
  )
}

function PromptReturnFocusHost() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <textarea data-prompt-input aria-label="chat prompt" />
      <button type="button" onClick={() => setOpen(true)}>open prompt dialog</button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>Prompt Focus Dialog</DialogTitle>
          <input aria-label="prompt dialog input" autoFocus />
        </DialogContent>
      </Dialog>
    </>
  )
}

async function openAndEscape(returnTarget: HTMLElement) {
  returnTarget.focus()
  fireEvent.click(screen.getByText('open'))
  const input = await screen.findByLabelText('dialog input')
  await waitFor(() => expect(input).toHaveFocus())
  fireEvent.keyDown(input, { key: 'Escape' })
  await waitFor(() => expect(screen.queryByLabelText('dialog input')).not.toBeInTheDocument())
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)))
}

describe('Dialog return focus', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'matchMedia')
  })

  it('returns focus to the element focused before opening when there is no trigger', async () => {
    installMatchMedia(true)
    render(<ReturnFocusHost />)
    const prompt = screen.getByLabelText('prompt')

    await openAndEscape(prompt)

    expect(prompt).toHaveFocus()
  })

  it('does not refocus a text field on touch devices, so the keyboard stays closed', async () => {
    installMatchMedia(false)
    render(<ReturnFocusHost />)
    const prompt = screen.getByLabelText('prompt')

    await openAndEscape(prompt)

    expect(prompt).not.toHaveFocus()
  })

  it('refocuses a non-text element on touch devices', async () => {
    installMatchMedia(false)
    render(<ReturnFocusHost />)
    const opener = screen.getByText('open')

    await openAndEscape(opener)

    expect(opener).toHaveFocus()
  })

  it('lets a caller onCloseAutoFocus that prevents default take over', async () => {
    installMatchMedia(true)
    render(<ReturnFocusHost onCloseAutoFocus={(event) => event.preventDefault()} />)
    const prompt = screen.getByLabelText('prompt')

    await openAndEscape(prompt)

    expect(prompt).not.toHaveFocus()
  })

  it('moves focus to the chat prompt when the dialog closes on desktop', async () => {
    installMatchMedia(true)
    render(<PromptReturnFocusHost />)
    const opener = screen.getByText('open prompt dialog')
    opener.focus()

    fireEvent.click(opener)
    const input = await screen.findByLabelText('prompt dialog input')
    await waitFor(() => expect(input).toHaveFocus())
    fireEvent.keyDown(input, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByLabelText('prompt dialog input')).not.toBeInTheDocument())
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)))

    expect(screen.getByLabelText('chat prompt')).toHaveFocus()
  })
})

function stubVisualViewport(height: number) {
  const listeners = new Set<() => void>()
  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    writable: true,
    value: {
      height,
      offsetTop: 0,
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    },
  })
  return listeners
}

describe('keyboardAware', () => {
  const originalInnerHeight = window.innerHeight
  const originalVisualViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport')

  afterEach(() => {
    if (originalVisualViewport) {
      Object.defineProperty(window, 'visualViewport', originalVisualViewport)
    } else {
      Reflect.deleteProperty(window, 'visualViewport')
    }
    Object.defineProperty(window, 'innerHeight', {
      writable: true,
      configurable: true,
      value: originalInnerHeight,
    })
  })

  it('applies keyboard inset as bottom padding when keyboardAware and a text input is focused', () => {
    window.innerHeight = 800
    const listeners = stubVisualViewport(500)
    render(
      <Dialog open>
        <DialogContent keyboardAware mobileFullscreen data-testid="dialog-content">
          <DialogTitle>Keyboard Dialog</DialogTitle>
          <textarea autoFocus data-testid="dialog-input" />
        </DialogContent>
      </Dialog>,
    )
    screen.getByTestId('dialog-input').focus()
    act(() => {
      listeners.forEach((fn) => fn())
    })
    const content = screen.getByTestId('dialog-content')
    expect(content).toHaveStyle({ paddingBottom: '300px' })
  })

  it('does not set inline bottom padding when no keyboard is present', () => {
    window.innerHeight = 800
    const listeners = stubVisualViewport(800)
    render(
      <Dialog open>
        <DialogContent keyboardAware mobileFullscreen data-testid="dialog-content">
          <DialogTitle>Keyboard Dialog</DialogTitle>
          <textarea autoFocus data-testid="dialog-input" />
        </DialogContent>
      </Dialog>,
    )
    screen.getByTestId('dialog-input').focus()
    listeners.forEach((fn) => fn())
    const content = screen.getByTestId('dialog-content')
    expect(content.style.paddingBottom).toBe('')
  })

  it('does not set inline bottom padding when keyboardAware is omitted', () => {
    window.innerHeight = 800
    const listeners = stubVisualViewport(500)
    render(
      <Dialog open>
        <DialogContent mobileFullscreen data-testid="dialog-content">
          <DialogTitle>Keyboard Dialog</DialogTitle>
          <textarea autoFocus data-testid="dialog-input" />
        </DialogContent>
      </Dialog>,
    )
    screen.getByTestId('dialog-input').focus()
    listeners.forEach((fn) => fn())
    const content = screen.getByTestId('dialog-content')
    expect(content.style.paddingBottom).toBe('')
  })
})
