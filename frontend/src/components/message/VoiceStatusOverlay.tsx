import { ArrowUp, LoaderCircle, X } from 'lucide-react'

export type VoiceStatusOverlayState = 'starting' | 'recording' | 'readyToSend' | 'processing' | 'sending'

interface VoiceStatusOverlayProps {
  show: boolean
  label: string | null
  state: VoiceStatusOverlayState | null
}

function WaveformBars() {
  return (
    <div className="flex items-end gap-[3px] h-8">
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className="w-1.5 rounded-full bg-white"
          style={{
            height: '100%',
            animation: `waveBar 0.9s ease-in-out infinite`,
            animationDelay: `${i * 0.12}s`,
          }}
        />
      ))}
      <style>{`
        @keyframes waveBar {
          0%, 100% { transform: scaleY(0.2); }
          50% { transform: scaleY(1); }
        }
      `}</style>
    </div>
  )
}

export function VoiceStatusOverlay({ show, label, state }: VoiceStatusOverlayProps) {
  if (!show || !label || !state) {
    return null
  }

  const isLoading = state === 'starting' || state === 'processing' || state === 'sending'
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
            state === 'processing' ? (
              <WaveformBars />
            ) : (
              <LoaderCircle className="h-6 w-6 animate-spin" />
            )
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
        {!isLoading && (
          <X className="relative h-4 w-4" />
        )}
      </div>
    </div>
  )
}
