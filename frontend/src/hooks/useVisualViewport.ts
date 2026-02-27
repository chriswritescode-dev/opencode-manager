import { useState, useEffect } from 'react'

export function useVisualViewport() {
  const [keyboardHeight, setKeyboardHeight] = useState(0)

  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return

    const update = () => {
      const layoutHeight = window.innerHeight
      const visualHeight = viewport.height + viewport.offsetTop
      const offset = Math.max(0, layoutHeight - visualHeight)
      setKeyboardHeight(offset)
    }

    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    update()

    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
    }
  }, [])

  return { keyboardHeight }
}
