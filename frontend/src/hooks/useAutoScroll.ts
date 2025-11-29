import { useRef, useEffect, useCallback } from 'react'

const SCROLL_THRESHOLD = 100

interface UseAutoScrollOptions {
  containerRef?: React.RefObject<HTMLDivElement | null>
  dependency?: unknown
  onScrollStateChange?: (isScrolledUp: boolean) => void
}

interface UseAutoScrollReturn {
  scrollToBottom: () => void
  setFollowing: (following: boolean) => void
  isFollowing: () => boolean
}

export function useAutoScroll({
  containerRef,
  dependency,
  onScrollStateChange
}: UseAutoScrollOptions): UseAutoScrollReturn {
  const userScrolledUpRef = useRef(false)
  const isFollowingRef = useRef(true)

  const scrollToBottom = useCallback(() => {
    if (!containerRef?.current) return
    containerRef.current.scrollTop = containerRef.current.scrollHeight
    userScrolledUpRef.current = false
    isFollowingRef.current = true
    onScrollStateChange?.(false)
  }, [containerRef, onScrollStateChange])

  const setFollowing = useCallback((following: boolean) => {
    isFollowingRef.current = following
  }, [])

  const isFollowing = useCallback(() => {
    return isFollowingRef.current
  }, [])

  useEffect(() => {
    userScrolledUpRef.current = false
    isFollowingRef.current = true
  }, [dependency])

  useEffect(() => {
    if (!containerRef?.current) return
    
    const container = containerRef.current
    
    const handleScroll = () => {
      const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
      const isScrolledUp = distanceFromBottom > SCROLL_THRESHOLD
      
      if (isScrolledUp) {
        isFollowingRef.current = false
      }
      
      if (userScrolledUpRef.current !== isScrolledUp) {
        userScrolledUpRef.current = isScrolledUp
        onScrollStateChange?.(isScrolledUp)
      }
    }
    
    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => container.removeEventListener('scroll', handleScroll)
  }, [containerRef, onScrollStateChange])

  return { scrollToBottom, setFollowing, isFollowing }
}
