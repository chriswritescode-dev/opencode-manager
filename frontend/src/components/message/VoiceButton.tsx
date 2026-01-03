import { useState, useCallback, useEffect } from 'react'
import { Mic, Square, Loader2 } from 'lucide-react'
import { useSTT } from '@/hooks/useSTT'
import { cn } from '@/lib/utils'

interface VoiceButtonProps {
  onTranscription: (text: string) => void
  disabled?: boolean
  className?: string
}

export function VoiceButton({ onTranscription, disabled, className }: VoiceButtonProps) {
  const { 
    startRecording, 
    stopRecording, 
    cancelRecording,
    isEnabled, 
    isRecording, 
    isTranscribing,
    recordingDuration,
    error
  } = useSTT()

  const [showError, setShowError] = useState(false)

  useEffect(() => {
    if (error) {
      setShowError(true)
      const timer = setTimeout(() => setShowError(false), 3000)
      return () => clearTimeout(timer)
    }
  }, [error])

  const handleClick = useCallback(async () => {
    if (isRecording) {
      const text = await stopRecording()
      if (text) {
        onTranscription(text)
      }
    } else if (!isTranscribing) {
      await startRecording()
    }
  }, [isRecording, isTranscribing, startRecording, stopRecording, onTranscription])

  const handleCancel = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    cancelRecording()
  }, [cancelRecording])

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  if (!isEnabled) {
    return null
  }

  const isActive = isRecording || isTranscribing

  return (
    <div className="relative">
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled || isTranscribing}
        className={cn(
          'p-2 rounded-lg transition-all duration-200 active:scale-95',
          isRecording
            ? 'bg-red-500 hover:bg-red-600 text-white border border-red-400 shadow-lg shadow-red-500/30 animate-pulse'
            : isTranscribing
            ? 'bg-blue-500 text-white border border-blue-400 cursor-wait'
            : 'bg-muted hover:bg-muted-foreground/20 text-muted-foreground hover:text-foreground border border-border',
          disabled && 'opacity-50 cursor-not-allowed',
          className
        )}
        title={isRecording ? 'Stop recording' : isTranscribing ? 'Transcribing...' : 'Start voice input'}
      >
        {isTranscribing ? (
          <Loader2 className="w-5 h-5 animate-spin" />
        ) : isRecording ? (
          <Square className="w-5 h-5" />
        ) : (
          <Mic className="w-5 h-5" />
        )}
      </button>

      {isRecording && (
        <div className="absolute -top-10 left-1/2 transform -translate-x-1/2 flex items-center gap-2 px-3 py-1 rounded-full bg-red-500 text-white text-xs font-medium whitespace-nowrap shadow-lg">
          <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
          <span>{formatDuration(recordingDuration)}</span>
          <button
            onClick={handleCancel}
            className="ml-1 p-0.5 rounded hover:bg-red-600 transition-colors"
            title="Cancel"
          >
            <span className="text-xs">Cancel</span>
          </button>
        </div>
      )}

      {isTranscribing && (
        <div className="absolute -top-10 left-1/2 transform -translate-x-1/2 flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500 text-white text-xs font-medium whitespace-nowrap shadow-lg">
          <Loader2 className="w-3 h-3 animate-spin" />
          <span>Transcribing...</span>
        </div>
      )}

      {showError && error && !isActive && (
        <div className="absolute -top-10 left-1/2 transform -translate-x-1/2 px-3 py-1 rounded-full bg-red-500 text-white text-xs font-medium whitespace-nowrap shadow-lg">
          {error}
        </div>
      )}
    </div>
  )
}
