import { ArrowUp } from 'lucide-react'

interface VoiceStatusOverlayProps {
  show: boolean
  label: string | null
}

export function VoiceStatusOverlay({ show, label }: VoiceStatusOverlayProps) {
  if (!show || !label) {
    return null
  }

  return (
    <div
      aria-live="polite"
      className="pointer-events-none absolute inset-x-0 bottom-0 z-10"
    >
      <span className="sr-only">{label}</span>
      <div className="relative flex h-36 w-full flex-col items-center justify-between overflow-hidden rounded-xl border border-green-300/70 bg-gradient-to-t from-green-700 via-green-500 to-emerald-400 px-1 py-3 text-white shadow-lg shadow-green-500/40">
        <div className="absolute inset-x-1 top-1 h-10 rounded-full bg-white/20 blur-sm" />
        <div className="relative flex flex-1 flex-col items-center justify-center gap-2">
          <ArrowUp className="h-6 w-6 animate-bounce" />
          <span className="text-[9px] font-bold uppercase leading-none tracking-tight">Swipe</span>
        </div>
        <span className="relative text-[10px] font-bold uppercase leading-none tracking-wide">Send</span>
      </div>
    </div>
  )
}
