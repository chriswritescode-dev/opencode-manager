import { memo } from 'react'
import { X, RefreshCw, Loader2 } from 'lucide-react'
import { useUndoMessage } from '@/hooks/useUndoMessage'
import { useRefreshMessage } from '@/hooks/useRemoveMessage'

interface UserMessageActionButtonsProps {
  opcodeUrl: string
  sessionId: string
  directory?: string
  userMessageId: string
  userMessageContent: string
  assistantMessageId: string
  onUndo: (restoredPrompt: string) => void
  model?: string
  agent?: string
}

export const UserMessageActionButtons = memo(function UserMessageActionButtons({
  opcodeUrl,
  sessionId,
  directory,
  userMessageId,
  userMessageContent,
  assistantMessageId,
  onUndo,
  model,
  agent
}: UserMessageActionButtonsProps) {
  const undoMessage = useUndoMessage({ 
    opcodeUrl, 
    sessionId, 
    directory,
    onSuccess: onUndo
  })
  const refreshMessage = useRefreshMessage({ opcodeUrl, sessionId, directory })

  const isLoading = undoMessage.isPending || refreshMessage.isPending

  const handleUndo = () => {
    if (isLoading) return
    undoMessage.mutate({ 
      messageID: userMessageId, 
      messageContent: userMessageContent 
    })
  }

  const handleRefresh = () => {
    if (isLoading || !userMessageContent) return
    refreshMessage.mutate({
      assistantMessageID: assistantMessageId,
      userMessageContent,
      model,
      agent
    })
  }

  return (
    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
      <button
        onClick={handleRefresh}
        disabled={isLoading}
        className="p-1 rounded hover:bg-primary/20 text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
        title="Try again for different response"
      >
        {refreshMessage.isPending ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <RefreshCw className="w-3.5 h-3.5" />
        )}
      </button>
      
      <button
        onClick={handleUndo}
        disabled={isLoading}
        className="p-1 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
        title="Undo this message"
      >
        {undoMessage.isPending ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <X className="w-3.5 h-3.5" />
        )}
      </button>
    </div>
  )
})
