import { memo } from 'react'
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
}

const isMessageStreaming = (msg: MessageWithParts): boolean => {
  if (msg.info.role !== 'assistant') return false
  return !('completed' in msg.info.time && msg.info.time.completed)
}

const isMessageThinking = (msg: MessageWithParts): boolean => {
  if (msg.info.role !== 'assistant') return false
  return msg.parts.length === 0 && isMessageStreaming(msg)
}

export const MessageThread = memo(function MessageThread({ messages, onFileClick }: MessageThreadProps) {
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
                <span className="text-xs font-medium text-muted-foreground">
                  {msg.info.role === 'user' ? 'You' : (msg.info.role === 'assistant' && 'modelID' in msg.info ? msg.info.modelID : 'Assistant')}
                </span>
                {msg.info.time && (
                  <span className="text-xs text-muted-foreground">
                    {new Date(msg.info.time.created).toLocaleTimeString()}
                  </span>
                )}
                {streaming && (
                  <span className="text-xs text-blue-600 dark:text-blue-400 flex items-center gap-1">
                    <span className="animate-pulse">●</span> <span className="shine-loading">Generating...</span>
                  </span>
                )}
              </div>
              
              {thinking ? (
                <div className="flex items-center gap-2 text-muted-foreground">
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
                        messageTextContent={msg.info.role === 'assistant' ? getMessageTextContent(msg) : undefined}
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
