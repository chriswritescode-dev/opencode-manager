import { useState, useCallback, useMemo } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { fetchFileRange, applyFilePatches } from '@/api/files'
import type { PatchOperation } from '@/types/files'

interface UseVirtualizedContentOptions {
  filePath: string
  chunkSize?: number
  overscan?: number
  enabled?: boolean
  initialTotalLines?: number
}

interface LineData {
  content: string
  loaded: boolean
}

interface UseVirtualizedContentReturn {
  lines: Map<number, LineData>
  totalLines: number
  isLoading: boolean
  error: Error | null
  loadRange: (startLine: number, endLine: number) => void
  getVisibleRange: (scrollTop: number, viewportHeight: number, lineHeight: number) => { start: number; end: number }
  editedLines: Map<number, string>
  setLineContent: (lineNumber: number, content: string) => void
  clearEdits: () => void
  getDirtyRanges: () => Array<{ startLine: number; endLine: number; content: string }>
  saveEdits: () => Promise<void>
  isSaving: boolean
  hasUnsavedChanges: boolean
  prefetchAdjacent: (visibleStart: number, visibleEnd: number) => void
  loadAll: () => Promise<void>
  fullContent: string | null
  isFullyLoaded: boolean
}

export function useVirtualizedContent({
  filePath,
  chunkSize = 200,
  overscan = 50,
  enabled = true,
}: UseVirtualizedContentOptions): UseVirtualizedContentReturn {
  const [editedLines, setEditedLines] = useState<Map<number, string>>(new Map())
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<Error | null>(null)

  const {
    data,
    isLoading,
    error: queryError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['file-range', filePath],
    queryFn: async ({ pageParam }) => {
      const result = await fetchFileRange(filePath, pageParam, pageParam + chunkSize)
      return result
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      if (!lastPage.hasMore) return undefined
      return lastPage.endLine
    },
    enabled: enabled && !!filePath,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })

  const totalLines = data?.pages[0]?.totalLines ?? 0

  const lines = useMemo(() => {
    const map = new Map<number, LineData>()
    if (!data?.pages) return map

    for (const page of data.pages) {
      page.lines.forEach((content, idx) => {
        map.set(page.startLine + idx, { content, loaded: true })
      })
    }
    return map
  }, [data?.pages])

  const loadedEndLine = useMemo(() => {
    if (!data?.pages?.length) return 0
    return Math.max(...data.pages.map(p => p.endLine))
  }, [data?.pages])

  const loadRange = useCallback((_startLine: number, endLine: number) => {
    if (endLine > loadedEndLine && hasNextPage && !isFetchingNextPage) {
      fetchNextPage()
    }
  }, [loadedEndLine, hasNextPage, isFetchingNextPage, fetchNextPage])

  const getVisibleRange = useCallback((scrollTop: number, viewportHeight: number, lineHeight: number) => {
    const start = Math.max(0, Math.floor(scrollTop / lineHeight) - overscan)
    const visibleCount = Math.ceil(viewportHeight / lineHeight)
    const upperBound = totalLines > 0 ? totalLines : start + visibleCount + overscan * 2
    const end = Math.min(upperBound, start + visibleCount + overscan * 2)
    return { start, end }
  }, [totalLines, overscan])

  const setLineContent = useCallback((lineNumber: number, content: string) => {
    setEditedLines(prev => {
      const next = new Map(prev)
      next.set(lineNumber, content)
      return next
    })
  }, [])

  const clearEdits = useCallback(() => {
    setEditedLines(new Map())
  }, [])

  const getDirtyRanges = useCallback((): Array<{ startLine: number; endLine: number; content: string }> => {
    if (editedLines.size === 0) return []

    const sortedLineNums = Array.from(editedLines.keys()).sort((a, b) => a - b)
    const ranges: Array<{ startLine: number; endLine: number; content: string }> = []

    let rangeStart = sortedLineNums[0]
    let rangeLines: string[] = [editedLines.get(rangeStart) ?? '']
    let lastLine = rangeStart

    for (let i = 1; i < sortedLineNums.length; i++) {
      const lineNum = sortedLineNums[i]
      if (lineNum === lastLine + 1) {
        rangeLines.push(editedLines.get(lineNum) ?? '')
        lastLine = lineNum
      } else {
        ranges.push({
          startLine: rangeStart,
          endLine: lastLine + 1,
          content: rangeLines.join('\n'),
        })
        rangeStart = lineNum
        rangeLines = [editedLines.get(lineNum) ?? '']
        lastLine = lineNum
      }
    }

    ranges.push({
      startLine: rangeStart,
      endLine: lastLine + 1,
      content: rangeLines.join('\n'),
    })

    return ranges
  }, [editedLines])

  const saveEdits = useCallback(async () => {
    if (editedLines.size === 0) return

    setIsSaving(true)
    setSaveError(null)

    try {
      const dirtyRanges = getDirtyRanges()
      const patches: PatchOperation[] = dirtyRanges.map(range => ({
        type: 'replace' as const,
        startLine: range.startLine,
        endLine: range.endLine,
        content: range.content,
      }))

      const result = await applyFilePatches(filePath, patches)

      if (result.success) {
        clearEdits()
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to save edits')
      setSaveError(error)
      throw error
    } finally {
      setIsSaving(false)
    }
  }, [filePath, editedLines, getDirtyRanges, clearEdits])

  const prefetchAdjacent = useCallback((_visibleStart: number, visibleEnd: number) => {
    if (visibleEnd >= loadedEndLine - chunkSize && hasNextPage && !isFetchingNextPage) {
      fetchNextPage()
    }
  }, [loadedEndLine, chunkSize, hasNextPage, isFetchingNextPage, fetchNextPage])

  const loadAll = useCallback(async () => {
    if (!enabled || !filePath || totalLines === 0) return
    if (loadedEndLine >= totalLines) return

    let safety = 0
    const maxIterations = Math.ceil(totalLines / chunkSize) + 1
    while (safety < maxIterations) {
      const result = await fetchNextPage()
      const pages = result.data?.pages
      if (!pages?.length) break
      const lastPage = pages[pages.length - 1]
      if (!lastPage.hasMore || lastPage.endLine >= totalLines) break
      safety++
    }
  }, [enabled, filePath, totalLines, loadedEndLine, chunkSize, fetchNextPage])

  const isFullyLoaded = useMemo(() => {
    if (totalLines === 0) return false
    return loadedEndLine >= totalLines
  }, [totalLines, loadedEndLine])

  const fullContent = useMemo(() => {
    if (!isFullyLoaded || totalLines === 0) return null
    const result: string[] = []
    for (let i = 0; i < totalLines; i++) {
      const editedContent = editedLines.get(i)
      const lineData = lines.get(i)
      result.push(editedContent ?? lineData?.content ?? '')
    }
    return result.join('\n')
  }, [isFullyLoaded, totalLines, lines, editedLines])

  const hasUnsavedChanges = editedLines.size > 0
  const error = queryError ?? saveError

  return {
    lines,
    totalLines,
    isLoading,
    error,
    loadRange,
    getVisibleRange,
    editedLines,
    setLineContent,
    clearEdits,
    getDirtyRanges,
    saveEdits,
    isSaving,
    hasUnsavedChanges,
    prefetchAdjacent,
    loadAll,
    fullContent,
    isFullyLoaded,
  }
}
