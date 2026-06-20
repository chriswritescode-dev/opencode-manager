import { useState, useEffect } from 'react'

const isTextInputFocused = () => {
  const el = document.activeElement
  if (!el) return false
  const tag = el.tagName
  return tag === 'TEXTAREA' || tag === 'INPUT' || (el as HTMLElement).isContentEditable
}

export function useVisualViewport() {
  const [keyboardHeight, setKeyboardHeight] = useState(0)

  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return

    const update = () => {
      if (!isTextInputFocused()) {
        setKeyboardHeight(0)
        return
      }
      const layoutHeight = window.innerHeight
      const visualHeight = viewport.height + viewport.offsetTop
      const offset = Math.max(0, layoutHeight - visualHeight)
      setKeyboardHeight(offset)
    }

    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    window.addEventListener('focusout', update)
    window.addEventListener('pageshow', update)
    document.addEventListener('visibilitychange', update)
    update()

    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
      window.removeEventListener('focusout', update)
      window.removeEventListener('pageshow', update)
      document.removeEventListener('visibilitychange', update)
    }
  }, [])

  return { keyboardHeight }
}
