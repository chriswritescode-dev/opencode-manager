import { cn } from '@/lib/utils'

export type ScannerTone = 'info' | 'primary' | 'warning' | 'muted-foreground'

const SCANNER_TONE_CLASS: Record<ScannerTone, string> = {
  info: 'text-info',
  primary: 'text-primary',
  warning: 'text-warning',
  'muted-foreground': 'text-muted-foreground',
}

interface ScannerBarsProps {
  tone: ScannerTone
  className?: string
}

/**
 * Segmented scanner: a masked track of 4x8px cells with a 2px gap where only a lit window is
 * visible. The window is brightest at its center and fades out cell by cell toward both edges as it
 * sweeps from edge to edge and back. The mask, gradient and sweep live in `index.css`, so the
 * animation advances in the browser with no JavaScript and no React render per frame. Like the
 * braille activity spinner it animates regardless of `prefers-reduced-motion`, because a still
 * indicator is indistinguishable from a stalled one.
 */
export function ScannerBars({ tone, className }: ScannerBarsProps) {
  return (
    <div
      className={cn(
        'scanner-track relative h-2 w-full overflow-hidden',
        SCANNER_TONE_CLASS[tone],
        className,
      )}
    >
      <div className="scanner-sweep absolute inset-y-0" />
    </div>
  )
}
