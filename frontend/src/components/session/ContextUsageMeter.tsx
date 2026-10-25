import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import { CONTEXT_USAGE_BG_CLASS, contextUsageTone } from '@/lib/contextUsage'

interface ContextUsageMeterProps {
  percentage: number | null
  className?: string
}

/**
 * Thin context-window fill bar. Its accessible label lives on the model pill, so the bar itself is hidden
 * from assistive technology.
 */
export function ContextUsageMeter({ percentage, className }: ContextUsageMeterProps) {
  return (
    <Progress
      data-testid="context-usage-meter"
      aria-hidden="true"
      value={percentage ?? 0}
      className={cn('h-0.5 rounded-none bg-border/50', className)}
      indicatorClassName={cn('transition-none', CONTEXT_USAGE_BG_CLASS[contextUsageTone(percentage)])}
      indicatorTestId="context-usage-meter-fill"
    />
  )
}
