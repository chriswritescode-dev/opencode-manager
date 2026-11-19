import { cn } from '@/lib/utils'

export type ScannerTone = 'info' | 'primary' | 'warning' | 'muted-foreground'

const SCANNER_TONE_CLASS = {
  info: 'text-info',
  primary: 'text-primary',
  warning: 'text-warning',
  'muted-foreground': 'text-muted-foreground',
} satisfies Record<ScannerTone, string>

interface ScannerBarsProps {
  tone: ScannerTone
  className?: string
}

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
