import { useRef, useCallback, useEffect, useState, useMemo, forwardRef, useImperativeHandle, memo } from 'react'
import { useVirtualizedContent } from '@/hooks/useVirtualizedContent'
import { useMobile } from '@/hooks/useMobile'
import { GPU_ACCELERATED_STYLE } from '@/lib/utils'

interface VirtualizedTextViewProps {
  filePath: string
  totalLines?: number
  lineHeight?: number
  editable?: boolean
  onSaveStateChange?: (hasUnsavedChanges: boolean) => void
  onSave?: () => void
  className?: string
  initialLineNumber?: number
  lineWrap?: boolean
  onContentLoaded?: (content: string) => void
}

export interface VirtualizedTextViewHandle {
  save: () => Promise<void>
  loadAll: () => Promise<void>
  getFullContent: () => string | null
  isFullyLoaded: () => boolean
}

const LINE_HEIGHT = 20
const GUTTER_WIDTH = 48
const CHAR_WIDTH_ESTIMATE = 8.5
const CONTENT_PADDING = 24

let measureCanvas: HTMLCanvasElement | null = null
let measureContext: CanvasRenderingContext2D | null = null

function getTextWidth(text: string): number {
  if (!measureCanvas) {
    measureCanvas = document.createElement('canvas')
    measureContext = measureCanvas.getContext('2d')
    if (measureContext) {
      measureContext.font = '14px ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace'
    }
  }
  if (measureContext) {
    return measureContext.measureText(text).width
  }
  return text.length * CHAR_WIDTH_ESTIMATE
}

function calculateWrappedLineCount(
  content: string,
  containerWidth: number
): number {
  if (!content || containerWidth <= GUTTER_WIDTH + CONTENT_PADDING) return 1
  const availableWidth = containerWidth - GUTTER_WIDTH - CONTENT_PADDING
  const textWidth = getTextWidth(content)
  return Math.max(1, Math.ceil(textWidth / availableWidth))
}

interface VirtualizedLineProps {
  lineNum: number
  content: string
  isEdited: boolean
  height: number
  top: number
  isHighlighted: boolean
  lineHeight: number
  editable: boolean
  lineWrap: boolean
  isLoaded: boolean
  onLineChange: (lineNum: number, value: string) => void
}

const VirtualizedLine = memo(function VirtualizedLine({
  lineNum,
  content,
  isEdited,
  height,
  top,
  isHighlighted,
  lineHeight,
  editable,
  lineWrap,
  isLoaded,
  onLineChange,
}: VirtualizedLineProps) {
  return (
    <div
      className={`absolute flex overflow-hidden ${isHighlighted ? 'bg-yellow-500/30' : 'bg-background'}`}
      style={{
        transform: `translate3d(0, ${top}px, 0)`,
        height,
        left: 0,
        right: 0,
      }}
    >
      <div
        className="flex-shrink-0 text-center text-muted-foreground select-none bg-muted/50 border-r border-border self-start"
        style={{ width: GUTTER_WIDTH, height: lineHeight, lineHeight: `${lineHeight}px` }}
      >
        {lineNum + 1}
      </div>
      
      {!isLoaded ? (
        <div 
          className="flex-1 pl-2 bg-muted/30 animate-pulse"
          style={{ lineHeight: `${lineHeight}px` }}
        >
          <div className="h-3 w-3/4 bg-muted/50 rounded my-1" />
        </div>
      ) : editable ? (
        <input
          type="text"
          value={content}
          onChange={(e) => onLineChange(lineNum, e.target.value)}
          className={`flex-1 bg-transparent outline-none pl-2 text-[16px] md:text-sm ${
            isEdited ? 'bg-yellow-500/10' : ''
          } ${
            lineWrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre'
          }`}
          style={{ lineHeight: `${lineHeight}px` }}
        />
      ) : (
        <div
          className={`flex-1 pl-2 ${
            lineWrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre overflow-hidden text-ellipsis'
          }`}
          style={{ lineHeight: `${lineHeight}px` }}
        >
          {content}
        </div>
      )}
    </div>
  )
})

export const VirtualizedTextView = forwardRef<VirtualizedTextViewHandle, VirtualizedTextViewProps>(function VirtualizedTextView({
  filePath,
  totalLines: initialTotalLines = 0,
  lineHeight = LINE_HEIGHT,
  editable = false,
  onSaveStateChange,
  onSave,
  className = '',
  initialLineNumber,
  lineWrap = false,
  onContentLoaded,
}, ref) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(600)
  const [containerWidth, setContainerWidth] = useState(0)
  const [highlightedLine, setHighlightedLine] = useState<number | undefined>(initialLineNumber)
  const heightCacheRef = useRef<Map<number, number>>(new Map())
  const lineOffsetsRef = useRef<{ offsets: Map<number, { height: number; top: number }>; totalHeight: number } | null>(null)
  const lastContainerWidthRef = useRef(0)
  const lastTotalLinesRef = useRef(0)
  const scrollRafRef = useRef<number | null>(null)
  const isMobile = useMobile()
  
  const chunkSize = isMobile && lineWrap ? 1500 : 1000
  const overscan = isMobile && lineWrap ? 200 : 100
  
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
    loadAll,
    fullContent,
    isFullyLoaded,
  } = useVirtualizedContent({
    filePath,
    chunkSize,
    overscan,
    enabled: true,
    initialTotalLines,
  })
  
  useEffect(() => {
    onSaveStateChange?.(hasUnsavedChanges)
  }, [hasUnsavedChanges, onSaveStateChange])
  
  useEffect(() => {
    if (isFullyLoaded && fullContent && onContentLoaded) {
      onContentLoaded(fullContent)
    }
  }, [isFullyLoaded, fullContent, onContentLoaded])
  
  useEffect(() => {
    heightCacheRef.current.clear()
    lineOffsetsRef.current = null
  }, [filePath])
  
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setViewportHeight(entry.contentRect.height)
        const newWidth = entry.contentRect.width
        if (newWidth !== containerWidth) {
          heightCacheRef.current.clear()
          setContainerWidth(newWidth)
        }
      }
    })
    
    resizeObserver.observe(container)
    return () => resizeObserver.disconnect()
  }, [containerWidth])
  
  const lineOffsets = useMemo(() => {
    if (!lineWrap || containerWidth === 0) return null
    
    const widthChanged = lastContainerWidthRef.current !== containerWidth
    const totalLinesChanged = lastTotalLinesRef.current !== totalLines
    
    if (widthChanged) {
      heightCacheRef.current.clear()
      lineOffsetsRef.current = null
    }
    
    lastContainerWidthRef.current = containerWidth
    lastTotalLinesRef.current = totalLines
    
    const offsets = new Map<number, { height: number; top: number }>()
    const cache = heightCacheRef.current
    let cumulativeTop = 0
    let hasChanges = false
    
    for (let i = 0; i < totalLines; i++) {
      const editedContent = editedLines.get(i)
      const lineData = lines.get(i)
      const content = editedContent ?? lineData?.content ?? ''
      
      let height: number
      
      if (cache.has(i)) {
        height = cache.get(i)!
      } else if (content) {
        const wrappedCount = calculateWrappedLineCount(content, containerWidth)
        height = wrappedCount * lineHeight
        cache.set(i, height)
        hasChanges = true
      } else {
        height = lineHeight
      }
      
      offsets.set(i, { height, top: cumulativeTop })
      cumulativeTop += height
    }
    
    if (!hasChanges && !totalLinesChanged && lineOffsetsRef.current) {
      return lineOffsetsRef.current
    }
    
    const result = { offsets, totalHeight: cumulativeTop }
    lineOffsetsRef.current = result
    return result
  }, [lineWrap, containerWidth, totalLines, lines, editedLines, lineHeight])
  
  const displayLineCount = totalLines > 0 ? totalLines : chunkSize
  const totalHeight = lineOffsets?.totalHeight ?? displayLineCount * lineHeight
  
  const lineOffsetsForCalcRef = useRef(lineOffsets)
  lineOffsetsForCalcRef.current = lineOffsets
  
  const calculateVisibleRange = useCallback((scrollTop: number) => {
    const currentLineOffsets = lineOffsetsForCalcRef.current
    if (currentLineOffsets && totalLines > 0) {
      const searchTop = scrollTop - overscan * lineHeight
      const searchBottom = scrollTop + viewportHeight + overscan * lineHeight
      
      let low = 0
      let high = totalLines - 1
      let startLine = 0
      
      while (low <= high) {
        const mid = Math.floor((low + high) / 2)
        const offset = currentLineOffsets.offsets.get(mid)
        if (!offset) break
        
        if (offset.top + offset.height < searchTop) {
          low = mid + 1
        } else {
          startLine = mid
          high = mid - 1
        }
      }
      
      low = startLine
      high = totalLines - 1
      let endLine = totalLines
      
      while (low <= high) {
        const mid = Math.floor((low + high) / 2)
        const offset = currentLineOffsets.offsets.get(mid)
        if (!offset) break
        
        if (offset.top <= searchBottom) {
          low = mid + 1
        } else {
          endLine = mid
          high = mid - 1
        }
      }
      
      return { start: Math.max(0, startLine), end: Math.min(totalLines, endLine) }
    }
    
    return getVisibleRange(scrollTop, viewportHeight, lineHeight)
  }, [viewportHeight, lineHeight, getVisibleRange, totalLines, overscan])
  
  const visibleRange = useMemo(() => {
    return calculateVisibleRange(scrollTop)
  }, [calculateVisibleRange, scrollTop])
  
  useEffect(() => {
    const { start, end } = visibleRange
    if (start >= end) return
    loadRange(start, end)
  }, [visibleRange, loadRange])
  
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const newScrollTop = e.currentTarget.scrollTop
    
    if (scrollRafRef.current) {
      cancelAnimationFrame(scrollRafRef.current)
    }
    
    scrollRafRef.current = requestAnimationFrame(() => {
      setScrollTop(newScrollTop)
    })
  }, [])
  
  const handleLineChange = useCallback((lineNum: number, value: string) => {
    setLineContent(lineNum, value)
  }, [setLineContent])
  
  const handleSave = useCallback(async () => {
    try {
      await saveEdits()
      onSave?.()
    } catch {
      void 0
    }
  }, [saveEdits, onSave])
  
  useImperativeHandle(ref, () => ({
    save: handleSave,
    loadAll,
    getFullContent: () => fullContent,
    isFullyLoaded: () => isFullyLoaded,
  }), [handleSave, loadAll, fullContent, isFullyLoaded])
  
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault()
      if (hasUnsavedChanges && !isSaving) {
        handleSave()
      }
    }
  }, [hasUnsavedChanges, isSaving, handleSave])
  
  useEffect(() => {
    if (initialLineNumber && containerRef.current) {
      const offsetData = lineOffsets?.offsets.get(initialLineNumber - 1)
      const scrollPosition = offsetData?.top ?? (initialLineNumber - 1) * lineHeight
      setHighlightedLine(initialLineNumber)
      setTimeout(() => {
        containerRef.current?.scrollTo({ top: scrollPosition, behavior: 'smooth' })
      }, 100)
      setTimeout(() => {
        setHighlightedLine(undefined)
      }, 3000)
    }
  }, [initialLineNumber, lineHeight, lineOffsets])
  
  const visibleLines = useMemo(() => {
    const result: Array<{ lineNum: number; content: string; isEdited: boolean; height: number; top: number; isLoaded: boolean }> = []
    const upperBound = totalLines > 0 ? totalLines : visibleRange.end
    
    for (let i = visibleRange.start; i < Math.min(visibleRange.end, upperBound); i++) {
      const editedContent = editedLines.get(i)
      const lineData = lines.get(i)
      const isLoaded = lineData?.loaded === true || editedContent !== undefined
      const content = editedContent ?? lineData?.content ?? ''
      
      const offsetData = lineOffsets?.offsets.get(i)
      const height = offsetData?.height ?? lineHeight
      const top = offsetData?.top ?? i * lineHeight
      
      result.push({
        lineNum: i,
        content: isLoaded ? content : '',
        isEdited: editedContent !== undefined,
        height,
        top,
        isLoaded,
      })
    }
    
    return result
  }, [visibleRange, lines, editedLines, lineOffsets, lineHeight, totalLines])
  
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
      className={`relative font-mono text-sm bg-background ${className} ${
        lineWrap ? 'overflow-x-hidden overflow-y-auto' : 'overflow-auto'
      }`}
      onScroll={handleScroll}
      onKeyDown={handleKeyDown}
      style={{ height: '100%', ...GPU_ACCELERATED_STYLE }}
    >
      <div style={{ height: totalHeight, position: 'relative' }} className="bg-background">
        {visibleLines.map(({ lineNum, content, isEdited, height, top, isLoaded }) => (
          <VirtualizedLine
            key={lineNum}
            lineNum={lineNum}
            content={content}
            isEdited={isEdited}
            height={height}
            top={top}
            isHighlighted={highlightedLine === lineNum + 1}
            lineHeight={lineHeight}
            editable={editable}
            lineWrap={lineWrap}
            isLoaded={isLoaded}
            onLineChange={handleLineChange}
          />
        ))}
        
        {visibleLines.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground bg-background">
            {isLoading ? 'Loading...' : 'No content'}
          </div>
        )}
        
        {isLoading && visibleLines.length > 0 && (
          <div className="absolute top-2 right-2 px-2 py-1 bg-muted/80 rounded text-xs text-muted-foreground">
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
})
