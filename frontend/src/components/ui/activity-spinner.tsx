import { cn } from '@/lib/utils'

export const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const

const FRAME_INTERVAL_MS = 80
const CYCLE_DURATION = `${FRAME_INTERVAL_MS * SPINNER_FRAMES.length}ms`

const BRAILLE_BASE = 0x2800
const DOT_GRID: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [0, 1],
  [0, 2],
  [1, 0],
  [1, 1],
  [1, 2],
]
const COLUMN_X = [2.25, 6.75] as const
const ROW_Y = [4.25, 8, 11.75] as const
const DOT_RADIUS = 1.6
const LIT_DOT_OPACITY = 1
const UNLIT_DOT_OPACITY = 0.25

export function brailleDots(frame: string): boolean[] {
  const bits = (frame.codePointAt(0) ?? BRAILLE_BASE) - BRAILLE_BASE
  return DOT_GRID.map((_, index) => (bits & (1 << index)) !== 0)
}

const FRAME_DOTS = SPINNER_FRAMES.map(brailleDots)

const DOT_OPACITY_TIMELINES = DOT_GRID.map((_, index) =>
  FRAME_DOTS.map((dots) => (dots[index] ? LIT_DOT_OPACITY : UNLIT_DOT_OPACITY)),
)

export function ActivitySpinner({ className }: { className?: string }) {
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
          fillOpacity={DOT_OPACITY_TIMELINES[index][0]}
        >
          <animate
            attributeName="fill-opacity"
            values={DOT_OPACITY_TIMELINES[index].join(';')}
            dur={CYCLE_DURATION}
            calcMode="discrete"
            repeatCount="indefinite"
          />
        </circle>
      ))}
    </svg>
  )
}
