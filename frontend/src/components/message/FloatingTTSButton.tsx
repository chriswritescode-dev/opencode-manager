import { useState, useCallback, useRef } from 'react'
import { Volume2, VolumeX } from 'lucide-react'
import { useTTS } from '@/hooks/useTTS'
import { useSettings } from '@/hooks/useSettings'
import { showToast } from '@/lib/toast'
import { DEFAULT_TTS_CONFIG } from '@opencode-manager/shared'

interface FloatingTTSButtonProps {
  messageId: string
  content: string
}

const LONG_PRESS_DURATION = 500

export function FloatingTTSButton({ messageId, content }: FloatingTTSButtonProps) {
  const { speakMessage, stop, isPlaying, isLoading } = useTTS()
  const { preferences, updateSettings } = useSettings()

  const autoPlay = preferences?.tts?.autoPlay ?? false
  const [isLongPressVisual, setIsLongPressVisual] = useState(false)
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const didLongPressFireRef = useRef(false)

  const isAnyPlaybackActive = isPlaying || isLoading
  const hasContent = content.trim().length > 0

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }, [])

  const handlePointerDown = useCallback(() => {
    clearLongPressTimer()
    didLongPressFireRef.current = false
    longPressTimerRef.current = setTimeout(() => {
      const nextAutoPlay = !autoPlay

      didLongPressFireRef.current = true
      setIsLongPressVisual(true)
      updateSettings({ tts: { ...(preferences?.tts ?? DEFAULT_TTS_CONFIG), autoPlay: nextAutoPlay } })
      showToast.info(nextAutoPlay ? 'Auto-play enabled' : 'Auto-play disabled', {
        id: 'tts-autoplay-toggle',
        duration: 1800,
      })
    }, LONG_PRESS_DURATION)
  }, [autoPlay, updateSettings, preferences?.tts, clearLongPressTimer])

  const handlePointerUp = useCallback(() => {
    clearLongPressTimer()

    if (didLongPressFireRef.current) {
      didLongPressFireRef.current = false
      setIsLongPressVisual(false)
      return
    }

    setIsLongPressVisual(false)

    if (isAnyPlaybackActive) {
      stop()
      return
    }

    if (hasContent) {
      speakMessage(messageId, content)
    }
  }, [clearLongPressTimer, isAnyPlaybackActive, stop, speakMessage, messageId, content, hasContent])

  const handlePointerLeave = useCallback(() => {
    clearLongPressTimer()
    didLongPressFireRef.current = false
    setIsLongPressVisual(false)
  }, [clearLongPressTimer])

  const showStop = isAnyPlaybackActive
  const pillTitle = showStop
    ? 'Stop playback'
    : hasContent
      ? 'Play latest reply'
      : 'TTS controls'
  const pillAriaLabel = `${pillTitle}. ${autoPlay ? 'Auto-play enabled.' : 'Auto-play disabled.'} hold to toggle auto-play`
  const buttonToneClasses = showStop
    ? 'justify-center px-3 py-1.5 rounded-lg bg-destructive border border-destructive/60 shadow-destructive/30 ring-destructive/20 hover:ring-destructive/40 text-destructive-foreground'
    : autoPlay
      ? 'justify-center px-3 py-1.5 rounded-lg bg-primary border border-primary/60 shadow-primary/30 ring-primary/20 hover:ring-primary/40 text-primary-foreground'
      : 'justify-center px-3 py-1.5 rounded-lg bg-gradient-to-br from-warning to-highlight border border-warning/60 shadow-warning/30 ring-warning/20 hover:ring-warning/40 text-warning-foreground'

  return (
      <button
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        className={`flex items-center transition-all duration-200 shadow-md backdrop-blur-md ring-1 ${buttonToneClasses} ${isLongPressVisual ? 'scale-95 opacity-80' : 'active:scale-95 hover:scale-105'} ${!hasContent && !autoPlay ? 'opacity-50 cursor-not-allowed' : ''}`}
        title={pillTitle}
        aria-label={pillAriaLabel}
        disabled={!hasContent && !autoPlay}
      >
        {showStop ? (
          <VolumeX className="w-5 h-5" />
        ) : hasContent || autoPlay ? (
          <Volume2 className="w-5 h-5" />
        ) : null}
      </button>
  )
}
