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
    ? 'Stop playback (hold to toggle auto-play)'
    : hasContent
      ? autoPlay
        ? 'Play latest reply (auto-play enabled; hold to toggle auto-play)'
        : 'Play latest reply (hold to toggle auto-play)'
      : autoPlay
        ? 'Auto-play enabled (hold to toggle auto-play)'
        : 'Hold to toggle auto-play'
  const pillAriaLabel = pillTitle
  const buttonToneClasses = showStop
    ? 'justify-center px-3 py-1.5 rounded-lg bg-gradient-to-br from-red-600 to-red-700 border border-red-500/60 shadow-red-500/30 ring-red-500/20 hover:ring-red-500/40 text-white'
    : autoPlay
      ? 'justify-center px-3 py-1.5 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 border border-blue-400/60 shadow-blue-500/30 ring-blue-500/20 hover:ring-blue-500/40 text-white'
      : 'justify-center px-3 py-1.5 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 border border-amber-400/60 shadow-amber-500/30 ring-amber-500/20 hover:ring-amber-500/40 text-white'

  return (
      <button
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        className={`absolute -top-5 right-0 md:right-4 z-50 flex items-center transition-all duration-200 shadow-md backdrop-blur-md ring-1 ${buttonToneClasses} ${isLongPressVisual ? 'scale-95 opacity-80' : 'active:scale-95 hover:scale-105'} ${!hasContent && !autoPlay ? 'opacity-50 cursor-not-allowed' : ''}`}
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
