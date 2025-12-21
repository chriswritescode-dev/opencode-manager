import { memo, useState, useRef, useEffect } from 'react'
import { Send, X, Pencil, Loader2 } from 'lucide-react'
import { useRefreshMessage } from '@/hooks/useRemoveMessage'
import { useUIState } from '@/stores/uiStateStore'

interface EditableUserMessageProps {
  opcodeUrl: string
  sessionId: string
  directory?: string
  content: string
  assistantMessageId: string
  onCancel: () => void
  model?: string
  agent?: string
}

export const EditableUserMessage = memo(function EditableUserMessage({
  opcodeUrl,
  sessionId,
  directory,
  content,
  assistantMessageId,
  onCancel,
  model,
  agent
}: EditableUserMessageProps) {
  const [editedContent, setEditedContent] = useState(content)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const refreshMessage = useRefreshMessage({ opcodeUrl, sessionId, directory })
  const setIsEditingMessage = useUIState((state) => state.setIsEditingMessage)

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus()
      textareaRef.current.setSelectionRange(
        textareaRef.current.value.length,
        textareaRef.current.value.length
      )
    }
  }, [])

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`
    }
  }, [editedContent])

  const handleSubmit = () => {
    if (!editedContent.trim() || refreshMessage.isPending) return
    
    refreshMessage.mutate({
      assistantMessageID: assistantMessageId,
      userMessageContent: editedContent.trim(),
      model,
      agent
    }, {
      onSuccess: () => {
        onCancel()
      }
    })
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSubmit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    }
  }

  return (
    <div className="flex flex-col gap-2 w-full">
      <textarea
        ref={textareaRef}
        value={editedContent}
        onChange={(e) => setEditedContent(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => setIsEditingMessage(true)}
        onBlur={() => setIsEditingMessage(false)}
        className="w-full p-3 rounded-lg bg-background border border-primary/50 focus:border-primary focus:ring-1 focus:ring-primary outline-none resize-none min-h-[60px] text-sm"
        placeholder="Edit your message..."
        disabled={refreshMessage.isPending}
      />
      
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          Press <kbd className="px-1 py-0.5 rounded bg-muted text-xs">Cmd+Enter</kbd> to send, <kbd className="px-1 py-0.5 rounded bg-muted text-xs">Esc</kbd> to cancel
        </span>
        
        <div className="flex items-center gap-2">
          <button
            onClick={onCancel}
            disabled={refreshMessage.isPending}
            className="flex items-center gap-1 px-3 py-1.5 rounded text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
          >
            <X className="w-4 h-4" />
            Cancel
          </button>
          
          <button
            onClick={handleSubmit}
            disabled={!editedContent.trim() || refreshMessage.isPending}
            className="flex items-center gap-1 px-3 py-1.5 rounded text-sm bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {refreshMessage.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
            Resend
          </button>
        </div>
      </div>
    </div>
  )
})

interface ClickableUserMessageProps {
  content: string
  onClick: () => void
  isEditable: boolean
}

export const ClickableUserMessage = memo(function ClickableUserMessage({
  content,
  onClick,
  isEditable
}: ClickableUserMessageProps) {
  if (!isEditable) {
    return (
      <div className="text-sm whitespace-pre-wrap break-words">
        {content}
      </div>
    )
  }

  return (
    <button
      onClick={onClick}
      className="text-left text-sm whitespace-pre-wrap break-words w-full group/edit hover:bg-blue-600/10 rounded p-1 -m-1 transition-colors flex items-start gap-2"
      title="Click to edit and resend"
    >
      <span className="flex-1">{content}</span>
      <Pencil className="w-4 h-4 flex-shrink-0 mt-0.5 text-muted-foreground opacity-50 group-hover/edit:opacity-100 group-hover/edit:text-primary transition-all" />
    </button>
  )
})