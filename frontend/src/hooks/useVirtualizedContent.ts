import { useState, useCallback, useRef, useEffect } from 'react'
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
  loadRange: (startLine: number, endLine: number) => Promise<void>
  getVisibleRange: (scrollTop: number, viewportHeight: number, lineHeight: number) => { start: number; end: number }
  editedLines: Map<number, string>
  setLineContent: (lineNumber: number, content: string) => void
  clearEdits: () => void
  getDirtyRanges: () => Array<{ startLine: number; endLine: number; content: string }>
  saveEdits: () => Promise<void>
  isSaving: boolean
  hasUnsavedChanges: boolean
  prefetchAdjacent: (visibleStart: number, visibleEnd: number) => void
}

export function useVirtualizedContent({
  filePath,
  chunkSize = 200,
  overscan = 50,
  enabled = true,
  initialTotalLines = 0,
}: UseVirtualizedContentOptions): UseVirtualizedContentReturn {
  const [lines, setLines] = useState<Map<number, LineData>>(new Map())
  const [totalLines, setTotalLines] = useState(initialTotalLines)
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [editedLines, setEditedLines] = useState<Map<number, string>>(new Map())
  
  const loadingRanges = useRef<Set<string>>(new Set())
  const loadedRanges = useRef<Array<{ start: number; end: number }>>([])
  
  const isRangeLoaded = useCallback((start: number, end: number): boolean => {
    for (const range of loadedRanges.current) {
      if (range.start <= start && range.end >= end) {
        return true
      }
    }
    return false
  }, [])
  
  const mergeRanges = useCallback(() => {
    if (loadedRanges.current.length <= 1) return
    
    loadedRanges.current.sort((a, b) => a.start - b.start)
    const merged: Array<{ start: number; end: number }> = []
    let current = loadedRanges.current[0]
    
    for (let i = 1; i < loadedRanges.current.length; i++) {
      const next = loadedRanges.current[i]
      if (next.start <= current.end + 1) {
        current = { start: current.start, end: Math.max(current.end, next.end) }
      } else {
        merged.push(current)
        current = next
      }
    }
    merged.push(current)
    loadedRanges.current = merged
  }, [])
  
  const loadRange = useCallback(async (startLine: number, endLine: number) => {
    if (!enabled || !filePath) return
    
    const rangeKey = `${startLine}-${endLine}`
    if (loadingRanges.current.has(rangeKey)) return
    if (isRangeLoaded(startLine, endLine)) return
    
    loadingRanges.current.add(rangeKey)
    setIsLoading(true)
    setError(null)
    
    try {
      const result = await fetchFileRange(filePath, startLine, endLine)
      
      setTotalLines(result.totalLines)
      setLines(prev => {
        const next = new Map(prev)
        result.lines.forEach((content, idx) => {
          const lineNum = result.startLine + idx
          next.set(lineNum, { content, loaded: true })
        })
        return next
      })
      
      loadedRanges.current.push({ start: result.startLine, end: result.endLine })
      mergeRanges()
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to load file range'))
    } finally {
      loadingRanges.current.delete(rangeKey)
      setIsLoading(false)
    }
  }, [enabled, filePath, isRangeLoaded, mergeRanges])
  
  const prefetchAdjacent = useCallback((visibleStart: number, visibleEnd: number) => {
    const prefetchBefore = Math.max(0, visibleStart - chunkSize)
    const prefetchAfter = Math.min(totalLines, visibleEnd + chunkSize)
    
    if (!isRangeLoaded(prefetchBefore, visibleStart) && prefetchBefore < visibleStart) {
      loadRange(prefetchBefore, visibleStart)
    }
    
    if (!isRangeLoaded(visibleEnd, prefetchAfter) && prefetchAfter > visibleEnd) {
      loadRange(visibleEnd, prefetchAfter)
    }
  }, [chunkSize, totalLines, isRangeLoaded, loadRange])
  
  const getVisibleRange = useCallback((scrollTop: number, viewportHeight: number, lineHeight: number) => {
    const start = Math.max(0, Math.floor(scrollTop / lineHeight) - overscan)
    const visibleCount = Math.ceil(viewportHeight / lineHeight)
    const end = Math.min(totalLines, start + visibleCount + overscan * 2)
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
    let rangeLines: string[] = [editedLines.get(rangeStart)!]
    let lastLine = rangeStart
    
    for (let i = 1; i < sortedLineNums.length; i++) {
      const lineNum = sortedLineNums[i]
      if (lineNum === lastLine + 1) {
        rangeLines.push(editedLines.get(lineNum)!)
        lastLine = lineNum
      } else {
        ranges.push({
          startLine: rangeStart,
          endLine: lastLine + 1,
          content: rangeLines.join('\n'),
        })
        rangeStart = lineNum
        rangeLines = [editedLines.get(lineNum)!]
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
    setError(null)
    
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
        setTotalLines(result.totalLines)
        
        setLines(prev => {
          const next = new Map(prev)
          editedLines.forEach((content, lineNum) => {
            next.set(lineNum, { content, loaded: true })
          })
          return next
        })
        
        clearEdits()
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to save edits'))
      throw err
    } finally {
      setIsSaving(false)
    }
  }, [filePath, editedLines, getDirtyRanges, clearEdits])
  
  useEffect(() => {
    if (enabled && filePath && totalLines === 0) {
      loadRange(0, chunkSize)
    }
  }, [enabled, filePath, totalLines, chunkSize, loadRange])
  
  useEffect(() => {
    setLines(new Map())
    setEditedLines(new Map())
    setTotalLines(initialTotalLines)
    loadedRanges.current = []
    loadingRanges.current.clear()
  }, [filePath, initialTotalLines])
  
  const hasUnsavedChanges = editedLines.size > 0
  
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
  }
}
