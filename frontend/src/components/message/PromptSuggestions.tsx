import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Bot, FileText, Sparkles, Play, type LucideIcon } from 'lucide-react'
import { SWIPE_COMMIT_DISTANCE, useTouchTapSelect } from '@/hooks/useTouchTapSelect'
import type { MatchRange } from '@/lib/fuzzyMatch'

export type SuggestionKind = 'command' | 'agent' | 'skill' | 'file'

export interface PromptSuggestion<T> {
  key: string
  value: T
  kind: SuggestionKind
  label: string
  ranges: MatchRange[]
  detail?: string
  tag?: string
}

interface PromptSuggestionsProps<T> {
  isOpen: boolean
  items: PromptSuggestion<T>[]
  selectedIndex: number
  takeover: boolean
  onSelect: (value: T) => void
  onSwipeRight?: (value: T) => void
  onClose: () => void
}

const TAKEOVER_TOP_GAP_PX = 8
const TAKEOVER_MIN_HEIGHT_PX = 160

const KIND_ICONS: Partial<Record<SuggestionKind, LucideIcon>> = {
  agent: Bot,
  skill: Sparkles,
  file: FileText,
}

export function PromptSuggestions<T>({
  isOpen,
  items,
  selectedIndex,
  takeover,
  onSelect,
  onSwipeRight,
  onClose,
}: PromptSuggestionsProps<T>) {
  const listRef = useRef<HTMLDivElement>(null)
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const isVisible = isOpen && items.length > 0
  const takeoverHeight = useTakeoverHeight(listRef, isVisible && takeover)
  const toggleExpanded = useCallback((value: T) => {
    const key = items.find((item) => item.value === value)?.key ?? null
    setExpandedKey((current) => (current === key ? null : key))
    navigator.vibrate?.(10)
  }, [items])
  const touch = useTouchTapSelect(onSelect, { onSwipeRight, onLongPress: takeover ? toggleExpanded : undefined })

  useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (e: MouseEvent) => {
      if (listRef.current && !listRef.current.contains(e.target as Node)) {
        onClose()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen, onClose])

  useEffect(() => {
    if (!isVisible || !listRef.current) return
    const selectedItem = listRef.current.querySelector<HTMLElement>(`[data-index="${selectedIndex}"]`)
    selectedItem?.scrollIntoView?.({ block: 'nearest' })
  }, [selectedIndex, isVisible])

  useLayoutEffect(() => {
    if (!isVisible || !takeover || !listRef.current) return
    listRef.current.scrollTop = listRef.current.scrollHeight
  }, [isVisible, takeover, items])

  if (!isVisible) return null

  const rows = items.map((item, index) => {
    const isSelected = index === selectedIndex
    const isExpanded = item.key === expandedKey
    const swipeOffset = touch.swipe?.item === item.value ? touch.swipe.offset : 0
    const Icon = KIND_ICONS[item.kind]

    return (
      <div key={item.key} data-index={index} className={`relative overflow-hidden ${takeover ? 'rounded-xl' : ''}`}>
        {swipeOffset > 0 && (
          <div className={`absolute inset-0 flex items-center gap-2 pl-4 text-xs font-bold tracking-widest ${swipeOffset >= SWIPE_COMMIT_DISTANCE ? 'bg-success text-success-foreground' : 'bg-success/40 text-foreground'}`}>
            <Play className="w-4 h-4" />
            RUN
          </div>
        )}
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onTouchStart={(e) => touch.onTouchStart(e, item.value)}
          onTouchMove={(e) => touch.onTouchMove(e, item.value)}
          onTouchEnd={(e) => touch.onTouchEnd(e, item.value)}
          onClick={() => touch.onClick(item.value)}
          style={swipeOffset > 0 ? { transform: `translateX(${swipeOffset}px)` } : undefined}
          className={`relative w-full text-left flex gap-2 touch-pan-y select-none ${
            takeover ? 'min-h-[52px] px-3 py-2 items-center gap-3 rounded-xl border' : 'px-3 py-2 items-start'
          } ${
            isSelected
              ? takeover ? 'bg-primary/15 border-primary text-foreground' : 'bg-primary text-primary-foreground'
              : takeover ? 'bg-background border-transparent hover:bg-muted text-foreground' : 'hover:bg-muted text-foreground'
          }`}
        >
          {Icon && (
            <span className={takeover
              ? `grid place-items-center w-8 h-8 flex-shrink-0 rounded-lg border ${isSelected ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted border-border text-muted-foreground'}`
              : 'mt-0.5 flex-shrink-0 opacity-80'}
            >
              <Icon className="w-4 h-4" />
            </span>
          )}
          <span className="flex-1 min-w-0">
            <span className={`block font-mono font-medium truncate ${takeover ? 'text-base' : 'text-sm'}`}>
              {renderHighlighted(item.label, item.ranges)}
            </span>
            {item.detail && (
              <span className={`block text-xs opacity-70 mt-0.5 ${isExpanded ? 'whitespace-pre-wrap break-words' : 'truncate'}`}>
                {item.detail}
              </span>
            )}
          </span>
          {item.tag && (
            <span className="flex-shrink-0 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border border-border opacity-80">
              {item.tag}
            </span>
          )}
        </button>
      </div>
    )
  })

  if (takeover) {
    return (
      <div
        ref={listRef}
        data-testid="prompt-suggestions"
        style={{ height: takeoverHeight }}
        className="absolute bottom-full left-0 right-0 mb-2 z-50 overflow-y-auto overscroll-contain rounded-xl bg-background/95 backdrop-blur-md border border-border shadow-xl animate-prompt-takeover-rise"
      >
        <div className="min-h-full flex flex-col justify-end gap-0.5 p-1.5">
          {rows.reverse()}
        </div>
      </div>
    )
  }

  return (
    <div
      ref={listRef}
      data-testid="prompt-suggestions"
      className="absolute bottom-full left-0 right-0 mb-2 z-50 bg-background border border-border rounded-lg shadow-xl max-h-48 md:max-h-[40vh] lg:max-h-[50vh] overflow-y-auto"
    >
      {rows}
    </div>
  )
}

function renderHighlighted(label: string, ranges: MatchRange[]): ReactNode {
  if (ranges.length === 0) return label
  const parts: ReactNode[] = []
  let cursor = 0
  for (const [start, end] of ranges) {
    if (start > cursor) parts.push(label.slice(cursor, start))
    parts.push(
      <span key={start} className="font-bold underline decoration-2 underline-offset-2">
        {label.slice(start, end)}
      </span>,
    )
    cursor = end
  }
  if (cursor < label.length) parts.push(label.slice(cursor))
  return parts
}

function useTakeoverHeight(listRef: RefObject<HTMLDivElement | null>, enabled: boolean) {
  const [height, setHeight] = useState<number>(TAKEOVER_MIN_HEIGHT_PX)

  useLayoutEffect(() => {
    if (!enabled) return
    const anchor = listRef.current?.parentElement
    if (!anchor) return
    const boundary = findClippingAncestor(anchor)

    const measure = () => {
      const boundaryTop = boundary ? boundary.getBoundingClientRect().top : (window.visualViewport?.offsetTop ?? 0)
      const available = anchor.getBoundingClientRect().top - boundaryTop - TAKEOVER_TOP_GAP_PX
      setHeight(Math.max(TAKEOVER_MIN_HEIGHT_PX, available))
    }

    measure()
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    resizeObserver?.observe(anchor)
    if (boundary) resizeObserver?.observe(boundary)
    const viewport = window.visualViewport
    viewport?.addEventListener('resize', measure)
    viewport?.addEventListener('scroll', measure)
    return () => {
      resizeObserver?.disconnect()
      viewport?.removeEventListener('resize', measure)
      viewport?.removeEventListener('scroll', measure)
    }
  }, [enabled, listRef])

  return height
}

function findClippingAncestor(element: HTMLElement): HTMLElement | null {
  for (let current = element.parentElement; current; current = current.parentElement) {
    const { overflowY } = getComputedStyle(current)
    if (overflowY === 'hidden' || overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'clip') return current
  }
  return null
}
