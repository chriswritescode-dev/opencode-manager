import { useState, useEffect, useCallback, useRef } from 'react'

export function useMobile() {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768)
    }
    
    checkMobile()
    window.addEventListener('resize', checkMobile)
    
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  return isMobile
}

interface SwipeBackOptions {
  threshold?: number
  edgeWidth?: number
  enabled?: boolean
  onSwipeStart?: () => void
  onSwipeEnd?: () => void
}

interface SwipeState {
  startX: number
  startY: number
  currentX: number
  isSwiping: boolean
  isEdgeSwipe: boolean
}

export function useSwipeBack(
  onBack: () => void,
  options: SwipeBackOptions = {}
) {
  const {
    threshold = 80,
    edgeWidth = 30,
    enabled = true,
    onSwipeStart,
    onSwipeEnd,
  } = options

  const isMobile = useMobile()
  const swipeRef = useRef<SwipeState>({
    startX: 0,
    startY: 0,
    currentX: 0,
    isSwiping: false,
    isEdgeSwipe: false,
  })
  const [swipeProgress, setSwipeProgress] = useState(0)

  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (!enabled || !isMobile) return
    
    const touch = e.touches[0]
    const isEdge = touch.clientX <= edgeWidth
    
    swipeRef.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      currentX: touch.clientX,
      isSwiping: false,
      isEdgeSwipe: isEdge,
    }
  }, [enabled, isMobile, edgeWidth])

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!enabled || !isMobile) return
    
    const state = swipeRef.current
    if (!state.isEdgeSwipe) return
    
    const touch = e.touches[0]
    const deltaX = touch.clientX - state.startX
    const deltaY = Math.abs(touch.clientY - state.startY)
    
    if (!state.isSwiping && deltaX > 10 && deltaX > deltaY * 2) {
      state.isSwiping = true
      onSwipeStart?.()
    }
    
    if (state.isSwiping) {
      e.preventDefault()
      state.currentX = touch.clientX
      const progress = Math.min(Math.max(deltaX / threshold, 0), 1.5)
      setSwipeProgress(progress)
    }
  }, [enabled, isMobile, threshold, onSwipeStart])

  const handleTouchEnd = useCallback(() => {
    if (!enabled || !isMobile) return
    
    const state = swipeRef.current
    
    if (state.isSwiping) {
      const deltaX = state.currentX - state.startX
      
      if (deltaX >= threshold) {
        onBack()
      }
      
      onSwipeEnd?.()
    }
    
    swipeRef.current = {
      startX: 0,
      startY: 0,
      currentX: 0,
      isSwiping: false,
      isEdgeSwipe: false,
    }
    setSwipeProgress(0)
  }, [enabled, isMobile, threshold, onBack, onSwipeEnd])

  const bind = useCallback((element: HTMLElement | null) => {
    if (!element || !enabled || !isMobile) return

    element.addEventListener('touchstart', handleTouchStart, { passive: true })
    element.addEventListener('touchmove', handleTouchMove, { passive: false })
    element.addEventListener('touchend', handleTouchEnd, { passive: true })
    element.addEventListener('touchcancel', handleTouchEnd, { passive: true })

    return () => {
      element.removeEventListener('touchstart', handleTouchStart)
      element.removeEventListener('touchmove', handleTouchMove)
      element.removeEventListener('touchend', handleTouchEnd)
      element.removeEventListener('touchcancel', handleTouchEnd)
    }
  }, [enabled, isMobile, handleTouchStart, handleTouchMove, handleTouchEnd])

  const swipeStyles = {
    transform: swipeProgress > 0 ? `translateX(${swipeProgress * 50}px)` : undefined,
    transition: swipeProgress === 0 ? 'transform 0.2s ease-out' : undefined,
  }

  return {
    bind,
    swipeProgress,
    swipeStyles,
    isSwiping: swipeRef.current.isSwiping,
  }
}