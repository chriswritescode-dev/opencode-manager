import { memo } from 'react'
import type { components } from '@/api/opencode-types'
import { Volume2, Square, Loader2 } from 'lucide-react'
import { TextPart } from './TextPart'
import { PatchPart } from './PatchPart'
import { ToolCallPart } from './ToolCallPart'
import { RetryPart } from './RetryPart'
import { useTTS } from '@/hooks/useTTS'
import { CopyButton } from '@/components/ui/copy-button'

type RetryPartType = components['schemas']['RetryPart']

type Part = components['schemas']['Part']

interface MessagePartProps {
  part: Part
  role?: string
  allParts?: Part[]
  partIndex?: number
  onFileClick?: (filePath: string, lineNumber?: number) => void
  onChildSessionClick?: (sessionId: string) => void
  messageTextContent?: string
}

function getCopyableContent(part: Part, allParts?: Part[]): string {
  switch (part.type) {
    case 'text':
      return part.text || ''
    case 'patch':
      return `Patch: ${part.hash}\nFiles: ${part.files.join(', ')}`
    case 'tool':
      if (part.state.status === 'completed' && part.state.input) {
        return JSON.stringify(part.state.input, null, 2)
      } else if (part.state.status === 'running' && part.state.input) {
        return JSON.stringify(part.state.input, null, 2)
      }
      return `Tool: ${part.tool} (${part.state.status})`
    case 'reasoning':
      return part.text || ''
    case 'snapshot':
      return part.snapshot || ''
    case 'agent':
      return `Agent: ${part.name}`
    case 'step-finish':
      if (allParts) {
        return allParts
          .filter(p => p.type === 'text')
          .map(p => p.text || '')
          .join('\n\n')
          .trim()
      }
      return ''
    case 'file':
      return part.filename || part.url || 'File'
    default:
      return ''
  }
}



interface TTSButtonProps {
  content: string
  className?: string
}

export function TTSButton({ content, className = "" }: TTSButtonProps) {
  const { speak, stop, isEnabled, isPlaying, isLoading, currentText } = useTTS()
  
  if (!isEnabled || !content.trim()) {
    return null
  }
  
  const isThisPlaying = (isPlaying || isLoading) && currentText === content
  
  const handleClick = () => {
    if (isThisPlaying) {
      stop()
    } else {
      speak(content)
    }
  }

  return (
    <button
      onClick={handleClick}
      className={`p-1.5 rounded ${isThisPlaying ? 'bg-red-500/20 text-red-500 hover:bg-red-500/30' : 'bg-card hover:bg-card-hover text-muted-foreground hover:text-foreground'} ${className}`}
      title={isThisPlaying ? "Stop playback" : "Read aloud"}
      disabled={isLoading && currentText !== content}
    >
      {isLoading && isThisPlaying ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : isThisPlaying ? (
        <Square className="w-4 h-4" />
      ) : (
        <Volume2 className="w-4 h-4" />
      )}
    </button>
  )
}



export const MessagePart = memo(function MessagePart({ part, role, allParts, partIndex, onFileClick, onChildSessionClick, messageTextContent }: MessagePartProps) {
  const copyableContent = getCopyableContent(part, allParts)
  
  switch (part.type) {
    case 'text':
      if (role === 'user' && allParts && partIndex !== undefined) {
        const nextPart = allParts[partIndex + 1]
        if (nextPart && nextPart.type === 'file') {
          return null
        }
      }
      return <TextPart part={part} />
    case 'patch':
      return <PatchPart part={part} />
    case 'tool':
      return <ToolCallPart part={part} onFileClick={onFileClick} onChildSessionClick={onChildSessionClick} />
    case 'reasoning':
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
    case 'snapshot':
      return (
        <div className="border border-border rounded-lg p-4 my-2 bg-card">
          <div className="text-xs text-muted-foreground font-mono">Snapshot: {part.snapshot}</div>
        </div>
      )
    case 'agent':
      return (
        <div className="border border-border rounded-lg p-4 my-2 bg-card">
          <div className="text-sm font-medium text-blue-600 dark:text-blue-400">Agent: {part.name}</div>
        </div>
      )
    case 'step-finish':
      return (
        <div className="text-xs text-muted-foreground my-1 flex items-center gap-2">
          <span>${part.cost.toFixed(4)} • {part.tokens.input + part.tokens.output} tokens</span>
          <CopyButton content={copyableContent} title="Copy step complete" />
          {messageTextContent && <TTSButton content={messageTextContent} />}
        </div>
      )
    case 'file':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-muted border border-border text-sm text-foreground">
          <span className="text-blue-600 dark:text-blue-400">@</span>
          <span className="font-medium">{part.filename || 'File'}</span>
        </span>
      )
    case 'retry':
      return <RetryPart part={part as RetryPartType} />
    default:
      return 
  }
})
