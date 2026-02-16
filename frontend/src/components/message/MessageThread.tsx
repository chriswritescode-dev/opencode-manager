import { memo, useMemo, useState, useCallback, useEffect } from 'react'
import { Pencil } from 'lucide-react'
import { MessagePart } from './MessagePart'
import { UserMessageActionButtons } from './UserMessageActionButtons'
import { EditableUserMessage, ClickableUserMessage } from './EditableUserMessage'
import { MessageError } from './MessageError'
import type { Message, Part, MessageWithParts } from '@/api/types'
import { useSessionStatusForSession } from '@/stores/sessionStatusStore'
import { useSessionTodos } from '@/stores/sessionTodosStore'
import type { components } from '@/api/opencode-types'
import type { Todo } from '@/components/message/SessionTodoDisplay'
import type { OpenCodeError } from '@/lib/opencode-errors'

function getMessageTextContent(parts: Part[]): string {
  return parts
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
}

const isMessageStreaming = (msg: Message): boolean => {
  if (msg.role !== 'assistant') return false
  return !('completed' in msg.time && msg.time.completed)
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
  predicate?: (msg: Message) => boolean
): string | undefined => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i].info
    if (msg.role === role && (!predicate || predicate(msg))) {
      return msg.id
    }
  }
  return undefined
}

interface MessageRowProps {
  msgWithParts: MessageWithParts
  index: number
  messages: MessageWithParts[]
  pendingAssistantId: string | undefined
  lastUserMessageId: string | undefined
  isSessionBusy: boolean
  onUndoMessage?: (restoredPrompt: string) => void
  editingUserMessageId: string | null
  editingForAssistantId: string | null
  opcodeUrl: string
  sessionID: string
  directory?: string
  onFileClick?: (filePath: string, lineNumber?: number) => void
  onChildSessionClick?: (sessionId: string) => void
  handleStartEditUserMessage: (userMessageId: string, assistantMessageId: string) => void
  handleCancelEdit: () => void
  model?: string
}

const MessageRow = memo(function MessageRow({
  msgWithParts,
  index,
  messages,
  pendingAssistantId,
  lastUserMessageId,
  isSessionBusy,
  onUndoMessage,
  editingUserMessageId,
  editingForAssistantId,
  opcodeUrl,
  sessionID,
  directory,
  onFileClick,
  onChildSessionClick,
  handleStartEditUserMessage,
  handleCancelEdit,
  model,
}: MessageRowProps) {
  const msg = msgWithParts.info
  const parts = msgWithParts.parts
  const streaming = isMessageStreaming(msg)
  const isQueued = msg.role === 'user' && pendingAssistantId && compareMessageIds(msg.id, pendingAssistantId) > 0
  const isLastUserMessage = msg.role === 'user' && msg.id === lastUserMessageId
  const messageTextContent = getMessageTextContent(parts)

  const nextAssistantMessage = messages.slice(index + 1).find(m => m.info.role === 'assistant')
  const nextAssistantMsg = nextAssistantMessage?.info
  const isUserBeforeAssistant = msg.role === 'user' && nextAssistantMessage
  const canEditUserMessage = isLastUserMessage && isUserBeforeAssistant && !isSessionBusy
  const canUndoUserMessage = isLastUserMessage && nextAssistantMessage && !isSessionBusy && onUndoMessage

  const isEditingThisMessage = editingUserMessageId === msg.id

  return (
    <div
      key={msg.id}
      className="flex flex-col group"
    >
      <div
        className={`w-full rounded-lg p-1.5 ${
          msg.role === 'user'
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
              {msg.role === 'user' ? 'You' : (msg.role === 'assistant' && 'modelID' in msg ? msg.modelID : 'Assistant')}
            </span>
            {msg.time && (
              <span className="text-xs text-muted-foreground">
                {new Date(msg.time.created).toLocaleTimeString()}
              </span>
            )}
            {canEditUserMessage && nextAssistantMsg && (
              <button
                onClick={() => handleStartEditUserMessage(msg.id, nextAssistantMsg.id)}
                className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                title="Edit message"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            )}
            {isQueued && (
              <span className="text-xs font-semibold bg-amber-500 text-amber-950 px-1.5 py-0.5 rounded">
                QUEUED
              </span>
            )}
          </div>
          
          {msg.role === 'user' && canUndoUserMessage && (
            <UserMessageActionButtons
              opcodeUrl={opcodeUrl}
              sessionId={sessionID}
              directory={directory}
              userMessageId={msg.id}
              userMessageContent={messageTextContent}
              onUndo={onUndoMessage}
            />
          )}
        </div>
        
        <div className="space-y-2">
          {msg.role === 'user' && isEditingThisMessage && editingForAssistantId ? (
            <EditableUserMessage
              opcodeUrl={opcodeUrl}
              sessionId={sessionID}
              directory={directory}
              content={messageTextContent}
              assistantMessageId={editingForAssistantId}
              onCancel={handleCancelEdit}
              model={model}
            />
          ) : msg.role === 'user' && canEditUserMessage && nextAssistantMsg ? (
            <ClickableUserMessage
              content={messageTextContent}
              onClick={() => handleStartEditUserMessage(msg.id, nextAssistantMsg.id)}
              isEditable={false}
            />
          ) : parts.length > 0 ? (
            parts.map((part: Part, partIndex: number) => (
              <div key={`${msg.id}-${part.id}-${partIndex}`}>
                <MessagePart
                  part={part}
                  role={msg.role}
                  allParts={parts}
                  partIndex={partIndex}
                  onFileClick={onFileClick}
                  onChildSessionClick={onChildSessionClick}
                  messageTextContent={msg.role === 'assistant' ? messageTextContent : undefined}
                />
              </div>
            ))
          ) : null}
          {msg.role === 'assistant' && 'error' in msg && msg.error && (
            <MessageError error={msg.error as OpenCodeError} />
          )}
        </div>
      </div>
    </div>
  )
})

export const MessageThread = memo(function MessageThread({ 
  opcodeUrl, 
  sessionID, 
  directory, 
  messages, 
  onFileClick, 
  onChildSessionClick,
  onUndoMessage,
  model
}: MessageThreadProps) {
  const [editingUserMessageId, setEditingUserMessageId] = useState<string | null>(null)
  const [editingForAssistantId, setEditingForAssistantId] = useState<string | null>(null)
  const sessionStatus = useSessionStatusForSession(sessionID)
  
  const pendingAssistantId = useMemo(() => {
    if (!messages) return undefined
    return findLastMessageByRole(messages, 'assistant', isMessageStreaming)
  }, [messages])

  const lastUserMessageId = useMemo(() => {
    if (!messages) return undefined
    return findLastMessageByRole(messages, 'user')
  }, [messages])

  const isSessionBusy = !!pendingAssistantId || isSessionInRetry(sessionStatus)
  const setSessionTodos = useSessionTodos((state) => state.setTodos)

  useEffect(() => {
    if (!messages || messages.length === 0) return

    const allParts = messages.flatMap(m => m.parts)

    const latestTodoPart = allParts
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
      {messages.map((msgWithParts, index) => (
        <MessageRow
          key={msgWithParts.info.id}
          msgWithParts={msgWithParts}
          index={index}
          messages={messages}
          pendingAssistantId={pendingAssistantId}
          lastUserMessageId={lastUserMessageId}
          isSessionBusy={isSessionBusy}
          onUndoMessage={onUndoMessage}
          editingUserMessageId={editingUserMessageId}
          editingForAssistantId={editingForAssistantId}
          opcodeUrl={opcodeUrl}
          sessionID={sessionID}
          directory={directory}
          onFileClick={onFileClick}
          onChildSessionClick={onChildSessionClick}
          handleStartEditUserMessage={handleStartEditUserMessage}
          handleCancelEdit={handleCancelEdit}
          model={model}
        />
      ))}
    </div>
  )
})
