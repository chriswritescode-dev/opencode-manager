import { useCallback, useState } from 'react'
import { getFocusedElement, restoreOverlayFocus } from '@/lib/overlayFocus'

export interface OverlayReturnFocus {
  handleCloseAutoFocus: (event: Event) => void
}

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
      if (restoreOverlayFocus(returnFocus, event.currentTarget instanceof Element ? event.currentTarget : null)) {
        event.preventDefault()
      }
    },
    [returnFocus],
  )

  return { handleCloseAutoFocus }
}
