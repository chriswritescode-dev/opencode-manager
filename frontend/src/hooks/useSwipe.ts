import { useState, useRef, useCallback } from 'react'

interface SwipeOptions {
  threshold?: number
  directionRatio?: number
  enabled?: boolean
  onSwipeStart?: () => void
  onSwipeEnd?: () => void
}

interface SwipeState {
  startX: number
  startY: number
  currentX: number
  isSwiping: boolean
  directionLocked: 'horizontal' | 'vertical' | null
}

export function useSwipe(options: SwipeOptions = {}) {
  const {
    threshold = 80,
    directionRatio = 1.5,
    enabled = true,
    onSwipeStart,
    onSwipeEnd,
  } = options

  const swipeRef = useRef<SwipeState>({
    startX: 0,
    startY: 0,
    currentX: 0,
    isSwiping: false,
    directionLocked: null,
  })

  const [swipeOffset, setSwipeOffset] = useState(0)
  const [isOpen, setIsOpen] = useState(false)
  const isSwipingBackRef = useRef(false)
  const isAnimatingRef = useRef(false)

  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (!enabled) return

    const touch = e.touches[0]
    swipeRef.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      currentX: touch.clientX,
      isSwiping: false,
      directionLocked: null,
    }
    isAnimatingRef.current = false
  }, [enabled])

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!enabled) return

    const state = swipeRef.current
    const touch = e.touches[0]
    const deltaX = state.startX - touch.clientX
    const deltaY = touch.clientY - state.startY
    const absDeltaX = Math.abs(deltaX)
    const absDeltaY = Math.abs(deltaY)

    if (!state.directionLocked && absDeltaX > 10 || absDeltaY > 10) {
      if (absDeltaX > absDeltaY * directionRatio) {
        state.directionLocked = 'horizontal'
      } else {
        state.directionLocked = 'vertical'
      }
    }

    if (state.directionLocked === 'vertical') {
      return
    }

    if (state.directionLocked === 'horizontal') {
      if (!state.isSwiping) {
        state.isSwiping = true
        onSwipeStart?.()
      }

      e.preventDefault()

      let newOffset: number
      if (deltaX > 0) {
        isSwipingBackRef.current = false
        newOffset = Math.min(deltaX, threshold)
      } else if (deltaX < 0 && isOpen) {
        isSwipingBackRef.current = true
        newOffset = Math.max(0, threshold + deltaX)
      } else {
        isSwipingBackRef.current = false
        newOffset = 0
      }

      state.currentX = touch.clientX
      setSwipeOffset(newOffset)
    }
  }, [enabled, threshold, directionRatio, isOpen, onSwipeStart])

  const handleTouchEnd = useCallback(() => {
    if (!enabled) return

    isAnimatingRef.current = true
    onSwipeEnd?.()

    const state = swipeRef.current

    if (swipeOffset > threshold / 2) {
      setIsOpen(true)
      setSwipeOffset(threshold)
    } else {
      setIsOpen(false)
      setSwipeOffset(0)
    }

    state.startX = 0
    state.startY = 0
    state.currentX = 0
    state.isSwiping = false
    state.directionLocked = null
  }, [enabled, threshold, swipeOffset, onSwipeEnd])

  const handleTouchCancel = useCallback(() => {
    if (!enabled) return

    isAnimatingRef.current = true
    setIsOpen(false)
    setSwipeOffset(0)

    swipeRef.current = {
      startX: 0,
      startY: 0,
      currentX: 0,
      isSwiping: false,
      directionLocked: null,
    }
  }, [enabled])

  const bind = useCallback((element: HTMLElement | null) => {
    if (!element || !enabled) return

    element.addEventListener('touchstart', handleTouchStart, { passive: true })
    element.addEventListener('touchmove', handleTouchMove, { passive: false })
    element.addEventListener('touchend', handleTouchEnd, { passive: true })
    element.addEventListener('touchcancel', handleTouchCancel, { passive: true })

    return () => {
      element.removeEventListener('touchstart', handleTouchStart)
      element.removeEventListener('touchmove', handleTouchMove)
      element.removeEventListener('touchend', handleTouchEnd)
      element.removeEventListener('touchcancel', handleTouchCancel)
    }
  }, [enabled, handleTouchStart, handleTouchMove, handleTouchEnd, handleTouchCancel])

  const close = useCallback(() => {
    isAnimatingRef.current = true
    setIsOpen(false)
    setSwipeOffset(0)
  }, [])

  const swipeStyles = {
    transform: swipeOffset > 0 ? `translateX(-${swipeOffset}px)` : undefined,
    transition: isAnimatingRef.current ? 'transform 0.2s ease-out' : undefined,
    touchAction: 'pan-y',
  }

  const isSwipingBack = isSwipingBackRef.current

  return {
    bind,
    swipeOffset,
    isOpen,
    isSwipingBack,
    close,
    swipeStyles,
  }
}
