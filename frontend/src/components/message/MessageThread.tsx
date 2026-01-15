import { memo, useMemo, useState, useCallback, useEffect } from 'react'
import { MessagePart } from './MessagePart'
import { MessageActionButtons } from './MessageActionButtons'
import { UserMessageActionButtons } from './UserMessageActionButtons'
import { EditableUserMessage, ClickableUserMessage } from './EditableUserMessage'
import { SessionTodoDisplay } from './SessionTodoDisplay'
import { MessageError } from './MessageError'
import type { MessageWithParts } from '@/api/types'
import { useSessionStatusForSession } from '@/stores/sessionStatusStore'
import { useSessionTodos } from '@/stores/sessionTodosStore'
import type { components } from '@/api/opencode-types'
import type { Todo } from '@/components/message/SessionTodoDisplay'
import type { OpenCodeError } from '@/lib/opencode-errors'

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
  onUndoMessage?: (restoredPrompt: string) => void
  model?: string
  agent?: string
}

const isMessageStreaming = (msg: MessageWithParts): boolean => {
  if (msg.info.role !== 'assistant') return false
  return !('completed' in msg.info.time && msg.info.time.completed)
}

function isSessionInRetry(sessionStatus: { type?: string }): boolean {
  return sessionStatus?.type === 'retry'
}

const compareMessageIds = (id1: string, id2: string): number => {
  const num1 = parseInt(id1, 10)
  const num2 = parseInt(id2, 10)
  if (!isNaN(num1) && !isNaN(num2)) return num1 - num2
  return id1.localeCompare(id2)
}

const findLastMessageByRole = (
  messages: MessageWithParts[],
  role: 'user' | 'assistant',
  predicate?: (msg: MessageWithParts) => boolean
): string | undefined => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.info.role === role && (!predicate || predicate(msg))) {
      return msg.info.id
    }
  }
  return undefined
}

export const MessageThread = memo(function MessageThread({ 
  opcodeUrl, 
  sessionID, 
  directory, 
  messages, 
  onFileClick, 
  onChildSessionClick,
  onUndoMessage,
  model,
  agent
}: MessageThreadProps) {
  const [editingUserMessageId, setEditingUserMessageId] = useState<string | null>(null)
  const [editingForAssistantId, setEditingForAssistantId] = useState<string | null>(null)
  const sessionStatus = useSessionStatusForSession(sessionID)
  
  const pendingAssistantId = useMemo(() => {
    if (!messages) return undefined
    return findLastMessageByRole(messages, 'assistant', isMessageStreaming)
  }, [messages])

  const lastAssistantId = useMemo(() => {
    if (!messages) return undefined
    return findLastMessageByRole(messages, 'assistant')
  }, [messages])

  const lastUserMessageId = useMemo(() => {
    if (!messages) return undefined
    return findLastMessageByRole(messages, 'user')
  }, [messages])

  const isSessionBusy = !!pendingAssistantId || isSessionInRetry(sessionStatus)
  const setSessionTodos = useSessionTodos((state) => state.setTodos)

  useEffect(() => {
    if (!messages || messages.length === 0) return

    const latestTodoPart = messages
      .flatMap(msg => msg.parts)
      .filter((part): part is components['schemas']['ToolPart'] => part.type === 'tool' && (part.tool === 'todowrite' || part.tool === 'todoread'))
      .filter(part => part.state.status === 'completed' && 'time' in part.state)
      .sort((a, b) => {
        const aState = a.state as { time?: { end?: number } }
        const bState = b.state as { time?: { end?: number } }
        const aEndTime = aState.time?.end ?? 0
        const bEndTime = bState.time?.end ?? 0
        return bEndTime - aEndTime
      })[0]

if (latestTodoPart) {
const state = latestTodoPart.state
      let todos: Todo[] = []

      if ('metadata' in state && state.metadata?.todos && Array.isArray(state.metadata.todos)) {
        todos = state.metadata.todos as Todo[]
      } else if ('output' in state && state.output) {
        try {
          const parsed = JSON.parse(state.output)
          todos = Array.isArray(parsed)
            ? parsed as Todo[]
            : parsed?.todos ? parsed.todos as Todo[]
            : []
        } catch (_) {
          console.warn('Failed to parse todo output:', _)
        }
      }

      if (todos.length > 0) {
        setSessionTodos(sessionID, todos)
      }
    }
  }, [messages, sessionID, setSessionTodos])

  const handleStartEditUserMessage = useCallback((userMessageId: string, assistantMessageId: string) => {
    setEditingUserMessageId(userMessageId)
    setEditingForAssistantId(assistantMessageId)
  }, [])

  const handleCancelEdit = useCallback(() => {
    setEditingUserMessageId(null)
    setEditingForAssistantId(null)
  }, [])
  
  if (!messages || messages.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        No messages yet. Start a conversation below.
      </div>
    )
  }

  return (
    <div className="flex flex-col space-y-2 p-2 overflow-x-hidden">
      {messages.map((msg, index) => {
        const streaming = isMessageStreaming(msg)
        const isQueued = msg.info.role === 'user' && pendingAssistantId && compareMessageIds(msg.info.id, pendingAssistantId) > 0
        const isLastUserMessage = msg.info.role === 'user' && msg.info.id === lastUserMessageId
        const messageTextContent = getMessageTextContent(msg)

        const nextAssistantMessage = messages.slice(index + 1).find(m => m.info.role === 'assistant')
        const isUserBeforeAssistant = msg.info.role === 'user' && nextAssistantMessage
        const canEditUserMessage = isUserBeforeAssistant && nextAssistantMessage?.info.id === lastAssistantId && !isSessionBusy
        const canUndoUserMessage = isLastUserMessage && nextAssistantMessage && !isSessionBusy && onUndoMessage

        const isEditingThisMessage = editingUserMessageId === msg.info.id

        return (
          <div
            key={msg.info.id}
            className="flex flex-col group"
          >
            {msg.info.role === 'assistant' && streaming && (
              <SessionTodoDisplay sessionID={sessionID} />
            )}
            <div
              className={`w-full rounded-lg p-1.5 ${
                msg.info.role === 'user'
                  ? isQueued 
                    ? 'bg-amber-500/10 border border-amber-500/30'
                    : isEditingThisMessage
                      ? 'bg-blue-600/30 border border-blue-600/50'
                      : 'bg-blue-600/20 border border-blue-600/30'
                  : 'bg-card/50 border border-border'
              } ${streaming ? 'animate-pulse-subtle' : ''}`}
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <div className="flex items-center gap-2">
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
                
                {msg.info.role === 'assistant' && !streaming && !isSessionBusy && !isSessionInRetry(sessionStatus) && (
                  <MessageActionButtons
                    opcodeUrl={opcodeUrl}
                    sessionId={sessionID}
                    directory={directory}
                    message={msg}
                  />
                )}
                
                {canUndoUserMessage && (
                  <UserMessageActionButtons
                    opcodeUrl={opcodeUrl}
                    sessionId={sessionID}
                    directory={directory}
                    userMessageId={msg.info.id}
                    userMessageContent={messageTextContent}
                    onUndo={onUndoMessage}
                  />
                )}
              </div>
              
              <div className="space-y-2">
                {msg.info.role === 'user' && isEditingThisMessage && editingForAssistantId ? (
                  <EditableUserMessage
                    opcodeUrl={opcodeUrl}
                    sessionId={sessionID}
                    directory={directory}
                    content={messageTextContent}
                    assistantMessageId={editingForAssistantId}
                    onCancel={handleCancelEdit}
                    model={model}
                    agent={agent}
                  />
                ) : msg.info.role === 'user' && canEditUserMessage && nextAssistantMessage ? (
                  <ClickableUserMessage
                    content={messageTextContent}
                    onClick={() => handleStartEditUserMessage(msg.info.id, nextAssistantMessage.info.id)}
                    isEditable={true}
                  />
                ) : (
                  msg.parts.map((part, partIndex) => (
                    <div key={`${msg.info.id}-${part.id}-${partIndex}`}>
                      <MessagePart 
                        part={part} 
                        role={msg.info.role}
                        allParts={msg.parts}
                        partIndex={partIndex}
                        onFileClick={onFileClick}
                        onChildSessionClick={onChildSessionClick}
                        messageTextContent={msg.info.role === 'assistant' ? messageTextContent : undefined}
                      />
                    </div>
                  ))
                )}
                {msg.info.role === 'assistant' && 'error' in msg.info && msg.info.error && (
                  <MessageError error={msg.info.error as OpenCodeError} />
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
})