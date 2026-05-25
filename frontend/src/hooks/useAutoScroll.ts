import { useRef, useEffect, useCallback } from 'react'
import type { Message } from '@/api/types'

const SCROLL_LOCK_MS = 300
const BOTTOM_THRESHOLD_PX = 48
const SHOW_SCROLL_BUTTON_THRESHOLD_PX = 120
const SCROLL_TO_BOTTOM_FRAME_COUNT = 2

interface UseAutoScrollOptions {
  containerRef?: React.RefObject<HTMLDivElement | null>
  messages?: Message[]
  sessionId?: string
  contentVersion?: number
  onScrollStateChange?: (isScrolledUp: boolean) => void
}

interface UseAutoScrollReturn {
  scrollToBottom: () => void
}

export function useAutoScroll({
  containerRef,
  messages,
  sessionId,
  contentVersion,
  onScrollStateChange
}: UseAutoScrollOptions): UseAutoScrollReturn {
  const lastMessageCountRef = useRef(0)
  const hasInitialScrolledRef = useRef(false)
  const userScrolledAtRef = useRef(0)
  const userDisengagedRef = useRef(false)
  const pointerStartYRef = useRef<number | null>(null)
  const pointerActiveRef = useRef(false)
  const onScrollStateChangeRef = useRef(onScrollStateChange)
  const scrollRequestIdRef = useRef(0)
  const isScrollButtonVisibleRef = useRef(false)
  
  onScrollStateChangeRef.current = onScrollStateChange

  const scrollToBottom = useCallback(() => {
    if (!containerRef?.current) return
    userScrolledAtRef.current = 0
    userDisengagedRef.current = false
    isScrollButtonVisibleRef.current = false
    const scrollRequestId = scrollRequestIdRef.current + 1
    scrollRequestIdRef.current = scrollRequestId
    const scroll = () => {
      if (!containerRef?.current) return
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }

    scroll()
    let frameCount = 0
    const scrollAfterLayout = () => {
      if (scrollRequestIdRef.current !== scrollRequestId) return
      frameCount += 1
      scroll()
      if (frameCount < SCROLL_TO_BOTTOM_FRAME_COUNT) {
        requestAnimationFrame(scrollAfterLayout)
      }
    }
    requestAnimationFrame(scrollAfterLayout)
    onScrollStateChangeRef.current?.(false)
  }, [containerRef])

  useEffect(() => {
    lastMessageCountRef.current = 0
    hasInitialScrolledRef.current = false
    userScrolledAtRef.current = 0
    userDisengagedRef.current = false
  }, [sessionId])

  useEffect(() => {
    const container = containerRef?.current
    if (!container) return
    
    const markDisengaged = () => {
      const container = containerRef?.current
      if (!container) return
      const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
      userScrolledAtRef.current = Date.now()
      scrollRequestIdRef.current += 1
      if (!isScrollButtonVisibleRef.current && distanceFromBottom > SHOW_SCROLL_BUTTON_THRESHOLD_PX) {
        isScrollButtonVisibleRef.current = true
        onScrollStateChangeRef.current?.(true)
      }
      userDisengagedRef.current = true
    }

    const handlePointerDown = (e: PointerEvent) => {
      pointerStartYRef.current = e.clientY
      pointerActiveRef.current = true
      scrollRequestIdRef.current += 1
    }

    const handlePointerMove = (e: PointerEvent) => {
      if (pointerStartYRef.current === null) return
      if (e.clientY > pointerStartYRef.current + 4) {
        markDisengaged()
      }
    }

    const handlePointerUp = () => {
      pointerStartYRef.current = null
      pointerActiveRef.current = false
    }

    const handleWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) {
        markDisengaged()
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (['PageUp', 'ArrowUp', 'Home'].includes(e.key)) {
        markDisengaged()
      }
    }

    const handleScroll = () => {
      if (!hasInitialScrolledRef.current) return
      const { scrollTop, scrollHeight, clientHeight } = container
      const isAtBottom = scrollHeight - scrollTop - clientHeight < BOTTOM_THRESHOLD_PX

      if (isAtBottom) {
        if (userDisengagedRef.current) {
          userScrolledAtRef.current = 0
          userDisengagedRef.current = false
          isScrollButtonVisibleRef.current = false
          onScrollStateChangeRef.current?.(false)
        }
      } else if (userDisengagedRef.current && !isScrollButtonVisibleRef.current && scrollHeight - scrollTop - clientHeight > SHOW_SCROLL_BUTTON_THRESHOLD_PX) {
        isScrollButtonVisibleRef.current = true
        onScrollStateChangeRef.current?.(true)
      } else if (pointerActiveRef.current && !userDisengagedRef.current) {
        userScrolledAtRef.current = Date.now()
        userDisengagedRef.current = true
        if (scrollHeight - scrollTop - clientHeight > SHOW_SCROLL_BUTTON_THRESHOLD_PX) {
          isScrollButtonVisibleRef.current = true
          onScrollStateChangeRef.current?.(true)
        }
      }
    }
    
    container.addEventListener('pointerdown', handlePointerDown, { passive: true })
    container.addEventListener('pointermove', handlePointerMove, { passive: true })
    container.addEventListener('pointerup', handlePointerUp, { passive: true })
    container.addEventListener('pointercancel', handlePointerUp, { passive: true })
    container.addEventListener('wheel', handleWheel, { passive: true })
    container.addEventListener('keydown', handleKeyDown)
    container.addEventListener('scroll', handleScroll, { passive: true })
    
    return () => {
      container.removeEventListener('pointerdown', handlePointerDown)
      container.removeEventListener('pointermove', handlePointerMove)
      container.removeEventListener('pointerup', handlePointerUp)
      container.removeEventListener('pointercancel', handlePointerUp)
      container.removeEventListener('wheel', handleWheel)
      container.removeEventListener('keydown', handleKeyDown)
      container.removeEventListener('scroll', handleScroll)
    }
  }, [containerRef, sessionId, messages])

  useEffect(() => {
    if (!containerRef?.current || !messages) return

    const currentCount = messages.length
    const prevCount = lastMessageCountRef.current
    lastMessageCountRef.current = currentCount

    if (!hasInitialScrolledRef.current && currentCount > 0) {
      hasInitialScrolledRef.current = true
      scrollToBottom()
      return
    }

    if (currentCount > prevCount) {
      const newMessage = messages[currentCount - 1]
      if (newMessage?.role === 'user') {
        scrollToBottom()
        return
      }
    }

    const timeSinceUserScroll = Date.now() - userScrolledAtRef.current
    const recentlyScrolled = timeSinceUserScroll < SCROLL_LOCK_MS
    
    if (recentlyScrolled || userDisengagedRef.current || pointerActiveRef.current) {
      return
    }

    scrollToBottom()
  }, [messages, containerRef, scrollToBottom, contentVersion])

  return { scrollToBottom }
}
