import { useCallback, useEffect, useRef, type RefObject } from 'react'
import type { SessionMessageInfo } from '@opencode-manager/shared/opencode'
import { useTTS } from './useTTS'
import { collectVisibleAssistantTexts } from '@/lib/visibleMessageTexts'
import { showToast } from '@/lib/toast'

export function useSpeakVisibleMessages(
  containerRef: RefObject<HTMLElement | null>,
  messages: SessionMessageInfo[],
  bottomInset: number,
): () => void {
  const { speak, stop, isPlaying, isLoading, isEnabled, state, error, activeMessageId } = useTTS()
  const pendingRef = useRef(false)

  useEffect(() => {
    if (!pendingRef.current) return
    if (activeMessageId !== null || state === 'idle') {
      pendingRef.current = false
      return
    }
    if (state === 'error') {
      showToast.error(error ?? 'Text-to-speech failed')
      pendingRef.current = false
    }
  }, [state, error, activeMessageId])

  return useCallback(() => {
    if (!isEnabled) return
    if (isPlaying || isLoading) {
      pendingRef.current = false
      stop()
      return
    }
    const container = containerRef.current
    if (!container) return
    const texts = collectVisibleAssistantTexts(container, messages, bottomInset)
    if (texts.length === 0) return
    pendingRef.current = true
    void speak(texts.join('\n\n'))
  }, [isEnabled, isPlaying, isLoading, stop, speak, messages, containerRef, bottomInset])
}
