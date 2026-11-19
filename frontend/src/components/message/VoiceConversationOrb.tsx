import { Hourglass, LoaderCircle, MessageSquarePlus, Mic, MicOff, Volume2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { VoicePhase } from '@opencode-manager/shared/opencode'
import { cn } from '@/lib/utils'

interface PhasePresentation {
  core: string
  halo: string
  animation: string
}

const PHASE_PRESENTATION = {
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
} satisfies Record<VoicePhase, PhasePresentation>

const PHASE_ICONS = {
  off: MicOff,
  listening: Mic,
  sending: LoaderCircle,
  working: Hourglass,
  speaking: Volume2,
  recording: MessageSquarePlus,
  paused: MicOff,
} satisfies Record<VoicePhase, LucideIcon>

const GLYPH_CLASS = 'size-[26px]'

export interface VoiceConversationOrbProps {
  phase: VoicePhase
  label: string
  onPress: () => void
  disabled?: boolean
}

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
