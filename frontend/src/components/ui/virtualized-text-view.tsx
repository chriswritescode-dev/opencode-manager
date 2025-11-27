import { useRef, useCallback, useEffect, useState, useMemo } from 'react'
import { useVirtualizedContent } from '@/hooks/useVirtualizedContent'

interface VirtualizedTextViewProps {
  filePath: string
  totalLines?: number
  lineHeight?: number
  editable?: boolean
  onSaveStateChange?: (hasUnsavedChanges: boolean) => void
  onSave?: () => void
  className?: string
}

const LINE_HEIGHT = 20
const GUTTER_WIDTH = 60

export function VirtualizedTextView({
  filePath,
  totalLines: initialTotalLines = 0,
  lineHeight = LINE_HEIGHT,
  editable = false,
  onSaveStateChange,
  onSave,
  className = '',
}: VirtualizedTextViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(600)
  
  const {
    lines,
    totalLines,
    isLoading,
    error,
    loadRange,
    getVisibleRange,
    editedLines,
    setLineContent,
    saveEdits,
    isSaving,
    hasUnsavedChanges,
    prefetchAdjacent,
  } = useVirtualizedContent({
    filePath,
    chunkSize: 200,
    overscan: 50,
    enabled: true,
    initialTotalLines,
  })
  
  useEffect(() => {
    onSaveStateChange?.(hasUnsavedChanges)
  }, [hasUnsavedChanges, onSaveStateChange])
  
  const visibleRange = useMemo(() => {
    return getVisibleRange(scrollTop, viewportHeight, lineHeight)
  }, [scrollTop, viewportHeight, lineHeight, getVisibleRange])
  
  useEffect(() => {
    const { start, end } = visibleRange
    loadRange(start, end)
    prefetchAdjacent(start, end)
  }, [visibleRange, loadRange, prefetchAdjacent])
  
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setViewportHeight(entry.contentRect.height)
      }
    })
    
    resizeObserver.observe(container)
    return () => resizeObserver.disconnect()
  }, [])
  
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop)
  }, [])
  
  const handleLineChange = useCallback((lineNum: number, value: string) => {
    setLineContent(lineNum, value)
  }, [setLineContent])
  
  const handleSave = useCallback(async () => {
    try {
      await saveEdits()
      onSave?.()
    } catch (err) {
      console.error('Failed to save:', err)
    }
  }, [saveEdits, onSave])
  
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault()
      if (hasUnsavedChanges && !isSaving) {
        handleSave()
      }
    }
  }, [hasUnsavedChanges, isSaving, handleSave])
  
  const totalHeight = totalLines * lineHeight
  
  const visibleLines = useMemo(() => {
    const result: Array<{ lineNum: number; content: string; isEdited: boolean }> = []
    
    for (let i = visibleRange.start; i < visibleRange.end; i++) {
      const editedContent = editedLines.get(i)
      const lineData = lines.get(i)
      
      result.push({
        lineNum: i,
        content: editedContent ?? lineData?.content ?? '',
        isEdited: editedContent !== undefined,
      })
    }
    
    return result
  }, [visibleRange, lines, editedLines])
  
  if (error) {
    return (
      <div className="p-4 text-destructive">
        Error loading file: {error.message}
      </div>
    )
  }
  
  return (
    <div
      ref={containerRef}
      className={`relative overflow-auto font-mono text-sm ${className}`}
      onScroll={handleScroll}
      onKeyDown={handleKeyDown}
      style={{ height: '100%' }}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        {visibleLines.map(({ lineNum, content, isEdited }) => (
          <div
            key={lineNum}
            className="absolute flex"
            style={{
              top: lineNum * lineHeight,
              height: lineHeight,
              left: 0,
              right: 0,
            }}
          >
            <div
              className="flex-shrink-0 text-right pr-3 text-muted-foreground select-none bg-muted/50 border-r border-border"
              style={{ width: GUTTER_WIDTH }}
            >
              {lineNum + 1}
            </div>
            
            {editable ? (
              <input
                type="text"
                value={content}
                onChange={(e) => handleLineChange(lineNum, e.target.value)}
                className={`flex-1 bg-transparent outline-none pl-2 ${
                  isEdited ? 'bg-yellow-500/10' : ''
                }`}
                style={{ lineHeight: `${lineHeight}px` }}
              />
            ) : (
              <div
                className="flex-1 pl-2 whitespace-pre overflow-hidden text-ellipsis"
                style={{ lineHeight: `${lineHeight}px` }}
              >
                {content}
              </div>
            )}
          </div>
        ))}
        
        {isLoading && visibleLines.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
            Loading...
          </div>
        )}
      </div>
      
      {hasUnsavedChanges && (
        <div className="sticky bottom-2 right-2 flex justify-end pointer-events-none">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="pointer-events-auto px-3 py-1 bg-primary text-primary-foreground rounded text-xs font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            {isSaving ? 'Saving...' : 'Save Changes (Ctrl+S)'}
          </button>
        </div>
      )}
    </div>
  )
}
