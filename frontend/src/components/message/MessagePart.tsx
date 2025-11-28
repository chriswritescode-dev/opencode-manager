import { memo } from 'react'
import type { components } from '@/api/opencode-types'
import { Copy } from 'lucide-react'
import { TextPart } from './TextPart'
import { PatchPart } from './PatchPart'
import { ToolCallPart } from './ToolCallPart'

type Part = components['schemas']['Part']

interface MessagePartProps {
  part: Part
  role?: string
  allParts?: Part[]
  partIndex?: number
  onFileClick?: (filePath: string, lineNumber?: number) => void
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

function CopyButton({ content, title, className = "" }: { content: string; title: string; className?: string }) {
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content)
    } catch (error) {
      console.error('Failed to copy content:', error)
    }
  }

  if (!content.trim()) {
    return null
  }

  return (
    <button
      onClick={handleCopy}
      className={`p-1.5 rounded bg-card hover:bg-card-hover text-muted-foreground hover:text-foreground ${className}`}
      title={title}
    >
      <Copy className="w-4 h-4" />
    </button>
  )
}



export const MessagePart = memo(function MessagePart({ part, role, allParts, partIndex, onFileClick }: MessagePartProps) {
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
      return <ToolCallPart part={part} onFileClick={onFileClick} />
    case 'reasoning':
      return (
        <details className="border border-zinc-800 rounded-lg my-2">
          <summary className="px-4 py-2 bg-zinc-900 hover:bg-zinc-800 cursor-pointer text-sm font-medium">
            Reasoning
          </summary>
          <div className="p-4 bg-zinc-950 text-sm text-zinc-300 whitespace-pre-wrap">
            {part.text}
          </div>
        </details>
      )
    case 'snapshot':
      return (
        <div className="border border-zinc-800 rounded-lg p-4 my-2 bg-zinc-950">
          <div className="text-xs text-zinc-500 font-mono">Snapshot: {part.snapshot}</div>
        </div>
      )
    case 'agent':
      return (
        <div className="border border-zinc-800 rounded-lg p-4 my-2 bg-zinc-950">
          <div className="text-sm font-medium text-blue-400">Agent: {part.name}</div>
        </div>
      )
    case 'step-finish':
      return (
        <div className="text-xs text-muted-foreground my-1 flex items-center gap-2">
          <span>${part.cost.toFixed(4)} • {part.tokens.input + part.tokens.output} tokens</span>
          <CopyButton content={copyableContent} title="Copy step complete" />
        </div>
      )
    case 'file':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-zinc-800 border border-zinc-700 text-sm text-zinc-300">
          <span className="text-blue-400">@</span>
          <span className="font-medium">{part.filename || 'File'}</span>
        </span>
      )
    default:
      return 
  }
})
