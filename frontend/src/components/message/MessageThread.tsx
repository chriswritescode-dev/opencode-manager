import { memo, useRef, useEffect, useCallback } from 'react'
import { useMessages } from '@/hooks/useOpenCode'
import { useSettings } from '@/hooks/useSettings'
import { MessagePart } from './MessagePart'
import type { MessageWithParts } from '@/api/types'

interface MessageThreadProps {
  opcodeUrl: string
  sessionID: string
  directory?: string
  onFileClick?: (filePath: string, lineNumber?: number) => void
  containerRef?: React.RefObject<HTMLDivElement | null>
  onScrollStateChange?: (isScrolledUp: boolean) => void
}

const isMessageStreaming = (msg: MessageWithParts): boolean => {
  if (msg.info.role !== 'assistant') return false
  return !('completed' in msg.info.time && msg.info.time.completed)
}

const isMessageThinking = (msg: MessageWithParts): boolean => {
  if (msg.info.role !== 'assistant') return false
  return msg.parts.length === 0 && isMessageStreaming(msg)
}

const SCROLL_THRESHOLD = 150
const SCROLL_DEBOUNCE_MS = 50

export const MessageThread = memo(function MessageThread({ opcodeUrl, sessionID, directory, onFileClick, containerRef, onScrollStateChange }: MessageThreadProps) {
  const { data: messages, isLoading, error } = useMessages(opcodeUrl, sessionID, directory)
  const { preferences } = useSettings()
  const lastMessageCountRef = useRef(0)
  const userScrolledUpRef = useRef(false)
  const hasInitialScrolledRef = useRef(false)
  const scrollRAFRef = useRef<number | null>(null)
  const lastScrollTimeRef = useRef(0)
  
  const scrollToBottom = useCallback((force = false) => {
    if (!containerRef?.current) return
    
    const now = Date.now()
    if (!force && now - lastScrollTimeRef.current < SCROLL_DEBOUNCE_MS) {
      return
    }
    lastScrollTimeRef.current = now
    
    if (scrollRAFRef.current) {
      cancelAnimationFrame(scrollRAFRef.current)
    }
    
    scrollRAFRef.current = requestAnimationFrame(() => {
      if (containerRef?.current) {
        containerRef.current.scrollTop = containerRef.current.scrollHeight
        userScrolledUpRef.current = false
        onScrollStateChange?.(false)
      }
      scrollRAFRef.current = null
    })
  }, [containerRef, onScrollStateChange])

  useEffect(() => {
    if (!containerRef?.current) return
    
    const container = containerRef.current
    
    const handleScroll = () => {
      const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
      const isScrolledUp = distanceFromBottom > SCROLL_THRESHOLD
      if (userScrolledUpRef.current !== isScrolledUp) {
        userScrolledUpRef.current = isScrolledUp
        onScrollStateChange?.(isScrolledUp)
      }
    }
    
    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => container.removeEventListener('scroll', handleScroll)
  }, [containerRef, onScrollStateChange])
  
  useEffect(() => {
    if (!containerRef?.current || !messages) return

    const currentMessageCount = messages.length
    const previousMessageCount = lastMessageCountRef.current

    if (!hasInitialScrolledRef.current && currentMessageCount > 0) {
      hasInitialScrolledRef.current = true
      scrollToBottom(true)
      lastMessageCountRef.current = currentMessageCount
      return
    }

    const messageAdded = currentMessageCount > previousMessageCount
    lastMessageCountRef.current = currentMessageCount

    const lastMessage = messages[messages.length - 1]
    const isUserMessage = lastMessage?.info.role === 'user'

    if (messageAdded && isUserMessage) {
      userScrolledUpRef.current = false
      scrollToBottom(true)
      return
    }

    if (!preferences?.autoScroll) return

    if (!userScrolledUpRef.current) {
      scrollToBottom()
    }
  }, [messages, preferences?.autoScroll, containerRef, scrollToBottom])

  useEffect(() => {
    return () => {
      if (scrollRAFRef.current) {
        cancelAnimationFrame(scrollRAFRef.current)
      }
    }
  }, [])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-500">
        Loading messages...
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-red-400">
        Error loading messages: {error instanceof Error ? error.message : 'Unknown error'}
      </div>
    )
  }

  if (!messages || messages.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-600">
        No messages yet. Start a conversation below.
      </div>
    )
  }

  return (
    <div className="flex flex-col space-y-2 p-2 overflow-x-hidden">
      {messages.map((msg) => {
        const streaming = isMessageStreaming(msg)
        const thinking = isMessageThinking(msg)
        
        return (
          <div
            key={msg.info.id}
            className="flex flex-col"
          >
            <div
              className={`w-full rounded-lg p-1.5 ${
                msg.info.role === 'user'
                  ? 'bg-blue-600/20 border border-blue-600/30'
                  : 'bg-card/50 border border-border'
              } ${streaming ? 'animate-pulse-subtle' : ''}`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-medium text-zinc-400">
                  {msg.info.role === 'user' ? 'You' : (msg.info.role === 'assistant' && 'modelID' in msg.info ? msg.info.modelID : 'Assistant')}
                </span>
                {msg.info.time && (
                  <span className="text-xs text-muted-foreground">
                    {new Date(msg.info.time.created).toLocaleTimeString()}
                  </span>
                )}
                {streaming && (
                  <span className="text-xs text-blue-400 flex items-center gap-1">
                    <span className="animate-pulse">●</span> <span className="shine-loading">Generating...</span>
                  </span>
                )}
              </div>
              
              {thinking ? (
                <div className="flex items-center gap-2 text-zinc-500">
                  <span className="animate-pulse">▋</span>
                  <span className="text-sm shine-loading">Thinking...</span>
                </div>
              ) : (
                <div className="space-y-2">
                  {msg.parts.map((part, index) => (
                    <div key={`${msg.info.id}-${part.id}-${index}`}>
                      <MessagePart 
                        part={part} 
                        role={msg.info.role}
                        allParts={msg.parts}
                        partIndex={index}
                        onFileClick={onFileClick}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
})
