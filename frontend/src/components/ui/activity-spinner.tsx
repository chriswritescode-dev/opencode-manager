import { useSyncExternalStore } from 'react'
import { cn } from '@/lib/utils'

export const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const

const FRAME_INTERVAL_MS = 80

const BRAILLE_BASE = 0x2800
const DOT_GRID: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [0, 1],
  [0, 2],
  [1, 0],
  [1, 1],
  [1, 2],
  [0, 3],
  [1, 3],
]
const COLUMN_X = [2.25, 6.75] as const
const ROW_Y = [2.25, 6, 9.75, 13.5] as const
const DOT_RADIUS = 1.6
const UNLIT_DOT_OPACITY = 0.25

let frameIndex = 0
const listeners = new Set<() => void>()
let ticker: ReturnType<typeof setInterval> | null = null

function emit() {
  for (const listener of listeners) {
    listener()
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (ticker === null) {
    ticker = setInterval(() => {
      frameIndex = (frameIndex + 1) % SPINNER_FRAMES.length
      emit()
    }, FRAME_INTERVAL_MS)
  }

  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && ticker !== null) {
      clearInterval(ticker)
      ticker = null
      frameIndex = 0
    }
  }
}

function getSnapshot() {
  return frameIndex
}

/**
 * Decodes one braille frame into its eight dot positions, ordered by braille dot numbering:
 * dot1, dot2 and dot3 are the left column top-to-bottom, dot4, dot5 and dot6 the right column
 * top-to-bottom, and dot7 and dot8 the bottom-left and bottom-right cells.
 */
export function brailleDots(frame: string): boolean[] {
  const bits = (frame.codePointAt(0) ?? BRAILLE_BASE) - BRAILLE_BASE
  return DOT_GRID.map((_, index) => (bits & (1 << index)) !== 0)
}

/**
 * Braille spinner mirroring the OpenCode TUI activity spinner as an inline SVG cell so the dots
 * stay visible at small text sizes. Every mounted instance shares one module-level 80 ms ticker,
 * which starts with the first subscriber and stops with the last. It animates regardless of
 * `prefers-reduced-motion`: a still frame is indistinguishable from a stalled spinner, and the
 * motion is a small in-place status cue like the platform activity indicators.
 */
export function ActivitySpinner({ className }: { className?: string }) {
  const frame = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const dots = brailleDots(SPINNER_FRAMES[frame])

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 9 16"
      className={cn('inline-block h-4 w-[9px] shrink-0', className)}
    >
      {DOT_GRID.map(([column, row], index) => (
        <circle
          key={index}
          cx={COLUMN_X[column]}
          cy={ROW_Y[row]}
          r={DOT_RADIUS}
          fill="currentColor"
          fillOpacity={dots[index] ? 1 : UNLIT_DOT_OPACITY}
        />
      ))}
    </svg>
  )
}
