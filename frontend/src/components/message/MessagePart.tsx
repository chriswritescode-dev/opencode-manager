import { memo } from 'react'
import type { SessionMessageAssistant } from '@opencode-manager/shared/opencode'
import { TextPart } from './TextPart'
import { ToolCallPart } from './ToolCallPart'
import { readShowArtifactCall } from '@/lib/artifactTool'
import { useSettings } from '@/hooks/useSettings'
import { cn } from '@/lib/utils'
import { TRANSCRIPT_DETAIL_CLASS } from './transcriptStyles'
import type { ShellNoticeOutcome } from '@/lib/backgroundWork'
import type { WalkthroughSource } from '@opencode-manager/shared/schemas'

type AssistantContentPart = SessionMessageAssistant['content'][number]

interface MessagePartProps {
  part: AssistantContentPart
  messageID?: string
  directory?: string
  repoFullPath?: string
  repoLocalPath?: string
  shellOutcome?: ShellNoticeOutcome
  onFileClick?: (filePath: string, lineNumber?: number) => void
  onChildSessionClick?: (sessionId: string) => void
  onOpenWalkthrough?: (source?: WalkthroughSource) => void
}

export const MessagePart = memo(function MessagePart({ part, messageID, directory, repoFullPath, repoLocalPath, shellOutcome, onFileClick, onChildSessionClick, onOpenWalkthrough }: MessagePartProps) {
  const { preferences } = useSettings()
  const simpleChatMode = preferences?.simpleChatMode ?? false
  const showReasoning = preferences?.showReasoning ?? false

  switch (part.type) {
    case 'text':
      return <TextPart text={part.text} onFileClick={onFileClick} directory={directory} />
    case 'reasoning':
      if (simpleChatMode || !showReasoning) return null
      if (!part.text.trim()) return null
      return (
        <details className="my-1">
          <summary className="cursor-pointer py-0.5 text-sm text-muted-foreground hover:text-foreground">
            Reasoning
          </summary>
          <div className={cn(TRANSCRIPT_DETAIL_CLASS, 'text-sm text-muted-foreground whitespace-pre-wrap')}>
            {part.text}
          </div>
        </details>
      )
    case 'tool':
      if (simpleChatMode && part.name !== 'subagent' && !readShowArtifactCall(part)) return null
      return (
        <ToolCallPart
          part={part}
          messageID={messageID}
          directory={directory}
          repoFullPath={repoFullPath}
          repoLocalPath={repoLocalPath}
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
