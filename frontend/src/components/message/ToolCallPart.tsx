import { useState, useRef, useEffect } from 'react'
import type { components } from '@/api/opencode-types'
import { useSettings } from '@/hooks/useSettings'
import { useUserBash } from '@/stores/userBashStore'
import { usePermissions, useQuestions } from '@/contexts/EventContext'
import { detectFileReferences } from '@/lib/fileReferences'
import { ExternalLink, Loader2 } from 'lucide-react'
import { CopyButton } from '@/components/ui/copy-button'
import { getToolSpecificRender } from './FileToolRender'

type ToolPart = components['schemas']['ToolPart']

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
        className="cursor-pointer text-info underline decoration-dotted hover:text-info"
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

export function ToolCallPart({ part, onFileClick, onChildSessionClick }: ToolCallPartProps) {
  const { preferences } = useSettings()
  const { userBashCommands } = useUserBash()
  const { getForCallID: getPermissionForCallID } = usePermissions()
  const { getForCallID: getQuestionForCallID } = useQuestions()
  const outputRef = useRef<HTMLDivElement>(null)
  const isUserBashCommand = part.tool === 'bash' &&
    part.state.status === 'completed' &&
    typeof part.state.input?.command === 'string' &&
    userBashCommands.has(part.state.input.command)
  const isTodoTool = part.tool === 'todowrite' || part.tool === 'todoread'
  const [expanded, setExpanded] = useState(isUserBashCommand || isTodoTool || (preferences?.expandToolCalls ?? false))

  const pendingPermission = getPermissionForCallID(part.callID, part.sessionID)
  const isWaitingPermission = part.state.status === 'running' && !!pendingPermission
  const pendingQuestion = getQuestionForCallID(part.callID, part.sessionID)
  const isWaitingQuestion = part.state.status === 'running' && !!pendingQuestion

  useEffect(() => {
    if (part.tool === 'bash' && expanded && outputRef.current) {
      outputRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [expanded, part.tool])

  const getStatusColor = () => {
    switch (part.state.status) {
      case 'completed':
        return 'text-success'
      case 'error':
        return 'text-destructive'
      case 'running':
        if (isWaitingPermission) return 'text-warning'
        if (isWaitingQuestion) return 'text-info'
        return 'text-warning'
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

  const previewText = getPreviewText()
  const isFileTool = ['read', 'write', 'edit'].includes(part.tool)

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
        <div className="my-2 text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="w-3 h-3 animate-spin" />
          <span>Updating task list...</span>
        </div>
      )
    }

    if (part.state.status === 'completed') {
      return (
        <div className="my-2 text-xs text-muted-foreground">
          Task list updated
        </div>
      )
    }

    if (part.state.status === 'error') {
      return (
        <div className="my-2 text-sm text-destructive">
          Error updating tasks: {part.state.error}
        </div>
      )
    }

    return null
  }

  const toolSpecificRender = getToolSpecificRender(part, onFileClick)
  if (toolSpecificRender) {
    return toolSpecificRender
  }

  if (isUserBashCommand) {
    const command = part.state.input.command as string
    const output = part.state.status === 'completed' ? part.state.output : ''
    return (
      <div className="my-2">
        <div className="flex items-center gap-2 text-sm mb-2">
          <span className="text-success">✓</span>
          <span className="font-medium">$</span>
          <span className="text-foreground">{command}</span>
          {part.state.status === 'completed' && part.state.time && (
            <span className="text-muted-foreground text-xs ml-auto">
              {((part.state.time.end - part.state.time.start) / 1000).toFixed(2)}s
            </span>
          )}
        </div>
        <div className="relative">
          <pre className="bg-accent p-3 rounded text-xs overflow-x-auto whitespace-pre-wrap">
            {output}
          </pre>
          <CopyButton content={output} title="Copy output" className="absolute top-2 right-2" />
        </div>
      </div>
    )
  }

  const getBorderStyle = () => {
    switch (part.state.status) {
      case 'running':
        if (isWaitingPermission) return 'border-warning/40 shadow-sm shadow-warning/15'
        if (isWaitingQuestion) return 'border-info/40 shadow-sm shadow-info/15'
        return 'border-warning/40 shadow-sm shadow-warning/10'
      case 'pending':
        return 'border-info/30'
      case 'error':
        return 'border-destructive/30'
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

        {previewText && isFileTool ? (
          <span
            onClick={(e) => {
              e.stopPropagation()
              if (onFileClick && previewText) {
                onFileClick(previewText)
              }
            }}
            className="cursor-pointer truncate text-xs text-info underline decoration-dotted hover:text-info"
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
              className="flex cursor-pointer items-center gap-1 text-xs text-info underline decoration-dotted hover:text-info"
              title="View subagent session"
            >
              <ExternalLink className="w-3 h-3" />
              View Session
            </span>
          ) : null
        })()}
         <span className="text-muted-foreground text-xs ml-auto">({isWaitingPermission ? 'awaiting permission' : isWaitingQuestion ? 'awaiting answer' : part.state.status})</span>
      </button>

      {expanded && (
        <div className="bg-card space-y-2 p-3">
          {part.state.status === 'pending' && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <div className="flex gap-0.5">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-info" style={{ animationDelay: '0ms' }} />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-info" style={{ animationDelay: '150ms' }} />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-info" style={{ animationDelay: '300ms' }} />
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
                    <span className="text-success">$</span> {typeof part.state.input?.command === 'string' ? part.state.input.command : ''}
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-xs text-warning">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>{isWaitingPermission ? 'Waiting for permission...' : 'Running...'}</span>
                  </div>
                </div>
              ) : (
                <div className="text-sm">
                  <div className="text-muted-foreground mb-1">Input:</div>
                  <ClickableJson json={part.state.input} onFileClick={onFileClick} />
                  <div className="mt-2 flex items-center gap-2 text-xs text-warning">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>{isWaitingPermission ? 'Waiting for permission...' : 'Running...'}</span>
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
                    <span className="text-success">$</span> {typeof part.state.input?.command === 'string' ? part.state.input.command : ''}
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
                <div className="relative">
                  <pre className="bg-accent p-2 rounded text-xs overflow-x-auto whitespace-pre-wrap break-all">
                    {part.state.status === 'completed' ? part.state.output : ''}
                  </pre>
                  {part.state.status === 'completed' && part.state.output && (
                    <CopyButton content={part.state.output} title="Copy output" className="absolute top-1 right-1" iconSize="sm" />
                  )}
                </div>
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
              <div className="mb-1 text-destructive">Error:</div>
              <pre className="rounded bg-accent p-2 text-xs text-destructive overflow-x-auto whitespace-pre-wrap break-words">
                {part.state.error}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
