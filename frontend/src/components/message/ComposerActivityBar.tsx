import { ScannerBars, type ScannerTone } from '@/components/ui/scanner-bars'
import { useHasBackgroundActivity, useSessionStatusForSession } from '@/stores/sessionStatusStore'

interface ComposerActivityBarProps {
  sessionID: string
}

const LIT_WIDTH = 6
const STEP_INTERVAL_MS = 30

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
 * Session activity scanner anchored in the gap below the composer frame. The strip uses the same
 * 4x8px segments as the session status scanner and fills the composer width with as many segments
 * as fit. Renders nothing while the session is idle and has no background activity; otherwise
 * announces the current activity through an indeterminate progressbar.
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
      className="pointer-events-none absolute inset-x-3 -bottom-[13px] md:-bottom-[11px] flex"
    >
      <ScannerBars tone={activity.tone} litWidth={LIT_WIDTH} intervalMs={STEP_INTERVAL_MS} />
    </div>
  )
}
