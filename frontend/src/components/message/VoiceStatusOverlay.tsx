import { ArrowUp, LoaderCircle, X } from 'lucide-react'

export type VoiceStatusOverlayState = 'starting' | 'recording' | 'readyToSend' | 'processing' | 'sending'

interface VoiceStatusOverlayProps {
  show: boolean
  label: string | null
  state: VoiceStatusOverlayState | null
}

export function VoiceStatusOverlay({ show, label, state }: VoiceStatusOverlayProps) {
  if (!show || !label || !state) {
    return null
  }

  const isLoading = state === 'starting' || state === 'processing' || state === 'sending'
  const topLabel = state === 'readyToSend'
    ? 'Release'
    : state === 'starting'
      ? 'Starting'
      : state === 'processing'
        ? 'Transcribe'
        : state === 'sending'
          ? 'Sending'
          : 'Swipe'
  const bottomLabel = state === 'starting'
    ? 'Mic'
    : state === 'processing'
      ? 'Speech'
      : state === 'sending'
        ? 'Prompt'
        : state === 'readyToSend'
          ? 'Send'
          : 'Send'
  const actionWords = state === 'readyToSend'
    ? ['Release', 'To', 'Send']
    : ['Swipe', 'To', 'Send']

  return (
    <div
      aria-live="polite"
      className="pointer-events-none absolute inset-x-0 bottom-0 z-10"
    >
      <span className="sr-only">{label}</span>
      <div className="relative flex h-36 w-full flex-col items-center justify-between overflow-hidden rounded-xl border border-green-300/70 bg-gradient-to-t from-green-700 via-green-500 to-emerald-400 px-1 py-3 text-white shadow-lg shadow-green-500/40">
        <div className="absolute inset-x-1 top-1 h-10 rounded-full bg-white/20 blur-sm" />
        <div className="relative flex flex-1 flex-col items-center justify-center gap-1">
          {isLoading ? (
            <>
              <LoaderCircle className="h-6 w-6 animate-spin" />
              <span className="text-[10px] font-bold uppercase leading-none tracking-wide">{topLabel}</span>
            </>
          ) : (
            <>
              <ArrowUp className="h-8 w-8 animate-bounce" />
              <div className="flex flex-col items-center text-[9px] font-bold uppercase leading-none tracking-tight">
                {actionWords.map((word) => (
                  <span key={word}>{word}</span>
                ))}
              </div>
            </>
          )}
        </div>
        {isLoading ? (
          <span className="relative text-[10px] font-bold uppercase leading-none tracking-wide">{bottomLabel}</span>
        ) : (
          <X className="relative h-4 w-4" />
        )}
      </div>
    </div>
  )
}
