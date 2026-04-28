import { useState, useEffect, useCallback, useRef, type CSSProperties } from 'react'
import { useSwipeNavigation } from '@/contexts/SwipeNavigationContext'

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

const VELOCITY_THRESHOLD = 0.3
const ANIMATION_DURATION = 300

export interface UseSwipeBackOptions {
  threshold?: number
  edgeWidth?: number
  enabled?: boolean
  canBack?: () => boolean
  onBack?: () => void
  velocityThreshold?: number
  suspendsRouteSwipe?: boolean
}

export interface UseSwipeDismissOptions {
  threshold?: number
  enabled?: boolean
  velocityThreshold?: number
  suspendsRouteSwipe?: boolean
}

export interface UseRightEdgeSwipeOptions {
  threshold?: number
  edgeWidth?: number
  enabled?: boolean
}

function useSwipeHandlers(
  onClose: () => void,
  options: UseSwipeBackOptions & { direction: 'horizontal' | 'vertical' } = { direction: 'horizontal' }
) {
  const {
    threshold = 80,
    edgeWidth = 30,
    enabled = true,
    canBack,
    onBack,
    direction = 'horizontal',
    velocityThreshold = VELOCITY_THRESHOLD,
  } = options

  const isMobile = useMobile()
  const swipeRef = useRef<{
    startX: number
    startY: number
    currentX: number
    currentY: number
    isSwiping: boolean
    isEdgeSwipe: boolean
    startTime: number
    blockedByScroll: boolean
  }>({
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
    isSwiping: false,
    isEdgeSwipe: false,
    startTime: 0,
    blockedByScroll: false,
  })
  const [swipeProgress, setSwipeProgress] = useState(0)
  const [swipeDeltaPx, setSwipeDeltaPx] = useState(0)
  const [dismissing, setDismissing] = useState(false)

  useEffect(() => {
    if (!enabled) {
      setDismissing(false)
      setSwipeDeltaPx(0)
      setSwipeProgress(0)
    }
  }, [enabled])

  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (!enabled || !isMobile) return

    const touch = e.touches[0]

    if (direction === 'vertical') {
      const target = e.target as Element
      let scrollable: Element | null = target
      while (scrollable && scrollable !== e.currentTarget) {
        if (scrollable.scrollHeight > scrollable.clientHeight) {
          const style = window.getComputedStyle(scrollable)
          if (style.overflowY === 'auto' || style.overflowY === 'scroll' || style.overflow === 'auto' || style.overflow === 'scroll') {
            break
          }
        }
        scrollable = scrollable.parentElement
      }
      const blockedByScroll = scrollable && scrollable !== e.currentTarget && scrollable.scrollTop > 0

      swipeRef.current = {
        startX: touch.clientX,
        startY: touch.clientY,
        currentX: touch.clientX,
        currentY: touch.clientY,
        isSwiping: false,
        isEdgeSwipe: false,
        startTime: Date.now(),
        blockedByScroll: !!blockedByScroll,
      }
    } else {
      swipeRef.current = {
        startX: touch.clientX,
        startY: touch.clientY,
        currentX: touch.clientX,
        currentY: touch.clientY,
        isSwiping: false,
        isEdgeSwipe: touch.clientX <= edgeWidth,
        startTime: Date.now(),
        blockedByScroll: false,
      }
    }
  }, [enabled, isMobile, edgeWidth, direction])

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!enabled || !isMobile) return

    const state = swipeRef.current
    const touch = e.touches[0]

    if (direction === 'vertical') {
      if (state.blockedByScroll) return

      const deltaX = touch.clientX - state.startX
      const deltaY = touch.clientY - state.startY

      if (!state.isSwiping) {
        if (Math.abs(deltaY) > 10 && deltaY > 0 && deltaY > Math.abs(deltaX) * 1.5) {
          state.isSwiping = true
        } else {
          return
        }
      }

      if (state.isSwiping) {
        e.preventDefault()
        state.currentY = touch.clientY
        const clamped = Math.max(deltaY, 0)
        setSwipeDeltaPx(clamped)
        setSwipeProgress(Math.min(clamped / threshold, 1.5))
      }
    } else {
      if (!state.isEdgeSwipe) return

      const deltaX = touch.clientX - state.startX
      const deltaY = Math.abs(touch.clientY - state.startY)

      if (!state.isSwiping) {
        if (deltaX > 10 && deltaX > deltaY * 2) {
          state.isSwiping = true
        } else {
          return
        }
      }

      if (state.isSwiping) {
        e.preventDefault()
        state.currentX = touch.clientX
        setSwipeProgress(Math.min(Math.max(deltaX / threshold, 0), 1.5))
      }
    }
  }, [enabled, isMobile, threshold, direction])

  const handleTouchEnd = useCallback(() => {
    if (!enabled || !isMobile) return

    const state = swipeRef.current

    if (state.isSwiping) {
      if (direction === 'vertical') {
        const deltaY = state.currentY - state.startY
        const elapsed = Date.now() - state.startTime
        const velocity = deltaY / Math.max(elapsed, 1)

        if (deltaY >= threshold || velocity >= velocityThreshold) {
          setDismissing(true)
          setTimeout(() => {
            if (canBack?.()) {
              onBack?.()
            } else {
              onClose()
            }
          }, ANIMATION_DURATION)
        } else {
          setSwipeDeltaPx(0)
          setSwipeProgress(0)
        }
      } else {
        const deltaX = state.currentX - state.startX
        if (deltaX >= threshold) {
          if (canBack?.()) {
            onBack?.()
          } else {
            onClose()
          }
        }
        setSwipeProgress(0)
      }
    } else {
      setSwipeProgress(0)
      setSwipeDeltaPx(0)
    }

    swipeRef.current = {
      startX: 0,
      startY: 0,
      currentX: 0,
      currentY: 0,
      isSwiping: false,
      isEdgeSwipe: false,
      startTime: 0,
      blockedByScroll: false,
    }
  }, [enabled, isMobile, threshold, direction, velocityThreshold, onClose, canBack, onBack])

  const bind = useCallback((element: HTMLElement | null) => {
    if (!element || !enabled || !isMobile) return undefined
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

  const swipeStyles: CSSProperties = direction === 'vertical'
    ? dismissing
      ? {
          transform: 'translateY(100%)',
          transition: `transform ${ANIMATION_DURATION}ms cubic-bezier(0.4, 0, 0.2, 1)`,
        }
      : swipeDeltaPx > 0
        ? { transform: `translateY(${swipeDeltaPx}px)` }
        : { transform: 'translateY(0)', transition: 'transform 0.2s ease-out' }
    : {
        transform: swipeProgress > 0 ? `translateX(${swipeProgress * 50}px)` : undefined,
        transition: swipeProgress === 0 ? 'transform 0.2s ease-out' : undefined,
      }

  return { bind, swipeProgress, swipeStyles }
}

export function useSwipeBack(
  onClose: () => void,
  options: UseSwipeBackOptions = {}
) {
  const {
    threshold = 80,
    edgeWidth = 30,
    enabled = true,
    canBack,
    onBack,
    velocityThreshold = VELOCITY_THRESHOLD,
    suspendsRouteSwipe = true,
  } = options

  const isMobile = useMobile()
  const swipeNav = useSwipeNavigation()
  const shouldSuspend = enabled && isMobile && suspendsRouteSwipe !== false

  useEffect(() => {
    if (shouldSuspend) {
      swipeNav?.suspend()
      return () => {
        swipeNav?.resume()
      }
    }
    return undefined
  }, [shouldSuspend, swipeNav])

  const wrappedOnBack = useCallback(() => {
    if (!suspendsRouteSwipe && swipeNav?.isSuspended()) {
      return
    }
    onBack?.()
  }, [onBack, suspendsRouteSwipe, swipeNav])

  const wrappedOnClose = useCallback(() => {
    if (!suspendsRouteSwipe && swipeNav?.isSuspended()) {
      return
    }
    onClose()
  }, [onClose, suspendsRouteSwipe, swipeNav])

  const { bind, swipeProgress, swipeStyles } = useSwipeHandlers(wrappedOnClose, {
    threshold,
    edgeWidth,
    enabled,
    canBack,
    onBack: wrappedOnBack,
    velocityThreshold,
    direction: 'horizontal',
  })

  const wrappedBind = useCallback(
    (element: HTMLElement | null) => {
      const cleanup = bind(element)
      return () => {
        cleanup?.()
      }
    },
    [bind]
  )

  return { bind: wrappedBind, swipeProgress, swipeStyles }
}

export function useSwipeDismiss(
  onClose: () => void,
  options: UseSwipeDismissOptions = {}
) {
  const {
    threshold = 80,
    enabled = true,
    velocityThreshold = VELOCITY_THRESHOLD,
    suspendsRouteSwipe = true,
  } = options

  const isMobile = useMobile()
  const swipeNav = useSwipeNavigation()
  const shouldSuspend = enabled && isMobile && suspendsRouteSwipe !== false

  useEffect(() => {
    if (shouldSuspend) {
      swipeNav?.suspend()
      return () => {
        swipeNav?.resume()
      }
    }
    return undefined
  }, [shouldSuspend, swipeNav])

  const wrappedOnClose = useCallback(() => {
    if (!suspendsRouteSwipe && swipeNav?.isSuspended()) {
      return
    }
    onClose()
  }, [onClose, suspendsRouteSwipe, swipeNav])

  const { bind, swipeProgress, swipeStyles } = useSwipeHandlers(wrappedOnClose, {
    threshold,
    edgeWidth: 30,
    enabled,
    velocityThreshold,
    direction: 'vertical',
  })

  const wrappedBind = useCallback(
    (element: HTMLElement | null) => {
      const cleanup = bind(element)
      return () => {
        cleanup?.()
      }
    },
    [bind]
  )

  return { bind: wrappedBind, swipeProgress, swipeStyles }
}

export function useRightEdgeSwipe(
  onOpen: () => void,
  options: UseRightEdgeSwipeOptions = {}
) {
  const {
    threshold = 80,
    edgeWidth = 28,
    enabled = true,
  } = options

  const isMobile = useMobile()
  const swipeRef = useRef({
    startX: 0,
    startY: 0,
    currentX: 0,
    isSwiping: false,
    isEdgeSwipe: false,
  })

  const handleTouchStart = useCallback((event: TouchEvent) => {
    if (!enabled || !isMobile) return

    const touch = event.touches[0]
    swipeRef.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      currentX: touch.clientX,
      isSwiping: false,
      isEdgeSwipe: window.innerWidth - touch.clientX <= edgeWidth,
    }
  }, [edgeWidth, enabled, isMobile])

  const handleTouchMove = useCallback((event: TouchEvent) => {
    if (!enabled || !isMobile) return

    const state = swipeRef.current
    if (!state.isEdgeSwipe) return

    const touch = event.touches[0]
    const deltaX = touch.clientX - state.startX
    const deltaY = Math.abs(touch.clientY - state.startY)

    if (!state.isSwiping) {
      if (deltaX < -10 && Math.abs(deltaX) > deltaY * 2) {
        state.isSwiping = true
      } else {
        return
      }
    }

    event.preventDefault()
    state.currentX = touch.clientX
  }, [enabled, isMobile])

  const handleTouchEnd = useCallback(() => {
    if (!enabled || !isMobile) return

    const state = swipeRef.current
    if (state.isSwiping && state.startX - state.currentX >= threshold) {
      onOpen()
    }

    swipeRef.current = {
      startX: 0,
      startY: 0,
      currentX: 0,
      isSwiping: false,
      isEdgeSwipe: false,
    }
  }, [enabled, isMobile, onOpen, threshold])

  const bind = useCallback((element: HTMLElement | null) => {
    if (!element || !enabled || !isMobile) return undefined

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
  }, [enabled, handleTouchEnd, handleTouchMove, handleTouchStart, isMobile])

  return { bind }
}
