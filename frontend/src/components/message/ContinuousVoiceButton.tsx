import { useState, useCallback, useEffect, useRef } from 'react'
import { Mic, MicOff, Loader2, Volume2 } from 'lucide-react'
import { useStreamingVAD } from '@/hooks/useStreamingVAD'
import { useSettings } from '@/hooks/useSettings'
import { useTTS } from '@/hooks/useTTS'
import { cn } from '@/lib/utils'

interface ContinuousVoiceButtonProps {
  onTranscriptUpdate: (text: string) => void
  onAutoSubmit: (text: string) => void
  disabled?: boolean
  className?: string
}

export function ContinuousVoiceButton({ 
  onTranscriptUpdate, 
  onAutoSubmit,
  disabled, 
  className 
}: ContinuousVoiceButtonProps) {
  const { preferences } = useSettings()
  const { isPlaying: isTTSPlaying } = useTTS()
  const [isActive, setIsActive] = useState(false)
  const [showError, setShowError] = useState(false)
  const [pausedForTTS, setPausedForTTS] = useState(false)
  const lastTranscriptRef = useRef('')
  const wasPlayingRef = useRef(false)

  const talkModeConfig = preferences?.talkMode
  const sttConfig = preferences?.stt
  const isEnabled = !!(talkModeConfig?.enabled && sttConfig?.enabled)
  const silenceTimeoutMs = talkModeConfig?.silenceThresholdMs ?? 1500

  const handleTranscriptUpdate = useCallback((transcript: string, isFinal: boolean) => {
    lastTranscriptRef.current = transcript
    onTranscriptUpdate(transcript)
    
    if (isFinal && transcript.trim()) {
      onAutoSubmit(transcript.trim())
      lastTranscriptRef.current = ''
    }
  }, [onTranscriptUpdate, onAutoSubmit])

  const handleSpeechEnd = useCallback((fullTranscript: string) => {
    if (fullTranscript.trim()) {
      onAutoSubmit(fullTranscript.trim())
      lastTranscriptRef.current = ''
    }
  }, [onAutoSubmit])

  const streamingVAD = useStreamingVAD({
    chunkIntervalMs: 2500,
    silenceTimeoutMs,
    onTranscriptUpdate: handleTranscriptUpdate,
    onSpeechEnd: handleSpeechEnd,
    sttConfig: {
      model: sttConfig?.model,
      language: sttConfig?.language
    }
  })

  const handleToggle = useCallback(async () => {
    if (isActive) {
      streamingVAD.stop()
      setIsActive(false)
      onTranscriptUpdate('')
    } else {
      try {
        await streamingVAD.start()
        setIsActive(true)
      } catch {
        setShowError(true)
        setTimeout(() => setShowError(false), 3000)
      }
    }
  }, [isActive, streamingVAD, onTranscriptUpdate])

  useEffect(() => {
    if (streamingVAD.error) {
      setShowError(true)
      const timer = setTimeout(() => setShowError(false), 3000)
      return () => clearTimeout(timer)
    }
  }, [streamingVAD.error])

  useEffect(() => {
    return () => {
      if (isActive) {
        streamingVAD.stop()
      }
    }
  }, [])

  useEffect(() => {
    if (!isActive) return
    
    if (isTTSPlaying && !wasPlayingRef.current) {
      streamingVAD.stop()
      setPausedForTTS(true)
      wasPlayingRef.current = true
    } else if (!isTTSPlaying && wasPlayingRef.current) {
      wasPlayingRef.current = false
      if (pausedForTTS) {
        setPausedForTTS(false)
        setTimeout(() => {
          streamingVAD.start().catch(() => {})
        }, 300)
      }
    }
  }, [isTTSPlaying, isActive, pausedForTTS, streamingVAD])

  if (!isEnabled) {
    return null
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={handleToggle}
        disabled={disabled}
        className={cn(
          'p-2 rounded-lg transition-all duration-200 active:scale-95',
          isActive
            ? 'bg-green-500 hover:bg-green-600 text-white border border-green-400 shadow-lg shadow-green-500/30'
            : 'bg-muted hover:bg-muted-foreground/20 text-muted-foreground hover:text-foreground border border-border',
          streamingVAD.isProcessing && isActive && 'animate-pulse',
          disabled && 'opacity-50 cursor-not-allowed',
          className
        )}
        title={isActive ? 'Stop voice input' : 'Start continuous voice input'}
      >
        {streamingVAD.isProcessing ? (
          <Loader2 className="w-5 h-5 animate-spin" />
        ) : isActive ? (
          <MicOff className="w-5 h-5" />
        ) : (
          <Mic className="w-5 h-5" />
        )}
      </button>

      {isActive && !pausedForTTS && (
        <div className="absolute -top-10 left-1/2 transform -translate-x-1/2 flex items-center gap-2 px-3 py-1 rounded-full bg-green-500 text-white text-xs font-medium whitespace-nowrap shadow-lg">
          <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
          <span>Listening...</span>
        </div>
      )}

      {isActive && pausedForTTS && (
        <div className="absolute -top-10 left-1/2 transform -translate-x-1/2 flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500 text-white text-xs font-medium whitespace-nowrap shadow-lg">
          <Volume2 className="w-3 h-3 animate-pulse" />
          <span>Speaking...</span>
        </div>
      )}

      {showError && streamingVAD.error && !isActive && (
        <div className="absolute -top-10 left-1/2 transform -translate-x-1/2 px-3 py-1 rounded-full bg-red-500 text-white text-xs font-medium whitespace-nowrap shadow-lg max-w-[200px] truncate">
          {streamingVAD.error}
        </div>
      )}
    </div>
  )
}
