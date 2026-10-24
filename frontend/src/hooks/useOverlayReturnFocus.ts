import { useCallback, useState } from 'react'
import { getFocusedElement, restoreOverlayFocus } from '@/lib/overlayFocus'

export interface OverlayReturnFocus {
  handleCloseAutoFocus: (event: Event) => void
}

/**
 * Captures the element that owns focus when an overlay opens and restores focus to it when the
 * overlay reports its close-autofocus event.
 *
 * The opener is captured during render on the closed-to-open transition, before children with
 * `autoFocus` claim focus during commit, and the captured value survives re-renders while the
 * overlay stays open. The returned handler prevents the close event's default focus handling only
 * when focus was actually moved.
 */
export function useOverlayReturnFocus(open: boolean | undefined): OverlayReturnFocus {
  const [openState, setOpenState] = useState(() => ({
    open,
    returnFocus: open ? getFocusedElement() : null,
  }))

  if (openState.open !== open) {
    setOpenState({ open, returnFocus: open ? getFocusedElement() : openState.returnFocus })
  }

  const { returnFocus } = openState
  const handleCloseAutoFocus = useCallback(
    (event: Event) => {
      if (restoreOverlayFocus(returnFocus, event.currentTarget as Element | null)) {
        event.preventDefault()
      }
    },
    [returnFocus],
  )

  return { handleCloseAutoFocus }
}
