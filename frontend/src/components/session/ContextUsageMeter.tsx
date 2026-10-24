import { cn } from '@/lib/utils'
import { CONTEXT_USAGE_BG_CLASS, contextUsageTone } from '@/lib/contextUsage'

interface ContextUsageMeterProps {
  percentage: number | null
  className?: string
}

export function ContextUsageMeter({ percentage, className }: ContextUsageMeterProps) {
  const width = percentage === null ? 0 : Math.min(percentage, 100)

  return (
    <div
      data-testid="context-usage-meter"
      aria-hidden="true"
      className={cn('h-0.5 w-full overflow-hidden bg-border/50', className)}
    >
      <div
        data-testid="context-usage-meter-fill"
        className={cn('h-full', CONTEXT_USAGE_BG_CLASS[contextUsageTone(percentage)])}
        style={{ width: `${width}%` }}
      />
    </div>
  )
}
