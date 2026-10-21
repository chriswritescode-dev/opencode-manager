import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { cn } from '@/lib/utils'

export type ScannerTone = 'info' | 'primary' | 'warning' | 'muted-foreground'

export const SCANNER_REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

const SCANNER_SEGMENT_WIDTH = 4
const SCANNER_SEGMENT_GAP = 2
const SCANNER_SEGMENT_PITCH = SCANNER_SEGMENT_WIDTH + SCANNER_SEGMENT_GAP
const SCANNER_MIN_SEGMENTS = 12

const SCANNER_SEGMENT_CLASS = 'w-1 h-2 rounded-[1px] transition-colors duration-75'

const SCANNER_TONE_TIERS: Record<ScannerTone, readonly [string, string, string, string]> = {
  info: ['bg-info', 'bg-info/70', 'bg-info/40', 'bg-info/20'],
  primary: ['bg-primary', 'bg-primary/70', 'bg-primary/40', 'bg-primary/20'],
  warning: ['bg-warning', 'bg-warning/70', 'bg-warning/40', 'bg-warning/20'],
  'muted-foreground': ['bg-muted-foreground', 'bg-muted-foreground/70', 'bg-muted-foreground/40', 'bg-muted-foreground/20'],
}

const SCANNER_STATIC_TONE_CLASS: Record<ScannerTone, string> = {
  info: 'bg-info/60',
  primary: 'bg-primary/60',
  warning: 'bg-warning/60',
  'muted-foreground': 'bg-muted-foreground/60',
}

const SCANNER_OFF_CLASS = 'bg-muted/20'
const SCANNER_INTENSITY_THRESHOLDS = [0.8, 0.5, 0.2] as const
const SCANNER_FAINTEST_TIER = SCANNER_INTENSITY_THRESHOLDS.length

/**
 * Returns how many fixed-width segments fit into `width`: each segment is 4px wide and the
 * container adds a 2px gap between neighbors, so `n` segments occupy `6n - 2` pixels. Never
 * drops below `SCANNER_MIN_SEGMENTS` so an unmeasured container still renders a usable scanner.
 */
export function scannerSegmentCountForWidth(width: number): number {
  return Math.max(SCANNER_MIN_SEGMENTS, Math.floor((width + SCANNER_SEGMENT_GAP) / SCANNER_SEGMENT_PITCH))
}

/**
 * Tracks the content width of a container across resizes. Returns 0 until the first measurement.
 */
function useContainerWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) {
      return
    }

    const update = (next: number) => setWidth((previous) => (previous === next ? previous : next))
    update(element.getBoundingClientRect().width)

    if (typeof ResizeObserver === 'undefined') {
      return
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) {
        update(entry.contentRect.width)
      }
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])

  return width
}

interface ScannerSegmentClassOptions {
  index: number
  position: number
  litWidth: number
  tone: ScannerTone
  static?: boolean
}

/**
 * Returns the background class for one scanner segment. Segments within the lit window fade out
 * with distance from the window center across four intensity tiers; everything outside the window
 * stays muted. `static` skips the window math and renders the uniform reduced-motion tint.
 */
export function scannerSegmentClass({
  index,
  position,
  litWidth,
  tone,
  static: isStatic = false,
}: ScannerSegmentClassOptions): string {
  if (isStatic) {
    return SCANNER_STATIC_TONE_CLASS[tone]
  }

  const halfWidth = litWidth / 2
  const distance = Math.abs(index - (position + halfWidth))

  if (distance > halfWidth + 1) {
    return SCANNER_OFF_CLASS
  }

  const intensity = Math.max(0, 1 - distance / (halfWidth + 2))
  const tier = SCANNER_INTENSITY_THRESHOLDS.findIndex((threshold) => intensity > threshold)

  return SCANNER_TONE_TIERS[tone][tier === -1 ? SCANNER_FAINTEST_TIER : tier]
}

interface ScannerPositionOptions {
  segmentCount: number
  litWidth: number
  intervalMs: number
  paused: boolean
}

function useScannerPosition({
  segmentCount,
  litWidth,
  intervalMs,
  paused,
}: ScannerPositionOptions): number {
  const [position, setPosition] = useState(0)
  const direction = useRef(1)
  const maxPosition = Math.max(0, segmentCount - litWidth)

  useLayoutEffect(() => {
    setPosition((previous) => Math.min(previous, maxPosition))
  }, [maxPosition])

  useLayoutEffect(() => {
    if (paused || maxPosition === 0) {
      return
    }

    const interval = setInterval(() => {
      setPosition((previous) => {
        const next = previous + direction.current
        if (next >= maxPosition) {
          direction.current = -1
          return maxPosition
        }
        if (next <= 0) {
          direction.current = 1
          return 0
        }
        return next
      })
    }, intervalMs)

    return () => clearInterval(interval)
  }, [paused, maxPosition, intervalMs])

  return position
}

interface ScannerBarsProps {
  tone: ScannerTone
  segmentCount?: number
  litWidth?: number
  intervalMs?: number
  className?: string
}

/**
 * Segmented scanner matching the session status scanner: 4x8px segments with a 2px gap and a lit
 * window of `litWidth` segments that sweeps back and forth. Without an explicit `segmentCount` the
 * count is measured from the container width so the strip spans the space it is given. Under
 * `prefers-reduced-motion: reduce` the sweep is not started and every segment renders statically at
 * 60% opacity.
 */
export function ScannerBars({
  tone,
  segmentCount,
  litWidth = 6,
  intervalMs = 60,
  className,
}: ScannerBarsProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const reducedMotion = useMediaQuery(SCANNER_REDUCED_MOTION_QUERY)
  const measuredWidth = useContainerWidth(containerRef)
  const resolvedCount = segmentCount ?? scannerSegmentCountForWidth(measuredWidth)
  const position = useScannerPosition({
    segmentCount: resolvedCount,
    litWidth,
    intervalMs,
    paused: reducedMotion,
  })

  return (
    <div ref={containerRef} className={cn('flex w-full items-center gap-0.5', className)}>
      {Array.from({ length: resolvedCount }, (_, index) => (
        <div
          key={index}
          className={cn(
            SCANNER_SEGMENT_CLASS,
            scannerSegmentClass({ index, position, litWidth, tone, static: reducedMotion }),
          )}
        />
      ))}
    </div>
  )
}
