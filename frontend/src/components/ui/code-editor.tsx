import { useMemo, useRef, useEffect, forwardRef, useCallback, memo, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { computeScrollTopForRow } from '@/lib/editorScroll'

interface CodeEditorHighlight {
  startIndex: number
  endIndex: number
}

interface CodeEditorProps {
  value: string
  onChange: (value: string) => void
  highlights?: CodeEditorHighlight[]
  activeHighlightIndex?: number
  activeLine?: number | null
  revealNonce?: number
  autoFocus?: boolean
  disabled?: boolean
  placeholder?: string
  id?: string
  ariaLabel: string
  className?: string
}

const SURFACE_CLASS =
  'font-mono text-[16px] min-[769px]:text-sm leading-6 [tab-size:2] whitespace-pre-wrap [overflow-wrap:anywhere] py-2 pr-3 pl-10 [scrollbar-gutter:stable]'

interface RowHighlight {
  start: number
  end: number
  index: number
  first: boolean
}

const EMPTY_ROW_HIGHLIGHTS: RowHighlight[] = []

function lineNumberForOffset(lineStarts: number[], offset: number): number {
  let lo = 0
  let hi = lineStarts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (lineStarts[mid] <= offset) lo = mid
    else hi = mid - 1
  }
  return lo + 1
}

interface EditorRowProps {
  line: string
  lineNumber: number
  isActiveLine: boolean
  highlights: RowHighlight[]
  activeHighlightIndex?: number
}

const EditorRow = memo(function EditorRow({
  line,
  lineNumber,
  isActiveLine,
  highlights,
  activeHighlightIndex,
}: EditorRowProps) {
  return (
    <div data-line={lineNumber} className="relative">
      <span
        data-line-number
        className={cn(
          'pointer-events-none absolute -left-10 top-0 w-10 select-none pr-2 text-right',
          isActiveLine ? 'text-destructive font-semibold' : 'text-muted-foreground',
        )}
      >
        {lineNumber}
      </span>
      {isActiveLine && (
        <span
          data-active-line
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 -left-10 -right-3 bg-destructive/15"
        />
      )}
      {highlights.length === 0
        ? line.length > 0
          ? line
          : '\u200b'
        : highlights.map((h, i) => {
            const previous = i === 0 ? 0 : highlights[i - 1].end
            const nodes: ReactNode[] = []
            if (h.start > previous) {
              nodes.push(line.substring(previous, h.start))
            }
            nodes.push(
              <mark
                key={h.index}
                data-active-match={h.first && h.index === activeHighlightIndex ? 'true' : undefined}
                className={
                  h.index === activeHighlightIndex
                    ? 'rounded-sm bg-orange-400 text-black'
                    : 'rounded-sm bg-yellow-300/60 text-black'
                }
              >
                {line.substring(h.start, h.end)}
              </mark>,
            )
            if (i === highlights.length - 1 && h.end < line.length) {
              nodes.push(line.substring(h.end))
            }
            return <span key={`frag-${h.index}`}>{nodes}</span>
          })}
    </div>
  )
})

export const CodeEditor = forwardRef<HTMLTextAreaElement, CodeEditorProps>(function CodeEditor(
  {
    value,
    onChange,
    highlights,
    activeHighlightIndex,
    activeLine,
    revealNonce = 0,
    autoFocus,
    disabled,
    placeholder,
    id,
    ariaLabel,
    className,
  },
  ref,
) {
  const lines = useMemo(() => value.split('\n'), [value])

  const lineStarts = useMemo(() => {
    const starts: number[] = []
    let acc = 0
    for (const line of lines) {
      starts.push(acc)
      acc += line.length + 1
    }
    return starts
  }, [lines])

  const rowHighlights = useMemo<RowHighlight[][] | null>(() => {
    if (!highlights?.length) return null
    const buckets: RowHighlight[][] = lines.map(() => [])
    const ordered = highlights
      .map((h, index) => ({ startIndex: h.startIndex, endIndex: h.endIndex, index }))
      .sort((a, b) => a.startIndex - b.startIndex)
    let cursor = 0
    for (const highlight of ordered) {
      while (cursor < lines.length && lineStarts[cursor] + lines[cursor].length < highlight.startIndex) {
        cursor += 1
      }
      let line = cursor
      let isFirst = true
      while (line < lines.length) {
        const lineStart = lineStarts[line]
        if (lineStart > highlight.endIndex) break
        const lineEnd = lineStart + lines[line].length
        if (highlight.endIndex > lineStart && highlight.startIndex < lineEnd) {
          buckets[line].push({
            start: Math.max(highlight.startIndex, lineStart) - lineStart,
            end: Math.min(highlight.endIndex, lineEnd) - lineStart,
            index: highlight.index,
            first: isFirst,
          })
          isFirst = false
        }
        line += 1
      }
    }
    return buckets
  }, [highlights, lines, lineStarts])

  const hasHighlights = (highlights?.length ?? 0) > 0

  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const mirrorRef = useRef<HTMLDivElement | null>(null)

  const syncMirrorScroll = useCallback(() => {
    const textarea = textareaRef.current
    const mirror = mirrorRef.current
    if (!textarea || !mirror) return
    mirror.scrollTop = textarea.scrollTop
    mirror.scrollLeft = textarea.scrollLeft
  }, [])

  const combinedRef = useCallback(
    (node: HTMLTextAreaElement | null) => {
      textareaRef.current = node
      if (typeof ref === 'function') {
        ref(node)
      } else if (ref) {
        ref.current = node
      }
    },
    [ref],
  )

  const revealRange = useCallback((top: number, height: number) => {
    const textarea = textareaRef.current
    const mirror = mirrorRef.current
    if (!textarea || !mirror) return
    const next = computeScrollTopForRow({
      rowTop: top,
      rowHeight: height,
      viewportHeight: textarea.clientHeight,
      maxScrollTop: Math.max(0, textarea.scrollHeight - textarea.clientHeight),
    })
    textarea.scrollTop = next
    mirror.scrollTop = next
  }, [])

  const revealLine = useCallback((lineNumber: number) => {
    const mirror = mirrorRef.current
    const row = mirror?.querySelector<HTMLElement>(`[data-line="${lineNumber}"]`)
    if (!row) return
    revealRange(row.offsetTop, row.offsetHeight)
  }, [revealRange])

  const revealActiveMark = useCallback(() => {
    const mirror = mirrorRef.current
    const mark = mirror?.querySelector<HTMLElement>('mark[data-active-match="true"]')
    if (!mirror || !mark) return false
    const mirrorRect = mirror.getBoundingClientRect()
    const markRect = mark.getBoundingClientRect()
    revealRange(markRect.top - mirrorRect.top + mirror.scrollTop, markRect.height)
    return true
  }, [revealRange])

  useEffect(() => {
    if (activeLine == null) return
    revealLine(activeLine)
  }, [activeLine, revealNonce, revealLine])

  const activeHighlightStart =
    activeHighlightIndex == null ? null : highlights?.[activeHighlightIndex]?.startIndex ?? null

  const lineStartsRef = useRef(lineStarts)
  lineStartsRef.current = lineStarts

  useEffect(() => {
    if (activeHighlightStart == null) return
    if (revealActiveMark()) return
    revealLine(lineNumberForOffset(lineStartsRef.current, activeHighlightStart))
  }, [activeHighlightStart, revealNonce, revealLine, revealActiveMark])

  return (
    <div className={cn('relative h-full w-full overflow-hidden', className)}>
      <div
        ref={mirrorRef}
        aria-hidden="true"
        data-editor-mirror
        className={cn(
          'pointer-events-none absolute inset-0 overflow-hidden',
          SURFACE_CLASS,
          hasHighlights ? 'text-foreground' : 'text-transparent',
        )}
      >
        {lines.map((line, index) => (
          <EditorRow
            key={index}
            line={line}
            lineNumber={index + 1}
            isActiveLine={activeLine === index + 1}
            highlights={rowHighlights?.[index] ?? EMPTY_ROW_HIGHLIGHTS}
            activeHighlightIndex={activeHighlightIndex}
          />
        ))}
      </div>
      <textarea
        id={id}
        ref={combinedRef}
        aria-label={ariaLabel}
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onScroll={syncMirrorScroll}
        className={cn(
          'absolute inset-0 h-full w-full resize-none border-0 bg-transparent outline-none',
          SURFACE_CLASS,
          hasHighlights ? 'text-transparent caret-foreground' : undefined,
        )}
      />
    </div>
  )
})
