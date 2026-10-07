import { useCallback, useEffect, useRef, useState, type TouchEvent } from 'react'

const TOUCH_TAP_MOVE_THRESHOLD = 8
const TOUCH_CLICK_SUPPRESS_MS = 400
const LONG_PRESS_MS = 450
export const SWIPE_COMMIT_DISTANCE = 96

interface TouchGestureOptions<T> {
  onSwipeRight?: (item: T) => void
  onLongPress?: (item: T) => void
}

interface ActiveSwipe<T> {
  item: T
  offset: number
}

export function useTouchTapSelect<T>(onSelect: (item: T) => void, options: TouchGestureOptions<T> = {}) {
  const { onSwipeRight, onLongPress } = options
  const touchStartRef = useRef<{ x: number, y: number } | null>(null)
  const hasTouchMovedRef = useRef(false)
  const isSwipingRef = useRef(false)
  const suppressClickRef = useRef(false)
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressFiredRef = useRef(false)
  const [swipe, setSwipe] = useState<ActiveSwipe<T> | null>(null)

  const clearLongPress = useCallback(() => {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current)
    longPressTimerRef.current = null
  }, [])

  useEffect(() => clearLongPress, [clearLongPress])

  const suppressNextClick = useCallback(() => {
    suppressClickRef.current = true
    setTimeout(() => {
      suppressClickRef.current = false
    }, TOUCH_CLICK_SUPPRESS_MS)
  }, [])

  const onTouchStart = useCallback((event: TouchEvent<HTMLElement>, item?: T) => {
    const touch = event.touches[0]
    if (!touch) return

    touchStartRef.current = { x: touch.clientX, y: touch.clientY }
    hasTouchMovedRef.current = false
    isSwipingRef.current = false
    longPressFiredRef.current = false
    clearLongPress()

    if (onLongPress && item !== undefined) {
      longPressTimerRef.current = setTimeout(() => {
        longPressFiredRef.current = true
        onLongPress(item)
      }, LONG_PRESS_MS)
    }
  }, [clearLongPress, onLongPress])

  const onTouchMove = useCallback((event: TouchEvent<HTMLElement>, item?: T) => {
    const start = touchStartRef.current
    const touch = event.touches[0]
    if (!start || !touch) return

    const deltaX = touch.clientX - start.x
    const deltaY = touch.clientY - start.y
    if (Math.abs(deltaX) > TOUCH_TAP_MOVE_THRESHOLD || Math.abs(deltaY) > TOUCH_TAP_MOVE_THRESHOLD) {
      hasTouchMovedRef.current = true
      clearLongPress()
    }

    if (!onSwipeRight || item === undefined) return
    if (!isSwipingRef.current && deltaX > TOUCH_TAP_MOVE_THRESHOLD && deltaX > Math.abs(deltaY) * 2) {
      isSwipingRef.current = true
    }
    if (isSwipingRef.current) {
      setSwipe({ item, offset: Math.max(0, deltaX) })
    }
  }, [clearLongPress, onSwipeRight])

  const onTouchEnd = useCallback((event: TouchEvent<HTMLElement>, item: T) => {
    const hasTouchMoved = hasTouchMovedRef.current
    const wasSwiping = isSwipingRef.current
    const longPressFired = longPressFiredRef.current
    const start = touchStartRef.current
    const touch = event.changedTouches[0]

    touchStartRef.current = null
    hasTouchMovedRef.current = false
    isSwipingRef.current = false
    longPressFiredRef.current = false
    clearLongPress()
    setSwipe(null)

    if (wasSwiping && start && touch && touch.clientX - start.x >= SWIPE_COMMIT_DISTANCE) {
      event.preventDefault()
      suppressNextClick()
      onSwipeRight?.(item)
      return
    }

    if (hasTouchMoved || longPressFired) {
      if (longPressFired) event.preventDefault()
      suppressNextClick()
      return
    }

    event.preventDefault()
    suppressNextClick()
    onSelect(item)
  }, [clearLongPress, onSelect, onSwipeRight, suppressNextClick])

  const onClick = useCallback((item: T) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }

    onSelect(item)
  }, [onSelect])

  return {
    swipe,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onClick,
  }
}
