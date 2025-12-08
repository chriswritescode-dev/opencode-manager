import { memo, useMemo } from 'react'
import { MessagePart } from './MessagePart'
import type { MessageWithParts } from '@/api/types'

function getMessageTextContent(msg: MessageWithParts): string {
  return msg.parts
    .filter(p => p.type === 'text')
    .map(p => p.text || '')
    .join('\n\n')
    .trim()
}

interface MessageThreadProps {
  opcodeUrl: string
  sessionID: string
  directory?: string
  messages?: MessageWithParts[]
  onFileClick?: (filePath: string, lineNumber?: number) => void
  onChildSessionClick?: (sessionId: string) => void
}

const isMessageStreaming = (msg: MessageWithParts): boolean => {
  if (msg.info.role !== 'assistant') return false
  return !('completed' in msg.info.time && msg.info.time.completed)
}



const findPendingAssistantMessageId = (messages: MessageWithParts[]): string | undefined => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.info.role === 'assistant' && isMessageStreaming(msg)) {
      return msg.info.id
    }
  }
  return undefined
}

export const MessageThread = memo(function MessageThread({ messages, onFileClick, onChildSessionClick }: MessageThreadProps) {
  const pendingAssistantId = useMemo(() => {
    if (!messages) return undefined
    return findPendingAssistantMessageId(messages)
  }, [messages])
  
  if (!messages || messages.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        No messages yet. Start a conversation below.
      </div>
    )
  }

  return (
    <div className="flex flex-col space-y-2 p-2 overflow-x-hidden">
      {messages.map((msg) => {
        const streaming = isMessageStreaming(msg)
        const isQueued = msg.info.role === 'user' && pendingAssistantId && msg.info.id > pendingAssistantId
        
        return (
          <div
            key={msg.info.id}
            className="flex flex-col"
          >
            <div
              className={`w-full rounded-lg p-1.5 ${
                msg.info.role === 'user'
                  ? isQueued 
                    ? 'bg-amber-500/10 border border-amber-500/30'
                    : 'bg-blue-600/20 border border-blue-600/30'
                  : 'bg-card/50 border border-border'
              } ${streaming ? 'animate-pulse-subtle' : ''}`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-medium text-muted-foreground">
                  {msg.info.role === 'user' ? 'You' : (msg.info.role === 'assistant' && 'modelID' in msg.info ? msg.info.modelID : 'Assistant')}
                </span>
                {msg.info.time && (
                  <span className="text-xs text-muted-foreground">
                    {new Date(msg.info.time.created).toLocaleTimeString()}
                  </span>
                )}
                {isQueued && (
                  <span className="text-xs font-semibold bg-amber-500 text-amber-950 px-1.5 py-0.5 rounded">
                    QUEUED
                  </span>
                )}
              </div>
              
              <div className="space-y-2">
                {msg.parts.map((part, index) => (
                  <div key={`${msg.info.id}-${part.id}-${index}`}>
                    <MessagePart 
                      part={part} 
                      role={msg.info.role}
                      allParts={msg.parts}
                      partIndex={index}
                      onFileClick={onFileClick}
                      onChildSessionClick={onChildSessionClick}
                      messageTextContent={msg.info.role === 'assistant' ? getMessageTextContent(msg) : undefined}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
})
