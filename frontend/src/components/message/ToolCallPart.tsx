import { useState, useRef, useEffect } from 'react'
import type { components } from '@/api/opencode-types'
import { useSettings } from '@/hooks/useSettings'
import { useUserBash } from '@/stores/userBashStore'
import { detectFileReferences } from '@/lib/fileReferences'
import { ExternalLink, Loader2 } from 'lucide-react'
import { CopyButton } from '@/components/ui/copy-button'
import { TodoListDisplay } from './TodoListDisplay'

type ToolPart = components['schemas']['ToolPart']
type Todo = components['schemas']['Todo']

interface ToolCallPartProps {
  part: ToolPart
  onFileClick?: (filePath: string, lineNumber?: number) => void
  onChildSessionClick?: (sessionId: string) => void
}

function ClickableJson({ json, onFileClick }: { json: unknown; onFileClick?: (filePath: string) => void }) {
  const jsonString = JSON.stringify(json, null, 2)
  const references = detectFileReferences(jsonString)

  if (references.length === 0) {
    return <pre className="bg-accent p-2 rounded text-xs overflow-x-auto whitespace-pre-wrap break-words">{jsonString}</pre>
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
        className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 cursor-pointer underline decoration-dotted"
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

  return <pre className="bg-accent p-2 rounded text-xs overflow-x-auto whitespace-pre-wrap break-words">{parts}</pre>
}

function parseTodoOutput(output: string): Todo[] | null {
  try {
    const parsed = JSON.parse(output)
    if (Array.isArray(parsed)) return parsed
    if (parsed && Array.isArray(parsed.todos)) return parsed.todos
    return null
  } catch {
    return null
  }
}

export function ToolCallPart({ part, onFileClick, onChildSessionClick }: ToolCallPartProps) {
  const { preferences } = useSettings()
  const { userBashCommands } = useUserBash()
  const outputRef = useRef<HTMLDivElement>(null)
  const isUserBashCommand = part.tool === 'bash' && 
    part.state.status === 'completed' &&
    typeof part.state.input?.command === 'string' &&
    userBashCommands.has(part.state.input.command)
  const isTodoTool = part.tool === 'todowrite' || part.tool === 'todoread'
  
  // Todo tools show expanded content by default, other tools use preference
  const defaultExpanded = isUserBashCommand || isTodoTool || (preferences?.expandToolCalls ?? false)
  const [expanded, setExpanded] = useState(defaultExpanded)

  useEffect(() => {
    if (part.tool === 'bash' && expanded && outputRef.current) {
      outputRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [expanded, part.tool])

  const getStatusColor = () => {
    switch (part.state.status) {
      case 'completed':
        return 'text-green-600 dark:text-green-400'
      case 'error':
        return 'text-red-600 dark:text-red-400'
      case 'running':
        return 'text-yellow-600 dark:text-yellow-400'
      default:
        return 'text-muted-foreground'
    }
  }

  const getStatusIcon = () => {
    switch (part.state.status) {
      case 'completed':
        return <span>✓</span>
      case 'error':
        return <span>✗</span>
      case 'running':
        return <Loader2 className="w-3.5 h-3.5 animate-spin" />
      case 'pending':
        return <span className="inline-block w-2 h-2 rounded-full bg-current animate-pulse" />
      default:
        return <span>○</span>
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
      case 'todowrite':
      case 'todoread':
        return null
      default:
        return null
    }
  }

  const getTodoData = () => {
    if (part.tool !== 'todowrite' && part.tool !== 'todoread') {
      return null
    }

    const state = part.state
    
    // For completed state - has output and metadata
    if (state.status === 'completed') {
      if (state.metadata?.todos && Array.isArray(state.metadata.todos)) {
        return state.metadata.todos as Todo[]
      }
      if (state.output) {
        const parsed = parseTodoOutput(state.output)
        if (parsed) return parsed
      }
    }
    
    // For running state - might have metadata
    if (state.status === 'running' && state.metadata?.todos && Array.isArray(state.metadata.todos)) {
      return state.metadata.todos as Todo[]
    }
    
    // For any state - try input (used by todowrite)
    if (state.input?.todos && Array.isArray(state.input.todos)) {
      return state.input.todos as Todo[]
    }
    
    return null
  }

  const previewText = getPreviewText()
  const todoData = getTodoData()
  const isFileTool = ['read', 'write', 'edit'].includes(part.tool)

  // For todo tools, render the TodoListDisplay directly without wrapper
  if (isTodoTool) {
    if (part.state.status === 'pending') {
      return (
        <div className="my-2 text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="w-3 h-3 animate-spin" />
          <span>Preparing task list...</span>
        </div>
      )
    }

    if (part.state.status === 'running') {
      return (
        <div className="my-2">
          <TodoListDisplay
            todos={todoData || []}
            title="Task List"
            showCompleted={true}
            scrollCurrentOnly={true}
            isLoading={true}
          />
        </div>
      )
    }

    if (part.state.status === 'completed') {
      return (
        <div className="my-2">
          <TodoListDisplay
            todos={todoData || []}
            title="Task List"
            showCompleted={true}
            scrollCurrentOnly={true}
          />
        </div>
      )
    }

    if (part.state.status === 'error') {
      return (
        <div className="my-2 text-sm text-red-600 dark:text-red-400">
          Error updating tasks: {part.state.error}
        </div>
      )
    }

    return null
  }

  if (isUserBashCommand) {
    const command = part.state.input.command as string
    const output = part.state.status === 'completed' ? part.state.output : ''
    return (
      <div className="my-2">
        <div className="flex items-center gap-2 text-sm mb-2">
          <span className="text-green-600 dark:text-green-400">✓</span>
          <span className="font-medium">$</span>
          <span className="text-foreground">{command}</span>
          {part.state.status === 'completed' && part.state.time && (
            <span className="text-muted-foreground text-xs ml-auto">
              {((part.state.time.end - part.state.time.start) / 1000).toFixed(2)}s
            </span>
          )}
        </div>
        <pre className="bg-accent p-3 rounded text-xs overflow-x-auto whitespace-pre-wrap cursor-pointer hover:bg-accent/80 transition-colors" 
             onClick={() => navigator.clipboard.writeText(output)}
             title="Click to copy output">
          {output}
        </pre>
      </div>
    )
  }

  const getBorderStyle = () => {
    switch (part.state.status) {
      case 'running':
        return 'border-yellow-500/50 shadow-sm shadow-yellow-500/10'
      case 'pending':
        return 'border-blue-500/30'
      case 'error':
        return 'border-red-500/30'
      case 'completed':
        return 'border-border'
      default:
        return 'border-border'
    }
  }

  return (
    <div ref={outputRef} className={`border rounded-lg overflow-hidden my-2 transition-all ${getBorderStyle()}`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-2 bg-card hover:bg-card-hover text-left flex items-center gap-2 text-sm min-w-0"
      >
        <span className={getStatusColor()}>{getStatusIcon()}</span>
        <span className="font-medium">{part.tool}</span>
        
        {/* Header preview text */}
        {previewText && isFileTool ? (
          <span
            onClick={(e) => {
              e.stopPropagation()
              if (onFileClick && previewText) {
                onFileClick(previewText)
              }
            }}
            className="text-blue-600 dark:text-blue-400 text-xs truncate hover:text-blue-700 dark:hover:text-blue-300 cursor-pointer underline decoration-dotted"
            title={`Click to open ${previewText}`}
          >
            {previewText}
          </span>
        ) : previewText ? (
          <span className="text-muted-foreground text-xs truncate">{previewText}</span>
        ) : null}
        
        {part.tool === 'task' && (() => {
          let sessionId: string | undefined = part.metadata?.sessionId as string | undefined
          if (!sessionId && part.state.status !== 'pending' && 'metadata' in part.state) {
            sessionId = part.state.metadata?.sessionId as string | undefined
          }
          return sessionId ? (
            <span
              onClick={(e) => {
                e.stopPropagation()
                onChildSessionClick?.(sessionId)
              }}
              className="text-purple-600 dark:text-purple-400 text-xs hover:text-purple-700 dark:hover:text-purple-300 cursor-pointer underline decoration-dotted flex items-center gap-1"
              title="View subagent session"
            >
              <ExternalLink className="w-3 h-3" />
              View Session
            </span>
          ) : null
        })()}
        <span className="text-muted-foreground text-xs ml-auto">({part.state.status})</span>
      </button>

      {/* Expanded content for non-todo tools */}
      {expanded && (
        <div className="bg-card space-y-2 p-3">
          {part.state.status === 'pending' && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <div className="flex gap-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
              <span>Preparing tool call...</span>
            </div>
          )}

          {part.state.status === 'running' && (
            <>
              {part.tool === 'bash' ? (
                <div className="text-sm">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="text-muted-foreground">Command:</div>
                    <CopyButton 
                      content={typeof part.state.input?.command === 'string' ? part.state.input.command : ''} 
                      title="Copy command" 
                    />
                  </div>
                  <div className="bg-accent p-2 rounded text-xs overflow-x-auto whitespace-pre-wrap break-words">
                    <span className="text-green-600 dark:text-green-400">$</span> {typeof part.state.input?.command === 'string' ? part.state.input.command : ''}
                  </div>
                  <div className="flex items-center gap-2 mt-2 text-xs text-yellow-600 dark:text-yellow-400">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>Running...</span>
                  </div>
                </div>
              ) : (
                <div className="text-sm">
                  <div className="text-muted-foreground mb-1">Input:</div>
                  <ClickableJson json={part.state.input} onFileClick={onFileClick} />
                  <div className="flex items-center gap-2 mt-2 text-xs text-yellow-600 dark:text-yellow-400">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>Running...</span>
                  </div>
                </div>
              )}
            </>
          )}

          {part.state.status === 'completed' && (
            <>
              {part.tool === 'bash' ? (
                <div className="text-sm">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="text-muted-foreground">Command:</div>
                    <CopyButton 
                      content={typeof part.state.input?.command === 'string' ? part.state.input.command : ''} 
                      title="Copy command" 
                    />
                  </div>
                  <div className="bg-accent p-2 rounded text-xs overflow-x-auto whitespace-pre-wrap break-words">
                    <span className="text-green-600 dark:text-green-400">$</span> {typeof part.state.input?.command === 'string' ? part.state.input.command : ''}
                  </div>
                </div>
              ) : (
                <div className="text-sm">
                  <div className="text-muted-foreground mb-1">Input:</div>
                  <ClickableJson json={part.state.input} onFileClick={onFileClick} />
                </div>
              )}
              <div className="text-sm">
                <div className="text-muted-foreground mb-1">Output:</div>
                <pre className="bg-accent p-2 rounded text-xs overflow-x-auto whitespace-pre-wrap break-all cursor-pointer hover:bg-accent/80 transition-colors" 
                     onClick={() => part.state.status === 'completed' && navigator.clipboard.writeText(part.state.output)}
                     title="Click to copy output">
                  {part.state.status === 'completed' ? part.state.output : ''}
                </pre>
              </div>
              {part.state.time && (
                <div className="text-xs text-muted-foreground">
                  Duration: {((part.state.time.end - part.state.time.start) / 1000).toFixed(2)}s
                </div>
              )}
            </>
          )}

          {part.state.status === 'error' && (
            <div className="text-sm">
              <div className="text-red-600 dark:text-red-400 mb-1">Error:</div>
              <pre className="bg-accent p-2 rounded text-xs overflow-x-auto whitespace-pre-wrap break-words text-red-600 dark:text-red-300">
                {part.state.error}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
