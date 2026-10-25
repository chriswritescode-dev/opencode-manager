import { useRef, useState, type ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { stubMatchMedia } from '@/test/test-utils'
import { useOverlayReturnFocus } from './useOverlayReturnFocus'

function OverlayHost({ children }: { children?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const { handleCloseAutoFocus } = useOverlayReturnFocus(open)
  const overlayRef = useRef<HTMLDivElement>(null)

  const close = () => {
    const event = new Event('closeautofocus', { cancelable: true })
    Object.defineProperty(event, 'currentTarget', { value: overlayRef.current })
    handleCloseAutoFocus(event)
    setOpen(false)
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>open overlay</button>
      {open && (
        <div ref={overlayRef} tabIndex={-1} data-testid="overlay">
          <button type="button" onClick={close}>close overlay</button>
          {children}
        </div>
      )}
    </>
  )
}

async function openOverlay() {
  const opener = screen.getByRole('button', { name: 'open overlay' })
  opener.focus()
  await userEvent.setup().click(opener)
  return opener
}

afterEach(() => {
  Reflect.deleteProperty(window, 'matchMedia')
})

describe('useOverlayReturnFocus', () => {
  it('restores focus to the opener when the overlay closes', async () => {
    stubMatchMedia(true)
    render(<OverlayHost />)

    const opener = await openOverlay()
    await userEvent.setup().click(screen.getByRole('button', { name: 'close overlay' }))

    expect(screen.queryByTestId('overlay')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })

  it('captures the opener before a child with autoFocus claims focus', async () => {
    stubMatchMedia(true)
    render(
      <OverlayHost>
        <input aria-label="overlay input" autoFocus />
      </OverlayHost>,
    )

    const opener = await openOverlay()
    expect(screen.getByLabelText('overlay input')).toHaveFocus()

    await userEvent.setup().click(screen.getByRole('button', { name: 'close overlay' }))

    expect(opener).toHaveFocus()
  })
})
