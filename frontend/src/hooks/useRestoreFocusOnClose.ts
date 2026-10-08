import { useEffect, useRef, type RefObject } from 'react'
import { getFocusedElement, restoreOverlayFocus } from '@/lib/overlayFocus'

/**
 * Captures the focused element when an overlay opens and restores focus to it when the overlay closes.
 *
 * The opener is captured during render on the closed-to-open transition, before children with
 * `autoFocus` claim focus during commit, and is idempotent across StrictMode's double render.
 */
export function useRestoreFocusOnClose(
  isOpen: boolean,
  containerRef: RefObject<HTMLElement | null>,
): void {
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const wasOpenRef = useRef(false)

  if (isOpen && !wasOpenRef.current) {
    returnFocusRef.current = getFocusedElement()
  }

  useEffect(() => {
    if (!isOpen && wasOpenRef.current) {
      restoreOverlayFocus(returnFocusRef.current, containerRef.current)
    }
    wasOpenRef.current = isOpen
  }, [isOpen, containerRef])
}
