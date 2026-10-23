import { Hourglass, LoaderCircle, MessageSquarePlus, Mic, MicOff, Volume2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { VoicePhase } from '@opencode-manager/shared/opencode'
import { cn } from '@/lib/utils'

interface PhasePresentation {
  core: string
  halo: string
  animation: string
}

const PHASE_PRESENTATION: Record<VoicePhase, PhasePresentation> = {
  off: {
    core: 'bg-muted-foreground text-background',
    halo: 'bg-muted-foreground/15',
    animation: '',
  },
  listening: {
    core: 'bg-primary text-primary-foreground',
    halo: 'bg-primary/15',
    animation: 'animate-voice-orb-breathe',
  },
  sending: {
    core: 'bg-primary text-primary-foreground',
    halo: 'bg-primary/15',
    animation: '',
  },
  working: {
    core: 'bg-highlight text-highlight-foreground',
    halo: 'bg-highlight/15',
    animation: 'animate-voice-orb-work',
  },
  speaking: {
    core: 'bg-success text-success-foreground',
    halo: 'bg-success/15',
    animation: 'animate-voice-orb-speak',
  },
  recording: {
    core: 'bg-warning text-warning-foreground',
    halo: 'bg-warning/15',
    animation: 'animate-voice-orb-breathe',
  },
  paused: {
    core: 'bg-muted-foreground text-background',
    halo: 'bg-muted-foreground/5',
    animation: '',
  },
}

const PHASE_ICONS: Record<VoicePhase, LucideIcon> = {
  off: MicOff,
  listening: Mic,
  sending: LoaderCircle,
  working: Hourglass,
  speaking: Volume2,
  recording: MessageSquarePlus,
  paused: MicOff,
}

const GLYPH_CLASS = 'size-[26px]'

export interface VoiceConversationOrbProps {
  /** Current stage of the conversation loop. */
  phase: VoicePhase
  /** Action label read by assistive technology. */
  label: string
  /** Called when the orb is pressed. */
  onPress: () => void
  /** Whether the orb cannot be pressed. */
  disabled?: boolean
}

/**
 * The single control of the voice conversation bar. It carries the phase color
 * and glyph, breathes gently while the microphone captures a turn, pulses slowly
 * while the agent works and faster while a reply is read, and holds still in
 * every other phase. Paused reads fainter through a dimmed orb and a weaker
 * halo. All motion stops when the system asks for reduced motion.
 */
export function VoiceConversationOrb({
  phase,
  label,
  onPress,
  disabled = false,
}: VoiceConversationOrbProps) {
  const presentation = PHASE_PRESENTATION[phase]
  const Glyph = PHASE_ICONS[phase]
  const motion = cn(presentation.animation, 'motion-reduce:animate-none')

  return (
    <button
      type="button"
      aria-label={label}
      aria-busy={phase === 'sending'}
      disabled={disabled}
      onClick={onPress}
      className={cn(
        'relative flex size-[72px] shrink-0 items-center justify-center rounded-full transition-opacity disabled:cursor-not-allowed disabled:opacity-50',
        phase === 'paused' && 'opacity-50',
      )}
    >
      <span aria-hidden="true" className={cn('absolute inset-0 rounded-full', presentation.halo, motion)} />
      <span
        aria-hidden="true"
        className={cn(
          'relative flex size-16 items-center justify-center rounded-full shadow-md',
          presentation.core,
          motion,
        )}
      >
        {phase === 'sending' ? (
          <LoaderCircle className={cn(GLYPH_CLASS, 'animate-spin motion-reduce:animate-none')} />
        ) : (
          <Glyph className={GLYPH_CLASS} />
        )}
      </span>
    </button>
  )
}
