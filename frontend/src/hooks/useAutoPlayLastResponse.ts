import { useEffect, useRef } from 'react'
import { useTTS } from './useTTS'
import { useSettings } from './useSettings'
import { assistantText, type SessionMessageInfo } from '@opencode-manager/shared/opencode'

interface UseAutoPlayLastResponseParams {
  sessionId: string
  lastAssistantMessage: SessionMessageInfo | undefined
  lastAssistantText: string
  /** Whether a finished reply may start playing; false while hands-free voice owns playback. */
  enabled?: boolean
}

interface PlayableAssistantMessage {
  messageId: string
  text: string
}

export function getAssistantText(message: SessionMessageInfo | undefined): string {
  return message?.type === 'assistant' ? assistantText(message.content) : ''
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
  enabled = true,
}: UseAutoPlayLastResponseParams): void {
  const { queueMessage, isEnabled: ttsEnabled, isPlaying, isLoading, activeMessageId } = useTTS()
  const { preferences } = useSettings()
  
  const autoPlayEnabled = preferences?.tts?.autoPlay ?? false
  
  const lastSpokenIdRef = useRef<string | null>(null)
  const hasInitializedRef = useRef<boolean>(false)
  const lastKnownCompletedRef = useRef<Record<string, boolean>>({})
  const hasSeenIncompleteRef = useRef<boolean>(false)
  const previousSessionIdRef = useRef<string | null>(null)
  const isUnattributedPlaybackActiveRef = useRef<boolean>(false)
  
  const isUnattributedPlaybackActive = (isPlaying || isLoading) && activeMessageId === null
  
  useEffect(() => {
    isUnattributedPlaybackActiveRef.current = isUnattributedPlaybackActive
  }, [isUnattributedPlaybackActive])
  
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
    if (!enabled || !ttsEnabled || !autoPlayEnabled) {
      return
    }
    
    if (!lastAssistantMessage) {
      return
    }
    
    const messageId = lastAssistantMessage.id
    const isCompleted = isMessageCompleted(lastAssistantMessage)
    const wasCompleted = lastKnownCompletedRef.current[messageId] ?? false
    const shouldAutoSpeak = !isUnattributedPlaybackActiveRef.current
    
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
      if (hasSeenIncompleteRef.current && shouldAutoSpeak) {
        queueMessage(messageId, lastAssistantText)
      }
      return
    }
    
    if (!wasCompleted && messageId === lastSpokenIdRef.current) {
      lastKnownCompletedRef.current[messageId] = true
      if (shouldAutoSpeak) {
        queueMessage(messageId, lastAssistantText)
      }
      return
    }
    
    if (messageId !== lastSpokenIdRef.current) {
      lastSpokenIdRef.current = messageId
      lastKnownCompletedRef.current[messageId] = true
      if (shouldAutoSpeak) {
        queueMessage(messageId, lastAssistantText)
      }
    }
  }, [
    enabled,
    ttsEnabled,
    autoPlayEnabled,
    lastAssistantMessage,
    lastAssistantText,
    queueMessage,
  ])
}
