import { X, Mic } from 'lucide-react'
import { SquareFill } from '@/components/ui/square-fill'

interface RecordingOverlayProps {
  interimTranscript: string
  onStop: () => void
  onCancel: () => void
}

export function RecordingOverlay({
  interimTranscript,
  onStop,
  onCancel
}: RecordingOverlayProps) {
  return (
    <div className="flex flex-col gap-3 py-2">
      <div className="flex items-center justify-center h-12">
        <div className="flex items-center gap-2 text-red-500">
          <Mic className="w-5 h-5 animate-pulse" />
          <span className="text-sm font-medium">Recording...</span>
        </div>
      </div>

      <div className="min-h-[40px] px-3 py-2 bg-muted/50 rounded-lg">
        {interimTranscript ? (
          <p className="text-sm text-foreground">{interimTranscript}</p>
        ) : (
          <p className="text-sm text-muted-foreground italic">Listening...</p>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <X className="w-4 h-4" />
          <span>Cancel</span>
        </button>

        <button
          type="button"
          onClick={onStop}
          className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium bg-gradient-to-br from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-white border border-red-500/60 shadow-md shadow-red-500/30 transition-all duration-200 active:scale-95"
        >
          <SquareFill className="w-3 h-3" />
          <span>Done</span>
        </button>
      </div>
    </div>
  )
}
