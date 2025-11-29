import { useRef, useEffect, useCallback } from 'react'

const SCROLL_THRESHOLD = 100

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
  const isFollowingRef = useRef(true)
  const lastMessageCountRef = useRef(0)
  const hasInitialScrolledRef = useRef(false)
  const isProgrammaticScrollRef = useRef(false)

  const scrollToBottom = useCallback(() => {
    if (!containerRef?.current) return
    isProgrammaticScrollRef.current = true
    containerRef.current.scrollTop = containerRef.current.scrollHeight
    isFollowingRef.current = true
    onScrollStateChange?.(false)
  }, [containerRef, onScrollStateChange])

  useEffect(() => {
    isFollowingRef.current = true
    lastMessageCountRef.current = 0
    hasInitialScrolledRef.current = false
  }, [sessionId])

  useEffect(() => {
    if (!containerRef?.current) return
    
    const container = containerRef.current
    
    const handleScroll = () => {
      if (isProgrammaticScrollRef.current) {
        isProgrammaticScrollRef.current = false
        return
      }
      
      isFollowingRef.current = false
      
      const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
      const isScrolledUp = distanceFromBottom > SCROLL_THRESHOLD
      onScrollStateChange?.(isScrolledUp)
    }
    
    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => container.removeEventListener('scroll', handleScroll)
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
        isFollowingRef.current = true
        scrollToBottom()
        return
      }
    }

    if (isFollowingRef.current) {
      scrollToBottom()
    }
  }, [messages, containerRef, scrollToBottom])

  return { scrollToBottom }
}
