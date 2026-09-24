import { useState, useRef, useEffect, useMemo, memo } from 'react'
import { unwrapSandboxExecCommand } from '@opencode-manager/shared/utils'
import { toolContentText, type SessionMessageAssistantTool } from '@opencode-manager/shared/opencode'
import { useSettings } from '@/hooks/useSettings'
import { useUserBash } from '@/stores/userBashStore'
import { useSessionStatusForSession } from '@/stores/sessionStatusStore'
import { detectFileReferences } from '@/lib/fileReferences'
import { ExternalLink, Loader2, Shield } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { CopyButton } from '@/components/ui/copy-button'
import { getToolSpecificRender } from './FileToolRender'

const DISPLAY_LIMIT = 30_000
const DISPLAY_HEAD_LENGTH = 20_000
const DISPLAY_TAIL_LENGTH = 10_000

function formatOmittedSize(size: number): string {
  return size < 1024 * 1024
    ? `${(size / 1024).toFixed(1)} KB`
    : `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function clampDisplayText(text: string): string {
  if (text.length <= DISPLAY_LIMIT) return text
  const headCut = text.lastIndexOf('\n', DISPLAY_HEAD_LENGTH)
  const head = headCut === -1 ? text.slice(0, DISPLAY_HEAD_LENGTH) : text.slice(0, headCut)
  const tailFrom = text.length - DISPLAY_TAIL_LENGTH
  const tailCut = text.indexOf('\n', tailFrom)
  const tail = tailCut === -1 ? text.slice(tailFrom) : text.slice(tailCut + 1)
  const omitted = formatOmittedSize(text.length - head.length - tail.length)
  const marker = `\n[… ${omitted} omitted — use the copy button for the full output …]\n`
  return head + marker + tail
}

function BoundedPre({ content, className }: { content: string; className: string }) {
  const clamped = useMemo(() => clampDisplayText(content), [content])
  return <pre className={className}>{clamped}</pre>
}

interface ToolCallPartProps {
  part: SessionMessageAssistantTool
  onFileClick?: (filePath: string, lineNumber?: number) => void
  onChildSessionClick?: (sessionId: string) => void
}

function toolInput(part: SessionMessageAssistantTool): Record<string, unknown> | undefined {
  if (part.state.status === 'streaming') return undefined
  return part.state.input
}

function toolMetadata(part: SessionMessageAssistantTool): Record<string, unknown> {
  if (part.state.status === 'streaming') return {}
  return part.state.metadata ?? {}
}

function toolOutputText(part: SessionMessageAssistantTool): string {
  if (part.state.status === 'streaming') return ''
  return toolContentText(part.state.status === 'running' ? undefined : part.state.content)
}

function getSubagentSessionId(part: SessionMessageAssistantTool): string | undefined {
  const sessionID = toolMetadata(part).sessionID
  return typeof sessionID === 'string' ? sessionID : undefined
}

function ClickableJson({ json, onFileClick }: { json: unknown; onFileClick?: (filePath: string) => void }) {
  const jsonString = useMemo(() => JSON.stringify(json, null, 2), [json])
  const references = useMemo(() => detectFileReferences(jsonString), [jsonString])

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

export const ToolCallPart = memo(function ToolCallPart({ part, onFileClick, onChildSessionClick }: ToolCallPartProps) {
  const { preferences } = useSettings()
  const { userBashCommands } = useUserBash()
  const isSubagent = part.name === 'subagent'
  const subagentSessionId = isSubagent ? getSubagentSessionId(part) : undefined
  const subagentSessionStatus = useSessionStatusForSession(subagentSessionId)
  const outputRef = useRef<HTMLDivElement>(null)
  const input = toolInput(part)
  const rawCommand = part.name === 'shell' && typeof input?.command === 'string'
    ? input.command
    : undefined
  const displayCommand = useMemo(
    () => (rawCommand === undefined ? undefined : unwrapSandboxExecCommand(rawCommand)),
    [rawCommand]
  )
  const isSandboxedCommand =
    part.state.status === 'completed' &&
    (toolMetadata(part).sandbox === true ||
      (rawCommand !== undefined && displayCommand !== rawCommand))
  const isUserBashCommand = part.state.status === 'completed' &&
    typeof displayCommand === 'string' &&
    userBashCommands.has(displayCommand)
  const [expanded, setExpanded] = useState(isUserBashCommand || (preferences?.expandToolCalls ?? false))

  useEffect(() => {
    if (part.name === 'shell' && expanded && outputRef.current) {
      outputRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [expanded, part.name])

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
      case 'streaming':
        return <span className="inline-block w-2 h-2 rounded-full bg-current animate-pulse" />
      default:
        return <span>○</span>
    }
  }

  const getPreviewText = () => {
    if (!input) return null

    switch (part.name) {
      case 'read':
      case 'write':
      case 'edit':
      case 'patch':
        return (input.path as string) || null
      case 'shell':
        return displayCommand || null
      case 'glob':
      case 'grep':
        return (input.pattern as string) || null
      case 'subagent':
        return (input.description as string) || null
      case 'webfetch':
        return (input.url as string) || null
      case 'websearch':
        return (input.query as string) || null
      default:
        return null
    }
  }

  const previewText = getPreviewText()
  const isFileTool = ['read', 'write', 'edit', 'patch'].includes(part.name)
  const sandboxIndicator = isSandboxedCommand ? (
    <Badge
      variant="outline"
      className="shrink-0 gap-1 border-green-600/40 bg-green-500/15 text-green-700 dark:text-green-400"
      title="Executed inside the sandbox microVM"
    >
      <Shield className="w-3 h-3" />
      sandbox
    </Badge>
  ) : null

  if (isSubagent) {
    const status = part.state.status
    const isRunning = status === 'running' && subagentSessionStatus.type !== 'idle'
    const isCompleted = status === 'completed' || (status === 'running' && !!subagentSessionId && subagentSessionStatus.type === 'idle')
    const isError = status === 'error'
    const description = previewText || 'Sub-agent task'

    const content = (
      <div className="flex items-center gap-2 min-w-0">
        {status === 'streaming' && (
          <div className="flex gap-1">
            <span className="w-2 h-2 rounded-full bg-muted-foreground" />
            <span className="w-2 h-2 rounded-full bg-muted-foreground" />
            <span className="w-2 h-2 rounded-full bg-muted-foreground" />
          </div>
        )}
        {isRunning && (
          <div className="flex gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: '0ms' }} />
            <span className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: '150ms' }} />
            <span className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
        )}
        {isCompleted && <span className="text-green-600 text-sm font-medium">✓</span>}
        {isError && <span className="text-red-600 text-sm font-medium">✗</span>}
        <span className="font-medium text-foreground truncate">{description}</span>
        <span className="text-[11px] font-medium text-orange-600 dark:text-orange-400 shrink-0">sub-agent</span>
        {subagentSessionId && <ExternalLink className="w-3 h-3 shrink-0 text-blue-600 dark:text-blue-400" />}
      </div>
    )

    if (subagentSessionId) {
      return (
        <button
          onClick={() => onChildSessionClick?.(subagentSessionId)}
          className="my-1 w-full rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-1.5 text-left text-xs text-muted-foreground hover:bg-blue-500/10 hover:border-blue-500/30 transition-all duration-200 shadow-sm shadow-blue-500/5"
          title="View subagent session"
        >
          {content}
        </button>
      )
    }

    return (
      <div className="my-1 rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-1.5 text-xs text-muted-foreground shadow-sm shadow-blue-500/5">
        {content}
      </div>
    )
  }

  const toolSpecificRender = getToolSpecificRender(part, onFileClick)
  if (toolSpecificRender) {
    return toolSpecificRender
  }

  if (isUserBashCommand) {
    const command = displayCommand ?? ''
    const output = toolOutputText(part)
    const ran = part.state.status === 'streaming' ? undefined : part.state.status === 'running' ? undefined : part.time.ran
    const completed = part.state.status === 'streaming' ? undefined : part.state.status === 'running' ? undefined : part.time.completed
    return (
      <div className="my-2">
        <div className="flex items-center gap-2 text-sm mb-2">
          <span className="text-green-600 dark:text-green-400">✓</span>
          <span className="font-medium">$</span>
          <span className="text-foreground">{command}</span>
          {sandboxIndicator}
          {ran !== undefined && completed !== undefined && (
            <span className="text-muted-foreground text-xs ml-auto">
              {((completed - ran) / 1000).toFixed(2)}s
            </span>
          )}
        </div>
        <div className="relative">
          <BoundedPre content={output} className="bg-accent p-3 rounded text-xs overflow-x-auto whitespace-pre-wrap" />
          <CopyButton content={output} title="Copy output" className="absolute top-2 right-2" />
        </div>
      </div>
    )
  }

  const getBorderStyle = () => {
    switch (part.state.status) {
      case 'running':
        return 'border-yellow-500/50 shadow-sm shadow-yellow-500/10'
      case 'streaming':
        return 'border-blue-500/30'
      case 'error':
        return 'border-red-500/30'
      case 'completed':
        return 'border-border'
      default:
        return 'border-border'
    }
  }

  const output = toolOutputText(part)

  return (
    <div ref={outputRef} className={`border rounded-lg overflow-hidden my-2 transition-all ${getBorderStyle()}`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-2 bg-card hover:bg-card-hover text-left flex items-center gap-2 text-sm min-w-0"
      >
        <span className={getStatusColor()}>{getStatusIcon()}</span>
        <span className="font-medium">{part.name}</span>
        {sandboxIndicator}

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

        <span className="text-muted-foreground text-xs ml-auto">{part.state.status}</span>
      </button>

      {expanded && (
        <div className="bg-card space-y-2 p-3">
          {part.state.status === 'streaming' && (
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
            part.name === 'shell' ? (
              <div className="text-sm">
                <div className="flex items-center gap-2 mb-1">
                  <div className="text-muted-foreground">Command:</div>
                  <CopyButton content={displayCommand ?? ''} title="Copy command" />
                </div>
                <div className="bg-accent p-2 rounded text-xs overflow-x-auto whitespace-pre-wrap break-words">
                  <span className="text-green-600 dark:text-green-400">$</span> {displayCommand ?? ''}
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
            )
          )}

          {part.state.status === 'completed' && (
            <>
              {part.name === 'shell' ? (
                <div className="text-sm">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="text-muted-foreground">Command:</div>
                    <CopyButton content={displayCommand ?? ''} title="Copy command" />
                  </div>
                  <div className="bg-accent p-2 rounded text-xs overflow-x-auto whitespace-pre-wrap break-words">
                    <span className="text-green-600 dark:text-green-400">$</span> {displayCommand ?? ''}
                  </div>
                </div>
              ) : (
                <div className="text-sm">
                  <div className="text-muted-foreground mb-1">Input:</div>
                  <ClickableJson json={part.state.input} onFileClick={onFileClick} />
                </div>
              )}
              {output && (
                <div className="text-sm">
                  <div className="text-muted-foreground mb-1">Output:</div>
                  <div className="relative">
                    <BoundedPre
                      content={output}
                      className="bg-accent p-2 rounded text-xs overflow-x-auto whitespace-pre-wrap break-all"
                    />
                    <CopyButton content={output} title="Copy output" className="absolute top-1 right-1" iconSize="sm" />
                  </div>
                </div>
              )}
              {part.time.ran !== undefined && part.time.completed !== undefined && (
                <div className="text-xs text-muted-foreground">
                  Duration: {((part.time.completed - part.time.ran) / 1000).toFixed(2)}s
                </div>
              )}
            </>
          )}

          {part.state.status === 'error' && (
            <div className="text-sm">
              <div className="text-red-600 dark:text-red-400 mb-1">Error:</div>
              <BoundedPre
                content={part.state.error.message}
                className="bg-accent p-2 rounded text-xs overflow-x-auto whitespace-pre-wrap break-words text-red-600 dark:text-red-300"
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
})
