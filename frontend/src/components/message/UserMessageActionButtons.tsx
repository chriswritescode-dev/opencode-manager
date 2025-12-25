import { memo } from 'react'
import { X, Loader2 } from 'lucide-react'
import { useUndoMessage } from '@/hooks/useUndoMessage'
import { useMobile } from '@/hooks/useMobile'

interface UserMessageActionButtonsProps {
  opcodeUrl: string
  sessionId: string
  directory?: string
  userMessageId: string
  userMessageContent: string
  onUndo: (restoredPrompt: string) => void
}

export const UserMessageActionButtons = memo(function UserMessageActionButtons({
  opcodeUrl,
  sessionId,
  directory,
  userMessageId,
  userMessageContent,
  onUndo
}: UserMessageActionButtonsProps) {
  const isMobile = useMobile()
  const undoMessage = useUndoMessage({ 
    opcodeUrl, 
    sessionId, 
    directory,
    onSuccess: onUndo
  })

  const handleUndo = () => {
    if (undoMessage.isPending) return
    undoMessage.mutate({ 
      messageID: userMessageId, 
      messageContent: userMessageContent 
    })
  }

  return (
    <div className={`flex items-center gap-1 ${isMobile ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity`}>
      <button
        onClick={handleUndo}
        disabled={undoMessage.isPending}
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
