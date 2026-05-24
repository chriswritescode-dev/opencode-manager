import { useEffect, useRef, useState } from 'react'

interface UseHeaderScrollVisibilityOptions {
  containerRef: React.RefObject<HTMLElement | null>
  enabled: boolean
  resetKey?: string
}

interface UseHeaderScrollVisibilityReturn {
  isHeaderVisible: boolean
}

const SCROLL_DELTA_THRESHOLD_PX = 8
const TOP_THRESHOLD_PX = 24
const BOTTOM_THRESHOLD_PX = 48

export function useHeaderScrollVisibility({
  containerRef,
  enabled,
  resetKey,
}: UseHeaderScrollVisibilityOptions): UseHeaderScrollVisibilityReturn {
  const [isHeaderVisible, setIsHeaderVisible] = useState(true)
  const lastScrollTopRef = useRef(0)
  const lastScrollHeightRef = useRef(0)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    lastScrollTopRef.current = container.scrollTop
    lastScrollHeightRef.current = container.scrollHeight
    setIsHeaderVisible(true)

    if (!enabled) return

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container
      const previousScrollTop = lastScrollTopRef.current
      const previousScrollHeight = lastScrollHeightRef.current

      lastScrollTopRef.current = scrollTop
      lastScrollHeightRef.current = scrollHeight

      if (scrollHeight !== previousScrollHeight) return

      const delta = scrollTop - previousScrollTop
      if (Math.abs(delta) < SCROLL_DELTA_THRESHOLD_PX) return

      const isAtTop = scrollTop < TOP_THRESHOLD_PX
      const isAtBottom = scrollHeight - scrollTop - clientHeight < BOTTOM_THRESHOLD_PX

      if (isAtTop || isAtBottom) {
        setIsHeaderVisible(true)
        return
      }

      if (delta > 0) {
        setIsHeaderVisible(false)
      } else {
        setIsHeaderVisible(true)
      }
    }

    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => container.removeEventListener('scroll', handleScroll)
  }, [containerRef, enabled, resetKey])

  return { isHeaderVisible }
}
