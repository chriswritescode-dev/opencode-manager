import { useState, useMemo, useCallback } from 'react'

interface FindMatch {
  startIndex: number
  endIndex: number
}

interface UseFindInTextReturn {
  query: string
  setQuery: (q: string) => void
  matches: FindMatch[]
  currentMatchIndex: number
  hasMatches: boolean
  next: () => void
  prev: () => void
  clear: () => void
}

export function useFindInText(text: string): UseFindInTextReturn {
  const [query, setQueryState] = useState('')
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0)

  const matches = useMemo(() => {
    if (!query.trim()) return []
    const results: FindMatch[] = []
    const lowerText = text.toLowerCase()
    const lowerQuery = query.toLowerCase()
    let idx = 0
    while (true) {
      idx = lowerText.indexOf(lowerQuery, idx)
      if (idx === -1) break
      results.push({ startIndex: idx, endIndex: idx + query.length })
      idx += query.length
    }
    return results
  }, [text, query])

  const safeIndex = useMemo(() => {
    if (matches.length === 0) return 0
    return Math.max(0, Math.min(currentMatchIndex, matches.length - 1))
  }, [currentMatchIndex, matches.length])

  const next = useCallback(() => {
    if (matches.length > 0) {
      setCurrentMatchIndex(prev => (prev + 1) % matches.length)
    }
  }, [matches.length])

  const prev = useCallback(() => {
    if (matches.length > 0) {
      setCurrentMatchIndex(prev => (prev - 1 + matches.length) % matches.length)
    }
  }, [matches.length])

  const clear = useCallback(() => {
    setQueryState('')
    setCurrentMatchIndex(0)
  }, [])

  const setQuery = useCallback((q: string) => {
    setQueryState(q)
    setCurrentMatchIndex(0)
  }, [])

  return {
    query,
    setQuery,
    matches,
    currentMatchIndex: safeIndex,
    hasMatches: matches.length > 0,
    next,
    prev,
    clear,
  }
}
