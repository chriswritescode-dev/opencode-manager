import { ScannerBars, type ScannerTone } from '@/components/ui/scanner-bars'
import { useHasBackgroundActivity, useSessionStatusForSession } from '@/stores/sessionStatusStore'

interface ComposerActivityBarProps {
  sessionID: string
}

const ACTIVITY_PRESENTATION = {
  background: {
    label: 'Background tasks running',
    tone: 'muted-foreground',
  },
  busy: {
    label: 'Session working',
    tone: 'info',
  },
  compact: {
    label: 'Compacting',
    tone: 'primary',
  },
  retry: {
    label: 'Retrying',
    tone: 'warning',
  },
} as const satisfies Record<string, { label: string; tone: ScannerTone }>

/**
 * Session activity scanner shown by the composer. It overlays the gap above the bottom controls row
 * without taking layout height, so the composer never resizes or jumps when activity starts or stops.
 * A fading lit window of 4x8px segments sweeps across the strip. Renders nothing while the session is
 * idle and has no background activity; otherwise announces the current activity through an
 * indeterminate progressbar.
 */
export function ComposerActivityBar({ sessionID }: ComposerActivityBarProps) {
  const status = useSessionStatusForSession(sessionID)
  const hasBackgroundActivity = useHasBackgroundActivity(sessionID)

  if (status.type === 'idle' && !hasBackgroundActivity) {
    return null
  }

  const activity = status.type === 'idle'
    ? ACTIVITY_PRESENTATION.background
    : ACTIVITY_PRESENTATION[status.type]
  const label = status.type === 'retry'
    ? `${ACTIVITY_PRESENTATION.retry.label} (Retry #${status.attempt})`
    : activity.label

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      className="pointer-events-none absolute inset-x-0 bottom-full flex"
    >
      <ScannerBars tone={activity.tone} className="h-1.5 md:h-2" />
    </div>
  )
}
