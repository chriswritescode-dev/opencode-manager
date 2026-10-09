import { memo } from 'react'
import type { SessionMessageAssistant } from '@opencode-manager/shared/opencode'
import { TextPart } from './TextPart'
import { ToolCallPart } from './ToolCallPart'
import { useSettings } from '@/hooks/useSettings'
import type { ShellNoticeOutcome } from '@/lib/backgroundWork'
import type { WalkthroughSource } from '@opencode-manager/shared/schemas'

type AssistantContentPart = SessionMessageAssistant['content'][number]

interface MessagePartProps {
  part: AssistantContentPart
  messageID?: string
  directory?: string
  shellOutcome?: ShellNoticeOutcome
  onFileClick?: (filePath: string, lineNumber?: number) => void
  onChildSessionClick?: (sessionId: string) => void
  onOpenWalkthrough?: (source?: WalkthroughSource) => void
}

export const MessagePart = memo(function MessagePart({ part, messageID, directory, shellOutcome, onFileClick, onChildSessionClick, onOpenWalkthrough }: MessagePartProps) {
  const { preferences } = useSettings()
  const simpleChatMode = preferences?.simpleChatMode ?? false
  const showReasoning = preferences?.showReasoning ?? false

  switch (part.type) {
    case 'text':
      return <TextPart text={part.text} onFileClick={onFileClick} />
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
          messageID={messageID}
          directory={directory}
          shellOutcome={shellOutcome}
          onFileClick={onFileClick}
          onChildSessionClick={onChildSessionClick}
          onOpenWalkthrough={onOpenWalkthrough}
        />
      )
    default:
      return null
  }
})
