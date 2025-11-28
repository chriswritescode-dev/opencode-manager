import { useState } from 'react'
import type { components } from '@/api/opencode-types'
import { useSettings } from '@/hooks/useSettings'
import { detectFileReferences } from '@/lib/fileReferences'

type ToolPart = components['schemas']['ToolPart']

interface ToolCallPartProps {
  part: ToolPart
  onFileClick?: (filePath: string, lineNumber?: number) => void
}

function ClickableJson({ json, onFileClick }: { json: unknown; onFileClick?: (filePath: string) => void }) {
  const jsonString = JSON.stringify(json, null, 2)
  const references = detectFileReferences(jsonString)

  if (references.length === 0) {
    return <pre className="bg-accent p-2 rounded text-xs overflow-x-auto">{jsonString}</pre>
  }

  const parts: React.ReactNode[] = []
  let lastIndex = 0

  references.forEach((ref, index) => {
    if (ref.startIndex > lastIndex) {
      parts.push(jsonString.slice(lastIndex, ref.startIndex))
    }

    parts.push(
      <span
        key={`ref-${index}`}
        onClick={(e) => {
          e.stopPropagation()
          onFileClick?.(ref.filePath)
        }}
        className="text-blue-300 hover:text-blue-200 cursor-pointer underline decoration-dotted"
        title={`Click to open ${ref.filePath}`}
      >
        {ref.fullMatch}
      </span>
    )

    lastIndex = ref.endIndex
  })

  if (lastIndex < jsonString.length) {
    parts.push(jsonString.slice(lastIndex))
  }

  return <pre className="bg-accent p-2 rounded text-xs overflow-x-auto">{parts}</pre>
}

export function ToolCallPart({ part, onFileClick }: ToolCallPartProps) {
  const { preferences } = useSettings()
  const defaultExpanded = preferences?.expandToolCalls ?? false
  const [expanded, setExpanded] = useState(defaultExpanded)

  const getStatusColor = () => {
    switch (part.state.status) {
      case 'completed':
        return 'text-green-400'
      case 'error':
        return 'text-red-400'
      case 'running':
        return 'text-yellow-400'
      default:
        return 'text-zinc-400'
    }
  }

  const getStatusIcon = () => {
    switch (part.state.status) {
      case 'completed':
        return '✓'
      case 'error':
        return '✗'
      case 'running':
        return '⟳'
      default:
        return '○'
    }
  }

  const getPreviewText = () => {
    if (part.state.status === 'pending') return null
    
    const input = part.state.input as Record<string, unknown>
    if (!input) return null

    switch (part.tool) {
      case 'read':
      case 'write':
      case 'edit':
        return (input.filePath as string) || null
      case 'bash':
        return (input.command as string) || null
      case 'glob':
        return (input.pattern as string) || null
      case 'grep':
        return (input.pattern as string) || null
      case 'list':
        return (input.path as string) || '.'
      case 'task':
        return (input.description as string) || null
      default:
        return null
    }
  }

  const previewText = getPreviewText()
  const isFileTool = ['read', 'write', 'edit'].includes(part.tool)

  return (
    <div className="border border-border rounded-lg overflow-hidden my-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-2 bg-card hover:bg-card-hover text-left flex items-center gap-2 text-sm min-w-0"
      >
        <span className={getStatusColor()}>{getStatusIcon()}</span>
        <span className="font-medium">{part.tool}</span>
        {previewText && isFileTool ? (
          <span
            onClick={(e) => {
              e.stopPropagation()
              if (onFileClick) {
                onFileClick(previewText)
              }
            }}
            className="text-blue-300 text-xs truncate hover:text-blue-200 cursor-pointer underline decoration-dotted"
            title={`Click to open ${previewText}`}
          >
            {previewText}
          </span>
        ) : previewText ? (
          <span className="text-zinc-400 text-xs truncate">{previewText}</span>
        ) : null}
        <span className="text-muted-foreground text-xs ml-auto">({part.state.status})</span>
      </button>

      {expanded && (
        <div className="bg-card p-4 space-y-2">
          {part.state.status === 'running' && (
            <div className="text-sm">
              <div className="text-zinc-400 mb-1">Input:</div>
              <ClickableJson json={part.state.input} onFileClick={onFileClick} />
            </div>
          )}

          {part.state.status === 'completed' && (
            <>
              <div className="text-sm">
                <div className="text-zinc-400 mb-1">Input:</div>
                <ClickableJson json={part.state.input} onFileClick={onFileClick} />
              </div>
              <div className="text-sm">
                <div className="text-zinc-400 mb-1">Output:</div>
                <pre className="bg-accent p-2 rounded text-xs overflow-x-auto whitespace-pre-wrap">
                  {part.state.output}
                </pre>
              </div>
              {part.state.time && (
                <div className="text-xs text-zinc-500">
                  Duration: {((part.state.time.end - part.state.time.start) / 1000).toFixed(2)}s
                </div>
              )}
            </>
          )}

          {part.state.status === 'error' && (
            <div className="text-sm">
              <div className="text-red-400 mb-1">Error:</div>
              <pre className="bg-accent p-2 rounded text-xs overflow-x-auto text-red-300">
                {part.state.error}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
