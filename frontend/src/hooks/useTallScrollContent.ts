import { useState, useEffect, useRef } from 'react'

export function useTallScrollContent(
  containerRef: React.RefObject<HTMLElement | null>,
  ratio = 1.5
): boolean {
  const [isTall, setIsTall] = useState(false)
  const observingRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const recompute = () => {
      const el = containerRef.current
      if (!el) return
      setIsTall(el.scrollHeight > el.clientHeight * ratio)
    }

    const el = containerRef.current

    if (!el || el === observingRef.current) return

    observingRef.current = el
    recompute()

    const observer = new ResizeObserver(recompute)
    observer.observe(el)
    el.addEventListener('scroll', recompute)

    return () => {
      observer.disconnect()
      el.removeEventListener('scroll', recompute)
      observingRef.current = null
    }
  })

  return isTall
}
