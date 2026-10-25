import { memo, useMemo } from 'react'
import { ModelQuickSelect } from '@/components/model/ModelQuickSelect'
import { ContextUsageMeter } from '@/components/session/ContextUsageMeter'
import { useSession } from '@/hooks/useOpenCode'
import { useContextUsage } from '@/hooks/useContextUsage'
import type { ModelSelectionSession } from '@/hooks/useModelSelection'
import {
  CONTEXT_USAGE_TEXT_CLASS,
  contextUsageAccessibleLabel,
  contextUsageTone,
  formatContextUsage,
} from '@/lib/contextUsage'
import { cn } from '@/lib/utils'

interface ComposerModelPillProps {
  directory?: string
  sessionID: string
  modelName: string
  variant: string | null
  modelSelectionSession?: ModelSelectionSession
  open: boolean
  onOpenChange: (open: boolean) => void
  isCompacting: boolean
  onCompact: () => void
}

/**
 * Model selector trigger for the composer.
 *
 * Owns the context usage observer so transcript streaming flushes re-render only this pill instead of the
 * whole composer subtree.
 */
export const ComposerModelPill = memo(function ComposerModelPill({
  directory,
  sessionID,
  modelName,
  variant,
  modelSelectionSession,
  open,
  onOpenChange,
  isCompacting,
  onCompact,
}: ComposerModelPillProps) {
  const { data: session } = useSession(sessionID, directory)
  const contextUsage = useContextUsage(sessionID, directory, session?.revert?.messageID)
  const pillUsage = contextUsage ? formatContextUsage(contextUsage) : null
  const pillUsageTone = CONTEXT_USAGE_TEXT_CLASS[contextUsageTone(contextUsage?.usagePercentage ?? null)]
  const pillLabel = [
    modelName || 'Select model',
    variant ? `${variant} variant` : null,
    contextUsage ? contextUsageAccessibleLabel(contextUsage) : null,
  ].filter((part): part is string => part !== null).join(', ')

  const trigger = useMemo(
    () => (
      <button
        aria-label={pillLabel}
        className="relative px-2.5 py-0.5 md:px-3 min-h-11 md:min-h-9 min-w-0 rounded-lg text-xs md:text-sm font-medium border bg-muted border-border text-muted-foreground hover:bg-muted-foreground/10 hover:border-foreground/30 transition-colors cursor-pointer flex-1 md:flex-initial md:w-auto md:max-w-[220px] dark:border-border/30 flex flex-col items-start justify-center overflow-hidden"
      >
        <span className="truncate w-full text-left">{modelName || 'Select model'}</span>
        {(variant || pillUsage) && (
          <span className="flex w-full min-w-0 items-center gap-1 text-[10px] leading-tight">
            {variant && (
              <span className="truncate text-left capitalize text-highlight">{variant}</span>
            )}
            {variant && pillUsage && (
              <span aria-hidden="true" className="text-muted-foreground">·</span>
            )}
            {pillUsage && (
              <span
                data-testid="model-pill-context-usage"
                className={cn('shrink-0 font-medium', pillUsageTone)}
              >
                {pillUsage}
              </span>
            )}
          </span>
        )}
        {contextUsage && (
          <ContextUsageMeter
            percentage={contextUsage.usagePercentage}
            className="absolute inset-x-0 bottom-0"
          />
        )}
      </button>
    ),
    [contextUsage, modelName, pillLabel, pillUsage, pillUsageTone, variant],
  )

  return (
    <ModelQuickSelect
      directory={directory}
      open={open}
      onOpenChange={onOpenChange}
      session={modelSelectionSession}
      contextUsage={contextUsage}
      isCompacting={isCompacting}
      onCompact={onCompact}
    >
      {trigger}
    </ModelQuickSelect>
  )
})
