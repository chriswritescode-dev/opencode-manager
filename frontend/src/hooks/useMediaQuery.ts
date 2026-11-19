import { useEffect, useState } from 'react'

export const DESKTOP_MEDIA_QUERY = '(min-width: 640px)'

export const FINE_POINTER_MEDIA_QUERY = '(hover: hover) and (pointer: fine)'

function canMatchMedia(): boolean {
  return 'window' in globalThis && window.matchMedia instanceof Function
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (!canMatchMedia()) {
      return false
    }
    return window.matchMedia(query).matches
  })

  useEffect(() => {
    if (!canMatchMedia()) {
      return
    }
    const mediaQuery = window.matchMedia(query)
    setMatches(mediaQuery.matches)
    const update = () => setMatches(mediaQuery.matches)
    mediaQuery.addEventListener('change', update)
    return () => mediaQuery.removeEventListener('change', update)
  }, [query])

  return matches
}
