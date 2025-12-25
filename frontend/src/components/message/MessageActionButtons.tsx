import { memo } from 'react'
import { X, Loader2 } from 'lucide-react'
import { useRemoveMessage } from '@/hooks/useRemoveMessage'
import { useMobile } from '@/hooks/useMobile'
import type { MessageWithParts } from '@/api/types'

interface MessageActionButtonsProps {
  opcodeUrl: string
  sessionId: string
  directory?: string
  message: MessageWithParts
}

export const MessageActionButtons = memo(function MessageActionButtons({
  opcodeUrl,
  sessionId,
  directory,
  message
}: MessageActionButtonsProps) {
  const isMobile = useMobile()
  const removeMessage = useRemoveMessage({ opcodeUrl, sessionId, directory })

  const handleRemove = () => {
    if (removeMessage.isPending) return
    removeMessage.mutate({ messageID: message.info.id })
  }

  if (message.info.role !== 'assistant') {
    return null
  }

  return (
    <div className={`flex items-center gap-1 ${isMobile ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity`}>
      <button
        onClick={handleRemove}
        disabled={removeMessage.isPending}
        className="p-1 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
        title="Remove this message and all after it"
      >
        {removeMessage.isPending ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <X className="w-3.5 h-3.5" />
        )}
      </button>
    </div>
  )
})
