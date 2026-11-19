import { useEffect, useRef, type RefObject } from 'react'
import { getFocusedElement, restoreOverlayFocus } from '@/lib/overlayFocus'

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
