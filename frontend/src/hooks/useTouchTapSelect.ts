import { useCallback, useRef, type TouchEvent } from 'react'

const TOUCH_TAP_MOVE_THRESHOLD = 8
const TOUCH_CLICK_SUPPRESS_MS = 400

export function useTouchTapSelect<T>(onSelect: (item: T) => void) {
  const touchStartRef = useRef<{ x: number, y: number } | null>(null)
  const hasTouchMovedRef = useRef(false)
  const suppressClickRef = useRef(false)

  const suppressNextClick = useCallback(() => {
    suppressClickRef.current = true
    setTimeout(() => {
      suppressClickRef.current = false
    }, TOUCH_CLICK_SUPPRESS_MS)
  }, [])

  const onTouchStart = useCallback((event: TouchEvent<HTMLElement>) => {
    const touch = event.touches[0]
    if (!touch) return

    touchStartRef.current = { x: touch.clientX, y: touch.clientY }
    hasTouchMovedRef.current = false
  }, [])

  const onTouchMove = useCallback((event: TouchEvent<HTMLElement>) => {
    const start = touchStartRef.current
    const touch = event.touches[0]
    if (!start || !touch) return

    const deltaX = Math.abs(touch.clientX - start.x)
    const deltaY = Math.abs(touch.clientY - start.y)
    if (deltaX > TOUCH_TAP_MOVE_THRESHOLD || deltaY > TOUCH_TAP_MOVE_THRESHOLD) {
      hasTouchMovedRef.current = true
    }
  }, [])

  const onTouchEnd = useCallback((event: TouchEvent<HTMLElement>, item: T) => {
    const hasTouchMoved = hasTouchMovedRef.current

    touchStartRef.current = null
    hasTouchMovedRef.current = false

    if (hasTouchMoved) {
      suppressNextClick()
      return
    }

    event.preventDefault()
    suppressNextClick()
    onSelect(item)
  }, [onSelect, suppressNextClick])

  const onClick = useCallback((item: T) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }

    onSelect(item)
  }, [onSelect])

  return {
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onClick,
  }
}
