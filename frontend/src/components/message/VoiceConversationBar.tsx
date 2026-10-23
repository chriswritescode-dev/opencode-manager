import { Pause, Pencil, Play, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { VoiceConversationOrb } from '@/components/message/VoiceConversationOrb'
import { Button } from '@/components/ui/button'
import { getIconToggleButtonClassName } from '@/components/ui/icon-toggle-button'
import { SquareFill } from '@/components/ui/square-fill'
import type { VoiceConversationController } from '@/hooks/useVoiceConversation'
import { cn } from '@/lib/utils'

const BAR_ICON_BUTTON_CLASS = cn(
  getIconToggleButtonClassName(false),
  'flex size-11 shrink-0 items-center justify-center p-0',
)

const RESERVED_LINE_CLASS = 'h-4 w-full truncate text-center leading-4'

interface BarIconButtonProps {
  label: string
  onClick: () => void
  children: ReactNode
}

function BarIconButton({ label, onClick, children }: BarIconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={BAR_ICON_BUTTON_CLASS}
    >
      {children}
    </button>
  )
}

export interface VoiceConversationBarProps {
  /** Conversation state and its controls. */
  controller: VoiceConversationController
  /** Whether the session waits for the user to approve a tool or a form. */
  hasPendingApproval: boolean
  /** Opens the pending permission dialog. */
  onViewApproval: () => void
}

/**
 * Shows a hands-free voice conversation under the session composer on a fixed
 * block: the short status sits on the left of the first line with the latest
 * dictated words on the right, the orb keeps the centre of the control row, and
 * the exit or edit control, the stop control and the pause, resume or approval
 * control fill the two slots beside it. The hint and the notice each keep a
 * reserved line under the orb, so the bar never changes height while the
 * conversation talks, works, waits or reports a problem. Status changes are
 * announced to assistive technology.
 */
export function VoiceConversationBar({
  controller,
  hasPendingApproval,
  onViewApproval,
}: VoiceConversationBarProps) {
  const {
    phase,
    label,
    hint,
    orbLabel,
    liveTranscript,
    canEditInTextBox,
    canStopAgent,
    hasHeldReading,
    notice,
  } = controller

  return (
    <div className="flex flex-col gap-1 border-t border-border bg-card px-3 pt-2 pb-2">
      <div role="status" aria-live="polite" className="flex h-5 items-center gap-2">
        <span
          className={cn(
            'truncate text-xs font-semibold',
            liveTranscript ? 'max-w-[50%] shrink-0' : 'min-w-0 flex-1',
          )}
        >
          {label}
        </span>
        {liveTranscript ? (
          <span
            dir="rtl"
            aria-hidden="true"
            className="min-w-0 flex-1 truncate text-right text-xs text-muted-foreground"
          >
            <span dir="ltr">{liveTranscript}</span>
          </span>
        ) : null}
      </div>
      <div className="grid grid-cols-3 items-center">
        <div className="flex items-center gap-1">
          {canEditInTextBox ? (
            <BarIconButton label="Edit in text box" onClick={controller.editInTextBox}>
              <Pencil className="size-5" />
            </BarIconButton>
          ) : (
            <BarIconButton label="Exit voice conversation" onClick={controller.exit}>
              <X className="size-5" />
            </BarIconButton>
          )}
          {canStopAgent ? (
            <BarIconButton label="Stop the agent" onClick={controller.stopAgent}>
              <SquareFill className="size-4" />
            </BarIconButton>
          ) : null}
        </div>
        <div className="flex justify-center">
          <VoiceConversationOrb phase={phase} label={orbLabel} onPress={controller.tapOrb} />
        </div>
        <div className="flex justify-end">
          {hasPendingApproval ? (
            <Button
              type="button"
              aria-label="View pending permission"
              onClick={onViewApproval}
              className="h-11 px-4 text-xs font-semibold shadow-md"
            >
              View
            </Button>
          ) : phase === 'paused' ? (
            <BarIconButton
              label={hasHeldReading ? 'Continue reading' : 'Resume'}
              onClick={controller.resume}
            >
              <Play className="size-5" />
            </BarIconButton>
          ) : (
            <BarIconButton label="Pause voice conversation" onClick={controller.pause}>
              <Pause className="size-5" />
            </BarIconButton>
          )}
        </div>
      </div>
      <div className="flex flex-col items-center">
        <p className={cn(RESERVED_LINE_CLASS, 'text-[11px] text-muted-foreground')}>{notice ?? ''}</p>
        <p className={cn(RESERVED_LINE_CLASS, 'text-xs text-muted-foreground')}>{hint}</p>
      </div>
    </div>
  )
}
