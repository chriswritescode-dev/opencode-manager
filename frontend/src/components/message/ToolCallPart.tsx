import { useTranslation } from 'react-i18next'
import { useState, useRef, useEffect } from 'react'
import type { components } from '@/api/opencode-types'
import { useSettings } from '@/hooks/useSettings'
import { useUserBash } from '@/stores/userBashStore'
import { useSessionStatusForSession } from '@/stores/sessionStatusStore'
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
  simpleChatMode?: boolean
}

function getTaskSessionId(part: ToolPart): string | undefined {
  let sessionId = part.metadata?.sessionId as string | undefined
  if (!sessionId && part.state.status !== 'pending' && 'metadata' in part.state) {
    sessionId = part.state.metadata?.sessionId as string | undefined
  }
  return sessionId
}

function ClickableJson({ json, onFileClick }: { json: unknown; onFileClick?: (filePath: string) => void }) {
  const { t } = useTranslation()
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
        title={t('tooltip.openFile', { file: ref.filePath })}
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
  const { t } = useTranslation()
  const { preferences } = useSettings()
  const { userBashCommands } = useUserBash()
  const taskSessionId = part.tool === 'task' ? getTaskSessionId(part) : undefined
  const taskSessionStatus = useSessionStatusForSession(taskSessionId)
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
        return 'text-green-600 dark:text-green-400'
      case 'error':
        return 'text-red-600 dark:text-red-400'
      case 'running':
        if (isWaitingPermission) return 'text-orange-600 dark:text-orange-400'
        if (isWaitingQuestion) return 'text-blue-600 dark:text-blue-400'
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

  const previewText = getPreviewText()
  const isFileTool = ['read', 'write', 'edit'].includes(part.tool)

  if (part.tool === 'task') {
    const sessionId = taskSessionId
    const description = previewText || t('message.subAgentTask')
    const status = part.state.status

    const isPending = status === 'pending'
    const isRunning = status === 'running' && taskSessionStatus.type !== 'idle'
    const isCompleted = status === 'completed' || (status === 'running' && !!sessionId && taskSessionStatus.type === 'idle')
    const isError = status === 'error'

    const content = (
      <div className="flex items-center gap-2 min-w-0">
        {isPending && (
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
        <span className="text-[11px] font-medium text-orange-600 dark:text-orange-400 shrink-0">{t('message.subAgent')}</span>
        {sessionId && <ExternalLink className="w-3 h-3 shrink-0 text-blue-600 dark:text-blue-400" />}
      </div>
    )

    if (sessionId) {
      return (
        <button
          onClick={() => onChildSessionClick?.(sessionId)}
          className="my-1 w-full rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-1.5 text-left text-xs text-muted-foreground hover:bg-blue-500/10 hover:border-blue-500/30 transition-all duration-200 shadow-sm shadow-blue-500/5"
          title={t('session.viewSubagent')}
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

  if (isTodoTool) {
    if (part.state.status === 'error') {
      return (
        <div className="my-2 text-sm text-red-600 dark:text-red-400">
          {t('message.todoError')}: {part.state.error}
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
          <span className="text-green-600 dark:text-green-400">✓</span>
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
          <CopyButton content={output} title={t('code.copyOutput')} className="absolute top-2 right-2" />
        </div>
      </div>
    )
  }

  const getBorderStyle = () => {
    switch (part.state.status) {
      case 'running':
        if (isWaitingPermission) return 'border-orange-500/50 shadow-sm shadow-orange-500/20'
        if (isWaitingQuestion) return 'border-blue-500/50 shadow-sm shadow-blue-500/20'
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

        {previewText && isFileTool ? (
          <span
            onClick={(e) => {
              e.stopPropagation()
              if (onFileClick && previewText) {
                onFileClick(previewText)
              }
            }}
            className="text-blue-600 dark:text-blue-400 text-xs truncate hover:text-blue-700 dark:hover:text-blue-300 cursor-pointer underline decoration-dotted"
            title={t('tooltip.openFile', { file: previewText })}
          >
            {previewText}
          </span>
        ) : previewText ? (
          <span className="text-muted-foreground text-xs truncate">{previewText}</span>
        ) : null}

        {part.tool === 'task' && (() => {
          const sessionId = getTaskSessionId(part)
          return sessionId ? (
            <span
              onClick={(e) => {
                e.stopPropagation()
                onChildSessionClick?.(sessionId)
              }}
              className="text-blue-600 dark:text-blue-400 text-xs hover:text-blue-700 dark:hover:text-blue-300 cursor-pointer underline decoration-dotted flex items-center gap-1"
              title={t('session.viewSubagent')}
            >
              <ExternalLink className="w-3 h-3" />
              {t('session.viewSubagent')}
            </span>
          ) : null
        })()}
         <span className="text-muted-foreground text-xs ml-auto">({isWaitingPermission ? t('session.awaitingPermission') : isWaitingQuestion ? t('session.awaitingAnswer') : part.state.status})</span>
      </button>

      {expanded && (
        <div className="bg-card space-y-2 p-3">
          {part.state.status === 'pending' && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <div className="flex gap-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
              <span>{t('message.preparingToolCall')}</span>
            </div>
          )}

          {part.state.status === 'running' && (
            <>
              {part.tool === 'bash' ? (
                <div className="text-sm">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="text-muted-foreground">{t('message.command')}:</div>
                    <CopyButton
                      content={typeof part.state.input?.command === 'string' ? part.state.input.command : ''}
                      title={t('code.copyCommand')}
                    />
                  </div>
                  <div className="bg-accent p-2 rounded text-xs overflow-x-auto whitespace-pre-wrap break-words">
                    <span className="text-green-600 dark:text-green-400">$</span> {typeof part.state.input?.command === 'string' ? part.state.input.command : ''}
                  </div>
                  <div className={`flex items-center gap-2 mt-2 text-xs ${isWaitingPermission ? 'text-orange-600 dark:text-orange-400' : 'text-yellow-600 dark:text-yellow-400'}`}>
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>{isWaitingPermission ? t('session.waitingForPermission') : t('message.running')}</span>
                  </div>
                </div>
              ) : (
                <div className="text-sm">
                  <div className="text-muted-foreground mb-1">{t('message.input')}:</div>
                  <ClickableJson json={part.state.input} onFileClick={onFileClick} />
                  <div className={`flex items-center gap-2 mt-2 text-xs ${isWaitingPermission ? 'text-orange-600 dark:text-orange-400' : 'text-yellow-600 dark:text-yellow-400'}`}>
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>{isWaitingPermission ? t('session.waitingForPermission') : t('message.running')}</span>
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
                    <div className="text-muted-foreground">{t('message.command')}:</div>
                    <CopyButton
                      content={typeof part.state.input?.command === 'string' ? part.state.input.command : ''}
                      title={t('code.copyCommand')}
                    />
                  </div>
                  <div className="bg-accent p-2 rounded text-xs overflow-x-auto whitespace-pre-wrap break-words">
                    <span className="text-green-600 dark:text-green-400">$</span> {typeof part.state.input?.command === 'string' ? part.state.input.command : ''}
                  </div>
                </div>
              ) : (
                <div className="text-sm">
                  <div className="text-muted-foreground mb-1">{t('message.input')}:</div>
                  <ClickableJson json={part.state.input} onFileClick={onFileClick} />
                </div>
              )}
              <div className="text-sm">
                <div className="text-muted-foreground mb-1">{t('message.output')}:</div>
                <div className="relative">
                  <pre className="bg-accent p-2 rounded text-xs overflow-x-auto whitespace-pre-wrap break-all">
                    {part.state.status === 'completed' ? part.state.output : ''}
                  </pre>
                  {part.state.status === 'completed' && part.state.output && (
                    <CopyButton content={part.state.output} title={t('code.copyOutput')} className="absolute top-1 right-1" iconSize="sm" />
                  )}
                </div>
              </div>
              {part.state.time && (
                <div className="text-xs text-muted-foreground">
                  {t('message.duration')}: {((part.state.time.end - part.state.time.start) / 1000).toFixed(2)}s
                </div>
              )}
            </>
          )}

          {part.state.status === 'error' && (
            <div className="text-sm">
              <div className="text-red-600 dark:text-red-400 mb-1">{t('common.error')}:</div>
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
