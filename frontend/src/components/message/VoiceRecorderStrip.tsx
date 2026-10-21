import { useEffect, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

export type VoiceRecorderStripState =
  | 'starting'
  | 'recording'
  | 'readyToSend'
  | 'cancelArmed'
  | 'processing'
  | 'sending'

interface VoiceRecorderStripProps {
  state: VoiceRecorderStripState
  startedAt: number | null
}

const WAVEFORM_BAR_COUNT = 5
const WAVEFORM_BAR_DELAY_MS = 120

const STRIP_TONES: Record<VoiceRecorderStripState, string> = {
  starting: 'border-border bg-muted/50 text-muted-foreground',
  recording: 'border-border bg-muted/50 text-foreground',
  readyToSend: 'border-success/60 bg-success/10 text-success',
  cancelArmed: 'border-destructive/60 bg-destructive/10 text-destructive',
  processing: 'border-border bg-muted/50 text-muted-foreground',
  sending: 'border-border bg-muted/50 text-muted-foreground',
}

function WaveformBars() {
  return (
    <div aria-hidden="true" className="flex h-4 items-end gap-[2px] text-destructive">
      {Array.from({ length: WAVEFORM_BAR_COUNT }, (_, index) => (
        <span
          key={index}
          className="animate-voice-wave-bar h-full w-[3px] rounded-full bg-current motion-reduce:animate-none"
          style={{ animationDelay: `${index * WAVEFORM_BAR_DELAY_MS}ms` }}
        />
      ))}
    </div>
  )
}

function useElapsedLabel(startedAt: number | null): string | null {
  const [elapsedSeconds, setElapsedSeconds] = useState(0)

  useEffect(() => {
    if (startedAt === null) return

    const tick = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)))
    tick()
    const interval = setInterval(tick, 1000)

    return () => clearInterval(interval)
  }, [startedAt])

  if (startedAt === null) return null

  return `${Math.floor(elapsedSeconds / 60)}:${String(elapsedSeconds % 60).padStart(2, '0')}`
}

export function VoiceRecorderStrip({ state, startedAt }: VoiceRecorderStripProps) {
  const elapsedLabel = useElapsedLabel(state === 'recording' ? startedAt : null)

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border px-2.5 text-xs font-medium',
        STRIP_TONES[state],
      )}
    >
      {state === 'starting' && (
        <>
          <LoaderCircle className="size-4 shrink-0 animate-spin" />
          <span className="truncate">Starting mic…</span>
        </>
      )}
      {state === 'recording' && (
        <>
          <span aria-hidden="true" className="size-2 shrink-0 animate-pulse rounded-full bg-destructive" />
          <span aria-hidden="true" className="shrink-0 font-mono tabular-nums">{elapsedLabel}</span>
          <WaveformBars />
          <span className="ml-auto shrink-0 truncate text-[10px] uppercase tracking-wide opacity-60">‹ discard · send ›</span>
        </>
      )}
      {state === 'readyToSend' && <span className="truncate">Release to send</span>}
      {state === 'cancelArmed' && <span className="truncate">Release to discard</span>}
      {state === 'processing' && (
        <>
          <LoaderCircle className="size-4 shrink-0 animate-spin" />
          <span className="truncate">Transcribing…</span>
        </>
      )}
      {state === 'sending' && (
        <>
          <LoaderCircle className="size-4 shrink-0 animate-spin" />
          <span className="truncate">Transcribing &amp; sending…</span>
        </>
      )}
    </div>
  )
}
