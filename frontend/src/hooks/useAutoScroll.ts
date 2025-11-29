import { useRef, useEffect, useCallback } from 'react'

interface MessageInfo {
  role: string
}

interface Message {
  info: MessageInfo
}

interface UseAutoScrollOptions<T extends Message> {
  containerRef?: React.RefObject<HTMLDivElement | null>
  messages?: T[]
  sessionId?: string
  onScrollStateChange?: (isScrolledUp: boolean) => void
}

interface UseAutoScrollReturn {
  scrollToBottom: () => void
}

export function useAutoScroll<T extends Message>({
  containerRef,
  messages,
  sessionId,
  onScrollStateChange
}: UseAutoScrollOptions<T>): UseAutoScrollReturn {
  const lastMessageCountRef = useRef(0)
  const hasInitialScrolledRef = useRef(false)
  const userDisengagedRef = useRef(false)
  const lastScrollTopRef = useRef(0)

  const scrollToBottom = useCallback(() => {
    if (!containerRef?.current) return
    userDisengagedRef.current = false
    containerRef.current.scrollTop = containerRef.current.scrollHeight
    lastScrollTopRef.current = containerRef.current.scrollTop
    onScrollStateChange?.(false)
  }, [containerRef, onScrollStateChange])

  useEffect(() => {
    lastMessageCountRef.current = 0
    hasInitialScrolledRef.current = false
    userDisengagedRef.current = false
    lastScrollTopRef.current = 0
  }, [sessionId])

  useEffect(() => {
    if (!containerRef?.current) return
    
    const container = containerRef.current
    
    const handleWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) {
        userDisengagedRef.current = true
        onScrollStateChange?.(true)
      }
    }

    const handleTouchMove = () => {
      const currentScrollTop = container.scrollTop
      if (currentScrollTop < lastScrollTopRef.current) {
        userDisengagedRef.current = true
        onScrollStateChange?.(true)
      }
      lastScrollTopRef.current = currentScrollTop
    }
    
    container.addEventListener('wheel', handleWheel, { passive: true })
    container.addEventListener('touchmove', handleTouchMove, { passive: true })
    return () => {
      container.removeEventListener('wheel', handleWheel)
      container.removeEventListener('touchmove', handleTouchMove)
    }
  }, [containerRef, onScrollStateChange])

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
      if (newMessage?.info.role === 'user') {
        scrollToBottom()
        return
      }
    }

    if (!userDisengagedRef.current) {
      scrollToBottom()
    }
  }, [messages, containerRef, scrollToBottom])

  return { scrollToBottom }
}
