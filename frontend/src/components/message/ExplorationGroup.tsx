import { memo, useState } from 'react'
import { ChevronRight, Loader2 } from 'lucide-react'
import type { SessionMessageAssistantTool } from '@opencode-manager/shared/opencode'
import { useSettings } from '@/hooks/useSettings'
import { useToolCallPermission } from '@/contexts/EventContext'
import { explorationLabel, isExplorationComplete } from '@/lib/explorationGroups'
import type { WalkthroughSource } from '@opencode-manager/shared/schemas'
import { MessagePart } from './MessagePart'

interface ExplorationGroupProps {
  parts: SessionMessageAssistantTool[]
  messageID: string
  directory?: string
  onFileClick?: (filePath: string, lineNumber?: number) => void
  onChildSessionClick?: (sessionId: string) => void
  onOpenWalkthrough?: (source?: WalkthroughSource) => void
}

type MemberProps = Omit<ExplorationGroupProps, 'parts'> & { part: SessionMessageAssistantTool }

function PermissionBlockedMember(props: MemberProps) {
  const pendingPermission = useToolCallPermission(props.part.id, props.messageID)
  if (props.part.state.status !== 'running' || pendingPermission === null) return null
  return <MessagePart {...props} />
}

/** Collapsed summary of consecutive read, search, and fetch tool calls, expandable to the individual calls. */
export const ExplorationGroup = memo(function ExplorationGroup({ parts, ...memberProps }: ExplorationGroupProps) {
  const { preferences } = useSettings()
  const [expanded, setExpanded] = useState(preferences?.expandToolCalls ?? false)
  const completed = isExplorationComplete(parts)

  return (
    <div className="my-1">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="group flex w-full min-w-0 items-center gap-2 py-0.5 text-left text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        {completed ? <span className="shrink-0">→</span> : <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" />}
        <span className="truncate">{explorationLabel(parts)}</span>
        <ChevronRight className={`w-3.5 h-3.5 shrink-0 opacity-0 group-hover:opacity-100 transition-transform ${expanded ? 'rotate-90 opacity-100' : ''}`} />
      </button>
      {expanded ? (
        <div className="ml-1.5 border-l border-border pl-3">
          {parts.map((part) => (
            <MessagePart key={part.id} part={part} {...memberProps} />
          ))}
        </div>
      ) : (
        parts.map((part) => <PermissionBlockedMember key={part.id} part={part} {...memberProps} />)
      )}
    </div>
  )
})
