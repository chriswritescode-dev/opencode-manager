import { memo } from 'react'
import type { SessionMessageAssistant } from '@opencode-manager/shared/opencode'
import { TextPart } from './TextPart'
import { ToolCallPart } from './ToolCallPart'
import { useSettings } from '@/hooks/useSettings'

export type AssistantContentPart = SessionMessageAssistant['content'][number]

interface MessagePartProps {
  part: AssistantContentPart
  onFileClick?: (filePath: string, lineNumber?: number) => void
  onChildSessionClick?: (sessionId: string) => void
}

export const MessagePart = memo(function MessagePart({ part, onFileClick, onChildSessionClick }: MessagePartProps) {
  const { preferences } = useSettings()
  const simpleChatMode = preferences?.simpleChatMode ?? false
  const showReasoning = preferences?.showReasoning ?? false

  switch (part.type) {
    case 'text':
      return <TextPart text={part.text} />
    case 'reasoning':
      if (simpleChatMode || !showReasoning) return null
      if (!part.text.trim()) return null
      return (
        <details className="border border-border rounded-lg my-2">
          <summary className="px-4 py-2 bg-muted hover:bg-accent cursor-pointer text-sm font-medium">
            Reasoning
          </summary>
          <div className="p-4 bg-card text-sm text-muted-foreground whitespace-pre-wrap">
            {part.text}
          </div>
        </details>
      )
    case 'tool':
      if (simpleChatMode && part.name !== 'subagent') return null
      return (
        <ToolCallPart
          part={part}
          onFileClick={onFileClick}
          onChildSessionClick={onChildSessionClick}
        />
      )
    default:
      return null
  }
})
