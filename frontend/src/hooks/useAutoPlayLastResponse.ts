import { useEffect, useRef } from 'react'
import { useTTS } from './useTTS'
import { useSettings } from './useSettings'
import type { SessionMessageInfo } from '@opencode-manager/shared/opencode'

interface UseAutoPlayLastResponseParams {
  sessionId: string
  lastAssistantMessage: SessionMessageInfo | undefined
  lastAssistantText: string
  isStreamingResponse: boolean
}

interface PlayableAssistantMessage {
  messageId: string
  text: string
}

export function getAssistantText(message: SessionMessageInfo | undefined): string {
  if (message?.type !== 'assistant') return ''
  return message.content.filter(part => part.type === 'text').map(part => part.text).join('\n\n')
}

export function getLatestPlayableAssistantMessage(messages: SessionMessageInfo[] | undefined): PlayableAssistantMessage | undefined {
  return messages
    ?.filter(message => message.type === 'assistant')
    .map(message => ({ messageId: message.id, text: getAssistantText(message) }))
    .filter(({ text }) => text.trim().length > 0)
    .at(-1)
}

function isMessageCompleted(message: SessionMessageInfo): boolean {
  return message.type === 'assistant' && message.time.completed !== undefined
}

export function useAutoPlayLastResponse({
  sessionId,
  lastAssistantMessage,
  lastAssistantText,
  isStreamingResponse,
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
    
    if (isStreamingResponse || !lastAssistantMessage) {
      return
    }
    
    const messageId = lastAssistantMessage.id
    const isCompleted = isMessageCompleted(lastAssistantMessage)
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
    isStreamingResponse,
    lastAssistantMessage,
    lastAssistantText,
    speakMessage,
  ])
}
