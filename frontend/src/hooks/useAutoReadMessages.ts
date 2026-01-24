import { useEffect, useRef, useCallback } from 'react'
import { useTTS } from './useTTS'
import { useSettings } from './useSettings'
import type { MessageWithParts } from '@/api/types'

const STORAGE_KEY = 'autoread-messages'

function getReadMessageIds(): Set<string> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return new Set()
    const parsed = JSON.parse(stored)
    if (!Array.isArray(parsed)) return new Set()
    const now = Date.now()
    const oneDayAgo = now - 24 * 60 * 60 * 1000
    const valid = parsed.filter((item: { id: string; ts: number }) => item.ts > oneDayAgo)
    return new Set(valid.map((item: { id: string }) => item.id))
  } catch {
    return new Set()
  }
}

function markMessageAsRead(messageId: string): void {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    const existing = stored ? JSON.parse(stored) : []
    const now = Date.now()
    const oneDayAgo = now - 24 * 60 * 60 * 1000
    const valid = existing.filter((item: { ts: number }) => item.ts > oneDayAgo)
    valid.push({ id: messageId, ts: now })
    if (valid.length > 100) {
      valid.splice(0, valid.length - 100)
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(valid))
  } catch {
    // Ignore storage errors
  }
}

function getMessageTextContent(msg: MessageWithParts): string {
  return msg.parts
    .filter(p => p.type === 'text')
    .map(p => p.text || '')
    .join('\n\n')
    .trim()
}

function isMessageCompleted(msg: MessageWithParts): boolean {
  if (msg.info.role !== 'assistant') return false
  return 'completed' in msg.info.time && !!msg.info.time.completed
}

interface UseAutoReadMessagesOptions {
  sessionId?: string
  messages?: MessageWithParts[]
  enabled?: boolean
}

export function useAutoReadMessages({ sessionId, messages, enabled = true }: UseAutoReadMessagesOptions) {
  const { preferences } = useSettings()
  const { speak, isPlaying, isLoading } = useTTS()
  const lastReadMessageIdRef = useRef<string | null>(null)
  const processingRef = useRef(false)

  const autoReadEnabled = enabled && 
    preferences?.tts?.enabled && 
    preferences?.tts?.autoReadNewMessages

  const readNewMessage = useCallback(async (text: string, messageId: string) => {
    if (processingRef.current) return
    processingRef.current = true
    
    try {
      markMessageAsRead(messageId)
      lastReadMessageIdRef.current = messageId
      await speak(text)
    } finally {
      processingRef.current = false
    }
  }, [speak])

  useEffect(() => {
    if (!autoReadEnabled || !messages || !sessionId) return
    if (isPlaying || isLoading) return

    const readIds = getReadMessageIds()
    
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      
      if (msg.info.role !== 'assistant') continue
      if (!isMessageCompleted(msg)) continue
      if (readIds.has(msg.info.id)) continue
      if (lastReadMessageIdRef.current === msg.info.id) continue
      
      const text = getMessageTextContent(msg)
      if (!text || text.length < 10) {
        markMessageAsRead(msg.info.id)
        continue
      }
      
      readNewMessage(text, msg.info.id)
      break
    }
  }, [autoReadEnabled, messages, sessionId, isPlaying, isLoading, readNewMessage])

  useEffect(() => {
    lastReadMessageIdRef.current = null
  }, [sessionId])

  return {
    autoReadEnabled: !!autoReadEnabled,
  }
}
