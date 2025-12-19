import { memo } from 'react'
import { X, RefreshCw, Loader2 } from 'lucide-react'
import { useRemoveMessage, useRefreshMessage } from '@/hooks/useRemoveMessage'
import type { MessageWithParts } from '@/api/types'

interface MessageActionButtonsProps {
  opcodeUrl: string
  sessionId: string
  directory?: string
  message: MessageWithParts
  isLastAssistantMessage: boolean
  userMessageContent?: string
  onEditUserMessage?: () => void
  model?: string
  agent?: string
}

export const MessageActionButtons = memo(function MessageActionButtons({
  opcodeUrl,
  sessionId,
  directory,
  message,
  isLastAssistantMessage,
  userMessageContent,
  onEditUserMessage,
  model,
  agent
}: MessageActionButtonsProps) {
  const removeMessage = useRemoveMessage({ opcodeUrl, sessionId, directory })
  const refreshMessage = useRefreshMessage({ opcodeUrl, sessionId, directory })

  const isLoading = removeMessage.isPending || refreshMessage.isPending

  const handleRemove = () => {
    if (isLoading) return
    removeMessage.mutate({ messageID: message.info.id })
  }

  const handleRefresh = () => {
    if (isLoading || !userMessageContent) return
    
    if (onEditUserMessage) {
      onEditUserMessage()
    } else {
      refreshMessage.mutate({
        assistantMessageID: message.info.id,
        userMessageContent,
        model,
        agent
      })
    }
  }

  if (message.info.role !== 'assistant') {
    return null
  }

  return (
    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
      <button
        onClick={handleRemove}
        disabled={isLoading}
        className="p-1 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
        title="Remove this message and all after it"
      >
        {removeMessage.isPending ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <X className="w-3.5 h-3.5" />
        )}
      </button>
      
      {isLastAssistantMessage && userMessageContent && (
        <button
          onClick={handleRefresh}
          disabled={isLoading}
          className="p-1 rounded hover:bg-primary/20 text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
          title="Try this prompt again"
        >
          {refreshMessage.isPending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <RefreshCw className="w-3.5 h-3.5" />
          )}
        </button>
      )}
    </div>
  )
})