import { memo, useRef, useEffect } from 'react'
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
}

const isMessageStreaming = (msg: MessageWithParts): boolean => {
  if (msg.info.role !== 'assistant') return false
  return !('completed' in msg.info.time && msg.info.time.completed)
}

const isMessageThinking = (msg: MessageWithParts): boolean => {
  if (msg.info.role !== 'assistant') return false
  return msg.parts.length === 0 && isMessageStreaming(msg)
}

export const MessageThread = memo(function MessageThread({ opcodeUrl, sessionID, directory, onFileClick, containerRef }: MessageThreadProps) {
  const { data: messages, isLoading, error } = useMessages(opcodeUrl, sessionID, directory)
  const { preferences } = useSettings()
  const lastMessageCountRef = useRef(0)
  const userJustSentMessageRef = useRef(false)
  const hasInitialScrolledRef = useRef(false)
  
  useEffect(() => {
    if (!containerRef?.current || !messages) return

    const container = containerRef.current
    const currentMessageCount = messages.length
    const previousMessageCount = lastMessageCountRef.current

    if (!hasInitialScrolledRef.current && currentMessageCount > 0) {
      hasInitialScrolledRef.current = true
      container.scrollTop = container.scrollHeight
      lastMessageCountRef.current = currentMessageCount
      return
    }

    const messageAdded = currentMessageCount > previousMessageCount
    lastMessageCountRef.current = currentMessageCount

    const lastMessage = messages[messages.length - 1]
    const isUserMessage = lastMessage?.info.role === 'user'

    if (messageAdded && isUserMessage) {
      userJustSentMessageRef.current = true
      container.scrollTop = container.scrollHeight
      return
    }

    if (!preferences?.autoScroll) return

    const isNearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight < 100

    if (userJustSentMessageRef.current || isNearBottom) {
      container.scrollTop = container.scrollHeight
    }

    if (
      lastMessage?.info.role === 'assistant' &&
      'completed' in lastMessage.info.time &&
      lastMessage.info.time.completed
    ) {
      userJustSentMessageRef.current = false
    }
  }, [messages, preferences?.autoScroll, containerRef])

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
    <div className="flex flex-col space-y-2 p-4 overflow-x-hidden">
      {messages.map((msg) => {
        const streaming = isMessageStreaming(msg)
        const thinking = isMessageThinking(msg)
        
        return (
          <div
            key={msg.info.id}
            className="flex flex-col"
          >
            <div
              className={`w-full rounded-lg p-2 ${
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
