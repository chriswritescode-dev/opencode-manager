import { useEffect, useRef } from 'react'
import { useTTS } from './useTTS'
import { useSettings } from './useSettings'
import type { MessageWithParts } from '@/api/types'

interface UseAutoPlayLastResponseParams {
  sessionId: string
  lastAssistantMessage: MessageWithParts | undefined
  lastAssistantText: string
  hasActiveStream: boolean
}

function isMessageCompleted(message: MessageWithParts['info']): boolean {
  return message.role === 'assistant' && message.time.completed !== undefined
}

export function useAutoPlayLastResponse({
  sessionId,
  lastAssistantMessage,
  lastAssistantText,
  hasActiveStream,
}: UseAutoPlayLastResponseParams): void {
  const { speakMessage, isEnabled: ttsEnabled } = useTTS()
  const { preferences } = useSettings()
  
  const autoPlayEnabled = preferences?.tts?.autoPlay ?? false
  
  const lastSpokenIdRef = useRef<string | null>(null)
  const hasInitializedRef = useRef<boolean>(false)
  const lastKnownCompletedRef = useRef<Record<string, boolean>>({})
  const hasSeenIncompleteRef = useRef<boolean>(false)
  const previousSessionIdRef = useRef<string | null>(null)
  
  useEffect(() => {
    const isSessionChange = previousSessionIdRef.current !== null && previousSessionIdRef.current !== sessionId
    const isFirstMount = previousSessionIdRef.current === null
    previousSessionIdRef.current = sessionId
    
    lastSpokenIdRef.current = null
    hasInitializedRef.current = false
    lastKnownCompletedRef.current = {}
    
    if (isSessionChange) {
      hasSeenIncompleteRef.current = true
    } else if (isFirstMount) {
      hasSeenIncompleteRef.current = false
    }
  }, [sessionId])
  
  useEffect(() => {
    if (!ttsEnabled || !autoPlayEnabled) {
      return
    }
    
    if (hasActiveStream || !lastAssistantMessage) {
      return
    }
    
    const messageId = lastAssistantMessage.info.id
    const isCompleted = isMessageCompleted(lastAssistantMessage.info)
    const wasCompleted = lastKnownCompletedRef.current[messageId] ?? false
    
    if (!isCompleted) {
      lastKnownCompletedRef.current[messageId] = false
      hasSeenIncompleteRef.current = true
      return
    }
    
    if (!lastAssistantText.trim()) {
      return
    }
    
    if (!hasInitializedRef.current) {
      hasInitializedRef.current = true
      lastSpokenIdRef.current = messageId
      lastKnownCompletedRef.current[messageId] = true
      if (hasSeenIncompleteRef.current) {
        speakMessage(messageId, lastAssistantText)
      }
      return
    }
    
    if (!wasCompleted && messageId === lastSpokenIdRef.current) {
      lastKnownCompletedRef.current[messageId] = true
      speakMessage(messageId, lastAssistantText)
      return
    }
    
    if (messageId !== lastSpokenIdRef.current) {
      lastSpokenIdRef.current = messageId
      lastKnownCompletedRef.current[messageId] = true
      speakMessage(messageId, lastAssistantText)
    }
  }, [
    ttsEnabled,
    autoPlayEnabled,
    hasActiveStream,
    lastAssistantMessage,
    lastAssistantText,
    speakMessage,
  ])
}
